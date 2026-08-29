import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInlineMathWidgetType,
  createMathBlockWidgetType
} from '../src/features/hybrid-editor/index.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { for (const value of values) this.values.add(value); }
  remove(...values) { for (const value of values) this.values.delete(value); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : Boolean(force);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || '').toUpperCase();
    this.ownerDocument = ownerDocument;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
    this.classList = new FakeClassList();
    this.className = '';
    this.textContent = '';
    this.title = '';
    this.tabIndex = -1;
    this.type = '';
    this.isConnected = true;
  }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter(item => item !== listener));
  }
  listenerCount(type) { return (this.listeners.get(type) || []).length; }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(...children) { for (const child of children) this.appendChild(child); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  closest() { return null; }
  focus() {}
  getBoundingClientRect() { return { top: 0, height: 20, width: 100 }; }
}

class FakeDocument {
  constructor() {
    this.defaultView = { Element: FakeElement };
  }
  createElement(tagName) { return new FakeElement(tagName, this); }
}

class FakeWidgetType {}

function withFakeDom(callback) {
  const previousDocument = globalThis.document;
  const previousElement = globalThis.Element;
  const documentRef = new FakeDocument();
  globalThis.document = documentRef;
  globalThis.Element = FakeElement;
  try {
    return callback(documentRef);
  } finally {
    globalThis.document = previousDocument;
    globalThis.Element = previousElement;
  }
}

function createView(documentRef) {
  return {
    dom: new FakeElement('div', documentRef),
    destroyed: false
  };
}

test('Atomic 8.11 exposes separate inline and block Math factories and requires an injected presentation renderer', () => {
  assert.equal(typeof createInlineMathWidgetType, 'function');
  assert.equal(typeof createMathBlockWidgetType, 'function');
  assert.throws(() => createInlineMathWidgetType(FakeWidgetType), /renderer/);
  assert.throws(() => createMathBlockWidgetType(FakeWidgetType), /renderer/);
});

test('Atomic 8.11 inline Math preserves dollar and backslash-parenthesis delimiter identity', () => {
  const InlineMathWidget = createInlineMathWidgetType(FakeWidgetType, { renderFormula() {} });
  const dollar = new InlineMathWidget({ from: 1, to: 6, contentFrom: 2, contentTo: 5, formula: 'x+1' });
  const paren = new InlineMathWidget({ from: 1, to: 8, contentFrom: 3, contentTo: 6, formula: 'x+1', delimiter: '\\(' });
  assert.equal(dollar.delimiter, '$');
  assert.equal(paren.delimiter, '\\(');
  assert.equal(dollar.eq(paren), false);
  assert.equal(paren.eq(new InlineMathWidget({ from: 1, to: 8, contentFrom: 3, contentTo: 6, formula: 'x+1', delimiter: '\\(' })), true);
});

test('Atomic 8.11 inline Math reuses the presentation renderer in inline mode and preserves render-error fallback semantics', () => withFakeDom(documentRef => {
  const renders = [];
  const failures = [];
  const InlineMathWidget = createInlineMathWidgetType(FakeWidgetType, {
    renderFormula(element, formula, options) {
      renders.push({ element, formula, options });
      element.textContent = formula;
      element.title = 'parse error';
      element.classList.add('is-error');
      options.onError(new Error('parse error'));
      return { ok: false };
    },
    reportRenderFailure: (error, details) => failures.push({ error, details })
  });
  const widget = new InlineMathWidget({ from: 10, to: 15, contentFrom: 11, contentTo: 14, formula: 'x+' });
  const span = widget.toDOM(createView(documentRef));
  assert.equal(renders.length, 1);
  assert.equal(renders[0].formula, 'x+');
  assert.equal(renders[0].options.displayMode, false);
  assert.equal(renders[0].options.fallbackToSource, true);
  assert.equal(renders[0].options.errorClass, 'is-error');
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0].details, { displayMode: false });
  assert.equal(span.title, '双击编辑公式源码；双击编辑源码');
}));

test('Atomic 8.11 inline Math destroy removes source-action listeners idempotently', () => withFakeDom(documentRef => {
  const InlineMathWidget = createInlineMathWidgetType(FakeWidgetType, { renderFormula() { return { ok: true }; } });
  const widget = new InlineMathWidget({ from: 0, to: 3, contentFrom: 1, contentTo: 2, formula: 'x' });
  const span = widget.toDOM(createView(documentRef));
  assert.equal(span.listenerCount('click') >= 2, true);
  assert.equal(span.listenerCount('dblclick'), 1);
  assert.equal(span.listenerCount('keydown'), 1);
  widget.destroy(span);
  widget.destroy(span);
  assert.equal(span.listenerCount('click'), 0);
  assert.equal(span.listenerCount('dblclick'), 0);
  assert.equal(span.listenerCount('keydown'), 0);
}));

test('Atomic 8.11 block Math preserves display delimiters and renders through the presentation API in display mode', () => withFakeDom(documentRef => {
  const renders = [];
  const MathBlockWidget = createMathBlockWidgetType(FakeWidgetType, {
    renderFormula(element, formula, options) {
      renders.push({ element, formula, options });
      return { ok: true };
    }
  });
  const dollars = new MathBlockWidget({ from: 0, to: 8, contentFrom: 2, contentTo: 6, formula: 'x^2', fingerprint: '$$x^2$$' });
  const brackets = new MathBlockWidget({ from: 0, to: 8, contentFrom: 2, contentTo: 6, formula: 'x^2', delimiter: '\\[', fingerprint: '\\[x^2\\]' });
  assert.equal(dollars.delimiter, '$$');
  assert.equal(brackets.delimiter, '\\[');
  assert.equal(dollars.eq(brackets), false);
  const section = brackets.toDOM(createView(documentRef));
  assert.equal(renders.length, 1);
  assert.equal(renders[0].formula, 'x^2');
  assert.equal(renders[0].options.displayMode, true);
  assert.equal(section.dataset.hybridBlockType, 'math');
}));

test('Atomic 8.11 block Math reports display render failures and destroys source/lifecycle bindings idempotently', () => withFakeDom(documentRef => {
  const failures = [];
  const MathBlockWidget = createMathBlockWidgetType(FakeWidgetType, {
    renderFormula(element, formula, options) {
      options.onError(new Error('bad block math'));
      return { ok: false };
    },
    reportRenderFailure: (error, details) => failures.push({ error, details })
  });
  const widget = new MathBlockWidget({ from: 2, to: 10, contentFrom: 4, contentTo: 8, formula: 'bad', delimiter: '$$', fingerprint: '$$bad$$' });
  const section = widget.toDOM(createView(documentRef));
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0].details, { displayMode: true });
  assert.equal(section.listenerCount('click') >= 2, true);
  assert.equal(section.listenerCount('dblclick'), 1);
  assert.equal(section.listenerCount('keydown'), 1);
  widget.destroy(section);
  widget.destroy(section);
  assert.equal(section.listenerCount('click'), 0);
  assert.equal(section.listenerCount('dblclick'), 0);
  assert.equal(section.listenerCount('keydown'), 0);
}));
