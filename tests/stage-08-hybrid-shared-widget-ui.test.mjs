import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindWidgetFocusPolicy,
  bindWidgetSourceAction,
  createWidgetActionGroup,
  createWidgetButton,
  createWidgetToolbar,
  mountClassicHybridSourceEditControllerPort,
  openWidgetSource
} from '../src/features/hybrid-editor/index.js';

function createDomHarness() {
  let documentRef = null;
  class FakeElement {
    constructor(tagName = 'div') {
      this.tagName = String(tagName).toUpperCase();
      this.type = '';
      this.className = '';
      this.textContent = '';
      this.title = '';
      this.tabIndex = -1;
      this.dataset = {};
      this.children = [];
      this.listeners = new Map();
      this.attributes = new Map();
      this.focusCalls = [];
      this.ownerDocument = documentRef;
      this.rect = { top: 12, height: 34 };
    }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    removeEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      this.listeners.set(type, listeners.filter(candidate => candidate !== listener));
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) {
      if (name === 'data-hybrid-block-type') return this.dataset.hybridBlockType || null;
      return this.attributes.get(name) || null;
    }
    closest(selector) {
      if (selector === '[data-hybrid-block-type]' && this.dataset.hybridBlockType) return this;
      if (selector === '[data-hybrid-double-zone]' && this.dataset.hybridDoubleZone) return this;
      return null;
    }
    focus(options) { this.focusCalls.push(options); }
    getBoundingClientRect() { return this.rect; }
    dispatch(type, init = {}) {
      const event = {
        type,
        target: init.target || this,
        currentTarget: this,
        button: 0,
        detail: 0,
        timeStamp: 0,
        clientX: 0,
        clientY: 0,
        key: '',
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...init
      };
      for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
      return event;
    }
  }
  documentRef = {
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.ownerDocument = documentRef;
      return element;
    }
  };
  return { documentRef, FakeElement };
}

function withDocument(callback) {
  const original = globalThis.document;
  const harness = createDomHarness();
  globalThis.document = harness.documentRef;
  try {
    return callback(harness);
  } finally {
    globalThis.document = original;
  }
}

function createSourceController(openCalls) {
  return {
    open(...args) { openCalls.push(args); return args; },
    getActiveRange() { return null; },
    handleEditorUpdate() { return null; },
    close() { return false; },
    closeFromPointer() { return false; }
  };
}

test('Atomic 8.6 widget button preserves pointer defaults and scoped click dispatch', () => withDocument(() => {
  let clicks = 0;
  const button = createWidgetButton('执行', 'widget-action', () => { clicks += 1; });
  assert.equal(button.type, 'button');
  assert.equal(button.className, 'widget-action');
  assert.equal(button.textContent, '执行');
  const down = button.dispatch('mousedown');
  assert.equal(down.defaultPrevented, true);
  const click = button.dispatch('click');
  assert.equal(click.defaultPrevented, true);
  assert.equal(click.propagationStopped, true);
  assert.equal(clicks, 1);
}));

test('Atomic 8.6 toolbar primitives project shared classes and optional double zones only', () => withDocument(() => {
  const toolbar = createWidgetToolbar({ className: 'feature-toolbar', doubleZone: 'feature-zone' });
  const actions = createWidgetActionGroup('feature-actions');
  assert.equal(toolbar.tagName, 'HEADER');
  assert.equal(toolbar.className, 'cm-hybrid-block-toolbar feature-toolbar');
  assert.equal(toolbar.dataset.hybridDoubleZone, 'feature-zone');
  assert.equal(actions.tagName, 'SPAN');
  assert.equal(actions.className, 'cm-hybrid-block-actions feature-actions');
}));

test('Atomic 8.6 focus policy keeps single-click focus, excludes interactive descendants, and disposes idempotently', () => withDocument(({ FakeElement }) => {
  const root = new FakeElement('section');
  const dispose = bindWidgetFocusPolicy(root);
  root.dispatch('click', { detail: 1, button: 0 });
  assert.equal(root.focusCalls.length, 1);
  const interactive = { closest: selector => selector.includes('button') ? {} : null };
  root.dispatch('click', { detail: 1, button: 0, target: interactive });
  root.dispatch('click', { detail: 2, button: 0 });
  assert.equal(root.focusCalls.length, 1);
  dispose();
  dispose();
  root.dispatch('click', { detail: 1, button: 0 });
  assert.equal(root.focusCalls.length, 1);
}));

test('Atomic 8.6 source open delegates descriptor and anchor geometry through the existing controller port', () => withDocument(({ FakeElement }) => {
  const view = {};
  const openCalls = [];
  const binding = mountClassicHybridSourceEditControllerPort(view, createSourceController(openCalls));
  const anchor = new FakeElement('section');
  anchor.dataset.hybridBlockType = 'custom-kind';
  anchor.rect = { top: 25.5, height: 48 };
  openWidgetSource(view, { from: 2, to: 8 }, anchor);
  assert.equal(openCalls.length, 1);
  assert.deepEqual(openCalls[0][0], { from: 2, to: 8, componentType: 'custom-kind' });
  assert.deepEqual(openCalls[0][1], { anchorRect: { top: 25.5, height: 48 } });
  binding.destroy();
}));

test('Atomic 8.6 source action composes focus, strict double activation, keyboard activation, and exact teardown without component policy', () => withDocument(({ FakeElement }) => {
  const view = {};
  const openCalls = [];
  const openReasons = [];
  const binding = mountClassicHybridSourceEditControllerPort(view, createSourceController(openCalls));
  const root = new FakeElement('section');
  root.dataset.hybridBlockType = 'custom-kind';
  const dispose = bindWidgetSourceAction(root, view, { from: 10, to: 20 }, {
    title: '源码动作',
    onOpen: (trigger, gesture) => openReasons.push([trigger, gesture.reason])
  });
  assert.equal(root.title, '源码动作');
  assert.equal(root.tabIndex, 0);

  root.dispatch('click', { detail: 1, button: 0, timeStamp: 100, clientX: 4, clientY: 6 });
  root.dispatch('click', { detail: 2, button: 0, timeStamp: 160, clientX: 5, clientY: 6 });
  assert.equal(root.focusCalls.length, 1);
  assert.equal(openCalls.length, 1);
  assert.deepEqual(openReasons, [['doubleclick', 'accepted']]);

  const keydown = root.dispatch('keydown', { key: 'F2' });
  assert.equal(keydown.defaultPrevented, true);
  assert.equal(openCalls.length, 2);

  dispose();
  dispose();
  root.dispatch('click', { detail: 1, button: 0, timeStamp: 300, clientX: 1, clientY: 1 });
  root.dispatch('click', { detail: 2, button: 0, timeStamp: 340, clientX: 1, clientY: 1 });
  root.dispatch('keydown', { key: 'F2' });
  assert.equal(openCalls.length, 2);
  binding.destroy();
}));
