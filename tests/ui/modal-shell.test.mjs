import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { ModalShell } from '../../src/ui/components/modal-shell.js';
import {
  COMPATIBILITY_MODAL_CLOSE_EVENT,
  COMPATIBILITY_MODAL_OPEN_EVENT,
  mountCompatibilityModalShells
} from '../../src/ui/compatibility/mount-modal-shells.js';

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }
  add(...values) {
    for (const value of values) this.values.add(String(value));
  }
  remove(...values) {
    for (const value of values) this.values.delete(String(value));
  }
  contains(value) {
    return this.values.has(String(value));
  }
  toggle(value, force) {
    if (force === true) this.add(value);
    else if (force === false) this.remove(value);
    else if (this.contains(value)) this.remove(value);
    else this.add(value);
    return this.contains(value);
  }
  toString() {
    return [...this.values].join(' ');
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }
  dispatch(type, event = {}) {
    if (!('target' in event)) event.target = this;
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }
}

function parseAttributeSelector(selector) {
  const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\](?:\.([a-z0-9_-]+))?$/i);
  if (!match) return null;
  return { name: match[1], value: match[2], className: match[3] || '' };
}

function matchesSelector(element, selector) {
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
  const attribute = parseAttributeSelector(selector);
  if (attribute) {
    if (!element.hasAttribute(attribute.name)) return false;
    if (attribute.value !== undefined && element.getAttribute(attribute.name) !== attribute.value) return false;
    return !attribute.className || element.classList.contains(attribute.className);
  }
  return element.tagName.toLowerCase() === selector.toLowerCase();
}

class FakeElement extends FakeEventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.childNodes = this.children;
    this.attributes = new Map();
    this.classList = new FakeClassList(this);
    this.style = { display: '' };
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    this.focusCalls = [];
  }
  set id(value) {
    const normalized = String(value || '');
    if (normalized) this.attributes.set('id', normalized);
    else this.attributes.delete('id');
  }
  get id() {
    return this.getAttribute('id') || '';
  }
  set className(value) {
    this.classList.values = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }
  get className() {
    return this.classList.toString();
  }
  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }
  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(String(name));
  }
  removeAttribute(name) {
    this.attributes.delete(String(name));
  }
  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  replaceChildren(...nodes) {
    for (const child of [...this.children]) this.removeChild(child);
    this.append(...nodes);
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  contains(node) {
    if (node === this) return true;
    return this.children.some(child => child.contains(node));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const results = [];
    const isTabbableQuery = selector.includes('button:not([disabled])');
    const visit = element => {
      for (const child of element.children) {
        if (isTabbableQuery) {
          const tag = child.tagName.toLowerCase();
          const tabindex = child.getAttribute('tabindex');
          if (!child.disabled && !child.hidden && ['a', 'button', 'input', 'select', 'textarea'].includes(tag)) results.push(child);
          else if (!child.disabled && !child.hidden && tabindex !== null && tabindex !== '-1') results.push(child);
        } else if (matchesSelector(child, selector)) {
          results.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return results;
  }
  focus(options) {
    this.focusCalls.push(options);
    this.ownerDocument.activeElement = this;
  }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.frames = [];
    this.defaultView = {
      requestAnimationFrame: callback => {
        this.frames.push(callback);
        return this.frames.length;
      }
    };
  }
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
  flushFrames() {
    const frames = this.frames.splice(0);
    for (const callback of frames) callback();
  }
}

function createEvent(key = '') {
  return {
    key,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }
  };
}

function createModal(documentRef, id = 'test-modal') {
  const root = documentRef.createElement('div');
  root.id = id;
  root.classList.add('modal-overlay');
  const panel = documentRef.createElement('div');
  panel.classList.add('modal');
  const title = documentRef.createElement('h3');
  title.id = `${id}-title`;
  const first = documentRef.createElement('button');
  first.id = `${id}-first`;
  const second = documentRef.createElement('button');
  second.id = `${id}-second`;
  panel.append(title, first, second);
  root.append(panel);
  return { root, panel, title, first, second };
}

test('ModalShell owns dialog semantics, initial focus, Escape close and focus restoration', async () => {
  const documentRef = new FakeDocument();
  const source = documentRef.createElement('button');
  const { root, panel, title, first, second } = createModal(documentRef);
  source.focus();
  const reasons = [];
  const shell = new ModalShell(root, { panel, transitionTimeout: 5 });

  assert.equal(shell.open(null, {
    labelledBy: title.id,
    initialFocus: first,
    onClose: reason => reasons.push(reason)
  }), true);
  documentRef.flushFrames();
  assert.equal(root.style.display, 'flex');
  assert.equal(root.classList.contains('show'), true);
  assert.equal(root.getAttribute('aria-hidden'), 'false');
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(panel.getAttribute('aria-modal'), 'true');
  assert.equal(panel.getAttribute('aria-labelledby'), title.id);
  assert.equal(documentRef.activeElement, first);

  const tab = createEvent('Tab');
  panel.dispatch('keydown', tab);
  assert.equal(tab.prevented, true);
  assert.equal(documentRef.activeElement, second);

  const escape = createEvent('Escape');
  root.dispatch('keydown', escape);
  assert.equal(escape.prevented, true);
  assert.equal(escape.stopped, true);
  assert.deepEqual(reasons, ['escape']);
  assert.equal(shell.isOpen(), false);
  documentRef.flushFrames();
  assert.equal(documentRef.activeElement, source);
  await new Promise(resolve => setTimeout(resolve, 8));
  assert.equal(root.style.display, 'none');
  assert.equal(shell.close('again'), false);
});

test('ModalShell closes only for the owned backdrop and honors disabled close policies', () => {
  const documentRef = new FakeDocument();
  const { root, panel, title, first } = createModal(documentRef, 'policy-modal');
  const shell = new ModalShell(root, { panel, transitionTimeout: 0 });

  shell.open(null, { labelledBy: title.id, initialFocus: first });
  documentRef.flushFrames();
  root.dispatch('mousedown', { target: panel });
  assert.equal(shell.isOpen(), true);
  root.dispatch('mousedown', { target: root, preventDefault() {}, stopPropagation() {} });
  assert.equal(shell.isOpen(), false);

  shell.open(null, {
    labelledBy: title.id,
    initialFocus: first,
    closeOnEscape: false,
    closeOnBackdrop: false
  });
  documentRef.flushFrames();
  root.dispatch('keydown', createEvent('Escape'));
  root.dispatch('mousedown', { target: root, preventDefault() {}, stopPropagation() {} });
  assert.equal(shell.isOpen(), true);
  shell.close('api');
});

test('ModalShell cancels stale close completion when reopened and keeps the new session authoritative', async () => {
  const documentRef = new FakeDocument();
  const sourceA = documentRef.createElement('button');
  const sourceB = documentRef.createElement('button');
  const { root, panel, title, first, second } = createModal(documentRef, 'race-modal');
  const shell = new ModalShell(root, { panel, transitionTimeout: 5 });

  sourceA.focus();
  shell.open(null, { labelledBy: title.id, initialFocus: first });
  documentRef.flushFrames();
  shell.close('replace');
  sourceB.focus();
  shell.open(null, { labelledBy: title.id, initialFocus: second });
  documentRef.flushFrames();
  await new Promise(resolve => setTimeout(resolve, 8));

  assert.equal(shell.isOpen(), true);
  assert.equal(root.style.display, 'flex');
  assert.equal(documentRef.activeElement, second);
  assert.notEqual(documentRef.activeElement, sourceA);
});

test('ModalShell accepts feature content, validates accessibility options and restores adopted DOM on destroy', () => {
  const documentRef = new FakeDocument();
  const { root, panel } = createModal(documentRef, 'destroy-modal');
  root.style.display = 'grid';
  panel.setAttribute('role', 'region');
  const content = documentRef.createElement('form');
  const input = documentRef.createElement('input');
  content.append(input);
  const reasons = [];
  const shell = new ModalShell(root, { panel, transitionTimeout: 0 });

  assert.throws(() => shell.open(null), /accessible name/);
  assert.throws(() => shell.open(null, { ariaLabel: 'A', labelledBy: 'b' }), /either ariaLabel or labelledBy/);
  assert.throws(() => shell.open(null, { ariaLabel: 'A', unknown: true }), /Unknown modal open option/);

  shell.open(content, { ariaLabel: 'Feature dialog', initialFocus: input, onClose: reason => reasons.push(reason) });
  documentRef.flushFrames();
  assert.deepEqual(panel.children, [content]);
  shell.destroy();
  shell.destroy();
  assert.deepEqual(reasons, ['destroy']);
  assert.equal(root.style.display, 'grid');
  assert.equal(root.getAttribute('aria-hidden'), null);
  assert.equal(panel.getAttribute('role'), 'region');
  assert.equal(panel.getAttribute('aria-modal'), null);
  assert.equal(shell.isDestroyed(), true);
  assert.throws(() => shell.open(null, { ariaLabel: 'x' }), /destroyed/);
});

const COMPATIBILITY_MODAL_IDS = [
  'settings-modal',
  'link-modal',
  'url-modal',
  'find-modal',
  'export-progress-modal',
  'export-image-modal',
  'image-modal',
  'mermaid-modal'
];

function addCompatibilityModal(overlayRoot, id) {
  const documentRef = overlayRoot.ownerDocument;
  const { root, panel } = createModal(documentRef, id);
  const controls = {
    'settings-modal': ['select', 'setting-theme'],
    'link-modal': ['input', 'link-url-input'],
    'url-modal': ['input', 'url-input'],
    'find-modal': ['input', 'find-input'],
    'export-progress-modal': ['button', 'export-progress-cancel'],
    'export-image-modal': ['button', 'export-image-ratio'],
    'image-modal': ['input', 'image-url-input'],
    'mermaid-modal': ['textarea', 'mermaid-code']
  };
  const [tag, controlId] = controls[id];
  const control = documentRef.createElement(tag);
  control.id = controlId;
  if (id === 'export-image-modal') {
    control.classList.add('ratio-btn', 'active');
  }
  panel.append(control);
  if (id === 'settings-modal') panel.querySelector(`#${id}-title`).id = 'settings-title';
  if (id === 'link-modal') panel.querySelector(`#${id}-title`).id = 'link-modal-title';
  if (id === 'export-progress-modal') panel.querySelector(`#${id}-title`).id = 'export-progress-title';
  overlayRoot.append(root);
  return { root, panel, control };
}

test('compatibility modal bridge installs one authoritative registry for the remaining eight compatibility feature modals', () => {
  const documentRef = new FakeDocument();
  const overlayRoot = documentRef.createElement('div');
  overlayRoot.id = 'overlay-root';
  const records = new Map(COMPATIBILITY_MODAL_IDS.map(id => [id, addCompatibilityModal(overlayRoot, id)]));
  const bridge = mountCompatibilityModalShells(overlayRoot);

  assert.throws(() => bridge.open('missing-modal'), /Unknown compatibility modal/);

  const source = documentRef.createElement('button');
  source.focus();
  const openSettings = { options: {} };
  records.get('settings-modal').root.dispatch(COMPATIBILITY_MODAL_OPEN_EVENT, {
    target: records.get('settings-modal').root,
    detail: openSettings
  });
  assert.equal(openSettings.error, null);
  assert.equal(openSettings.result, true);
  documentRef.flushFrames();
  assert.equal(bridge.isOpen('settings-modal'), true);
  assert.equal(documentRef.activeElement, records.get('settings-modal').control);
  assert.equal(records.get('settings-modal').panel.getAttribute('aria-labelledby'), 'settings-title');
  records.get('settings-modal').root.dispatch('keydown', createEvent('Escape'));
  documentRef.flushFrames();
  assert.equal(bridge.isOpen('settings-modal'), false);
  assert.equal(documentRef.activeElement, source);

  bridge.open('export-progress-modal');
  documentRef.flushFrames();
  records.get('export-progress-modal').root.dispatch('keydown', createEvent('Escape'));
  records.get('export-progress-modal').root.dispatch('mousedown', {
    target: records.get('export-progress-modal').root,
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(bridge.isOpen('export-progress-modal'), true);
  const closeProgress = { reason: 'finished' };
  records.get('export-progress-modal').root.dispatch(COMPATIBILITY_MODAL_CLOSE_EVENT, {
    target: records.get('export-progress-modal').root,
    detail: closeProgress
  });
  assert.equal(closeProgress.error, null);
  assert.equal(closeProgress.result, true);

  bridge.destroy();
  bridge.destroy();
  assert.throws(() => bridge.isOpen('settings-modal'), /destroyed/);
});


test('compatibility feature callers use the explicit modal event port without new globals or duplicate lifecycle ownership', async () => {
  const bridgeSource = await readFile('src/ui/compatibility/mount-modal-shells.js', 'utf8');
  const mountSource = await readFile('src/ui/compatibility/business-content-port.js', 'utf8');
  const featureSources = await Promise.all([
    'public/app/core.js',
    'public/app/editor-tools.js',
    'public/app/export.js',
    'public/app/web-clipper.js'
  ].map(path => readFile(path, 'utf8')));
  const eventSource = await readFile('public/app/events.js', 'utf8');
  const helpDialogSource = await readFile('src/features/help/ui/help-dialog-view.js', 'utf8');

  assert.match(mountSource, /mountCompatibilityModalShells\(slots\.overlay\)/);
  assert.doesNotMatch(bridgeSource, /windowRef|markdownEditorModalShells|window\.|globalThis\./);
  for (const source of featureSources) {
    assert.match(source, /markdown-editor:modal-shell-open|markdown-editor:modal-shell-close/);
    assert.doesNotMatch(source, /markdownEditorModalShells/);
  }
  assert.doesNotMatch(eventSource, /linkModal\?\.addEventListener|event\.key === 'Escape'/);

  const joined = featureSources.join('\n');
  for (const id of COMPATIBILITY_MODAL_IDS) assert.match(bridgeSource, new RegExp(`id: '${id}'`));
  assert.doesNotMatch(bridgeSource, /id: 'help-modal'/);
  assert.match(helpDialogSource, /createSafeElement\(documentRef, 'div', \{ id: 'help-modal'/);
  assert.match(helpDialogSource, /new ModalShell\(root,/);
  assert.doesNotMatch(
    joined,
    /(?:settings|help|link|url|find|export-progress|export-image|image|mermaid)-modal[^\n]*(?:classList\.(?:add|remove)|style\.display)/
  );
});
