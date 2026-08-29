import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import * as dom from '../../src/ui/dom/index.js';

const root = process.cwd();
const readText = path => readFile(resolve(root, path), 'utf8');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(...values) {
    for (const value of values) this.values.add(value);
  }
  remove(...values) {
    for (const value of values) this.values.delete(value);
  }
  contains(value) {
    return this.values.has(value);
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

class FakeElement extends FakeEventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.dataset = {};
    this.classList = new FakeClassList();
    this.className = '';
    this.id = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    this.focusCalls = [];
    this.queryResults = new Map();
    this.queryAllResults = [];
  }
  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }
  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }
  querySelector(selector) {
    return this.queryResults.get(selector) || null;
  }
  querySelectorAll() {
    return this.queryAllResults;
  }
  focus(options) {
    this.focusCalls.push(options);
    this.ownerDocument.activeElement = this;
  }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
  }
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

function createTabEvent(shiftKey = false) {
  return {
    key: 'Tab',
    shiftKey,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
}

test('DOM primitive public entry is exact and callers do not bypass it', async () => {
  assert.deepEqual(Object.keys(dom).sort(), [
    'collectRequiredRefs',
    'createEventScope',
    'createFocusScope',
    'createSafeElement',
    'createTransitionVisibility',
    'isElementRef',
    'requireElementRef'
  ]);

  const publicEntry = await readText('src/ui/dom/index.js');
  assert.doesNotMatch(publicEntry, /function\s|class\s|new Map|new Set|addEventListener|createElement\(/);

  const migratedCallers = [
    'src/ui/create-ui.js',
    'src/ui/compatibility/business-content-port.js',
    'src/ui/shell/app-shell-view.js',
    'src/ui/shell/menu-bar-shell.js',
    'src/ui/shell/overlay-root.js',
    'src/ui/shell/sidebar-shell.js',
    'src/ui/shell/status-bar-shell.js',
    'src/ui/shell/toolbar-shell.js',
    'src/ui/shell/workspace-shell.js',
    'src/runtime/link-preview.js'
  ];
  for (const path of migratedCallers) {
    const source = await readText(path);
    assert.match(source, /ui\/dom\/index\.js|\.\.\/dom\/index\.js|\.\/dom\/index\.js/, path);
    assert.doesNotMatch(source, /ui\/dom\/(?!index\.js)|\.\.\/dom\/(?!index\.js)|\.\/dom\/(?!index\.js)/, path);
  }

  for (const path of migratedCallers.filter(path => path.includes('/shell/'))) {
    assert.doesNotMatch(await readText(path), /\.createElement\(/, path);
  }
  const linkPreview = await readText('src/runtime/link-preview.js');
  assert.doesNotMatch(linkPreview, /document\.createElement\(|document\.addEventListener\(/);
  assert.match(linkPreview, /createFocusScope\(/);
  assert.match(linkPreview, /createTransitionVisibility\(/);
});

test('safe element creation rejects executable markup and only applies explicit safe fields', () => {
  const documentRef = new FakeDocument();
  const element = dom.createSafeElement(documentRef, 'button', {
    id: 'save',
    className: 'primary action',
    text: 'Save',
    attributes: { type: 'button', disabled: false, 'aria-label': 'Save document' },
    dataset: { commandId: 'document.save' }
  });
  assert.equal(element.tagName, 'BUTTON');
  assert.equal(element.id, 'save');
  assert.equal(element.className, 'primary action');
  assert.equal(element.textContent, 'Save');
  assert.equal(element.getAttribute('type'), 'button');
  assert.equal(element.getAttribute('disabled'), null);
  assert.equal(element.getAttribute('aria-label'), 'Save document');
  assert.deepEqual(element.dataset, { commandId: 'document.save' });

  assert.throws(() => dom.createSafeElement(documentRef, 'script'), /Unsafe or invalid/);
  assert.throws(() => dom.createSafeElement(documentRef, 'div', { attributes: { onclick: 'run()' } }), /Unsafe attribute/);
  assert.throws(() => dom.createSafeElement(documentRef, 'div', { attributes: { srcdoc: '<p>x</p>' } }), /Unsafe attribute/);
  assert.throws(() => dom.createSafeElement(documentRef, 'div', { attributes: { style: 'display:none' } }), /Unsafe attribute/);
  assert.throws(() => dom.createSafeElement(documentRef, 'a', { attributes: { href: 'java\nscript:run()' } }), /Executable URL/);
  assert.throws(() => dom.createSafeElement(documentRef, 'iframe', { attributes: { src: 'data:text/html,<script>run()</script>' } }), /Executable URL/);
  assert.throws(() => dom.createSafeElement(documentRef, 'div', { innerHTML: '<b>x</b>' }), /Unknown createSafeElement option/);
  assert.throws(() => dom.createSafeElement(documentRef, 'div', new Date()), /plain object/);
});

test('required reference collection fails fast with named selectors and returns a frozen contract', () => {
  const documentRef = new FakeDocument();
  const rootElement = documentRef.createElement('div');
  const menu = documentRef.createElement('nav');
  const editor = documentRef.createElement('div');
  rootElement.queryResults.set('[data-ui-slot="menu"]', menu);
  rootElement.queryResults.set('[data-ui-slot="editor"]', editor);

  const refs = dom.collectRequiredRefs(rootElement, {
    menu: '[data-ui-slot="menu"]',
    editor: '[data-ui-slot="editor"]'
  });
  assert.deepEqual(refs, { menu, editor });
  assert.equal(Object.isFrozen(refs), true);
  assert.equal(dom.requireElementRef(menu, 'menu'), menu);
  assert.throws(() => dom.collectRequiredRefs(rootElement, { preview: '[data-ui-slot="preview"]' }), /preview.*data-ui-slot/);
  assert.throws(() => dom.requireElementRef(null, 'toolbar'), /toolbar/);
});

test('event scope owns listener removal, reverse cleanup and destroyed-state errors', () => {
  const target = new FakeEventTarget();
  const scope = dom.createEventScope();
  const calls = [];
  const first = () => calls.push('first');
  const second = () => calls.push('second');
  const disposeFirst = scope.listen(target, 'change', first);
  scope.listen(target, 'change', second);
  target.dispatch('change');
  assert.deepEqual(calls, ['first', 'second']);

  disposeFirst();
  disposeFirst();
  calls.length = 0;
  target.dispatch('change');
  assert.deepEqual(calls, ['second']);
  scope.destroy();
  scope.destroy();
  calls.length = 0;
  target.dispatch('change');
  assert.deepEqual(calls, []);
  assert.equal(scope.isDestroyed(), true);
  assert.throws(() => scope.listen(target, 'change', first), /destroyed event scope/);
});

test('focus scope provides initial focus, tab containment, restoration and idempotent teardown', () => {
  const documentRef = new FakeDocument();
  const returnTarget = documentRef.createElement('button');
  const rootElement = documentRef.createElement('section');
  const first = documentRef.createElement('button');
  const second = documentRef.createElement('button');
  rootElement.queryAllResults = [first, second];
  documentRef.activeElement = returnTarget;

  const scope = dom.createFocusScope(rootElement, {
    initialFocus: second,
    returnFocus: returnTarget,
    trap: true
  });
  assert.equal(scope.focusInitial(), true);
  assert.equal(documentRef.activeElement, second);

  const forward = createTabEvent(false);
  rootElement.dispatch('keydown', forward);
  assert.equal(forward.prevented, true);
  assert.equal(documentRef.activeElement, first);

  const backward = createTabEvent(true);
  rootElement.dispatch('keydown', backward);
  assert.equal(backward.prevented, true);
  assert.equal(documentRef.activeElement, second);

  scope.destroy();
  scope.destroy();
  assert.equal(documentRef.activeElement, returnTarget);
  assert.equal(scope.isDestroyed(), true);
  assert.throws(() => scope.focusInitial(), /destroyed/);
});

test('transition visibility cancels stale hides and completes on transition or timeout', async () => {
  const documentRef = new FakeDocument();
  const element = documentRef.createElement('section');
  const visibility = dom.createTransitionVisibility(element, { timeout: 10 });

  visibility.show();
  assert.equal(visibility.isVisible(), true);
  assert.equal(element.getAttribute('aria-hidden'), 'false');

  const staleHide = visibility.hide();
  visibility.show();
  assert.equal(await staleHide, false);
  assert.equal(visibility.isVisible(), true);

  const transitionedHide = visibility.hide();
  element.dispatch('transitionend');
  assert.equal(await transitionedHide, true);
  assert.equal(visibility.isVisible(), false);
  assert.equal(element.getAttribute('aria-hidden'), 'true');

  visibility.show();
  assert.equal(await visibility.hide(), true);
  visibility.destroy();
  visibility.destroy();
  assert.equal(visibility.isDestroyed(), true);
  assert.throws(() => visibility.show(), /destroyed/);
});
