import test from 'node:test';
import assert from 'node:assert/strict';
import { WidgetType } from '@codemirror/view';

import {
  createCodeBlockDirectEditor,
  getNormalizedCodeLanguage,
  highlightCode
} from '../src/features/hybrid-editor/index.js';
import { buildCodeBlockWriteback } from '../src/features/hybrid-editor/widgets/code-block/code-block-direct-editor.js';
import { copyCodeBlockText } from '../src/features/hybrid-editor/widgets/code-block/code-block-actions.js';

class FakeDocument {
  constructor() {
    this.listeners = new Map();
  }
  createElement(tagName) {
    if (String(tagName).toLowerCase() !== 'textarea') throw new Error(`unexpected element ${tagName}`);
    return new FakeTextarea(this);
  }
  addEventListener(type, listener) {
    const set = this.listeners.get(type) || new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }
}

class FakeTextarea {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.value = '';
    this.className = '';
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.rows = 0;
    this.isConnected = true;
    this.spellcheck = true;
    this.autocomplete = '';
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  dispatch(type, overrides = {}) {
    const event = {
      type,
      target: this,
      key: '',
      ctrlKey: false,
      metaKey: false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...overrides
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  blur() { this.dispatch('blur'); }
  focus() {}
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  setRangeText(text, start, end) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.selectionStart = this.selectionEnd = start + text.length;
  }
  dispatchEvent(event) { this.dispatch(event.type, event); return true; }
}

function createHarness({ length = 200, descriptor = {}, onFailure, onClose } = {}) {
  const documentRef = new FakeDocument();
  const dispatches = [];
  const view = {
    state: { doc: { length } },
    dispatch(transaction) { dispatches.push(transaction); }
  };
  const editor = createCodeBlockDirectEditor(view, {
    from: 10,
    to: 30,
    language: 'js',
    code: 'const x = 1;',
    writebackMode: 'fenced',
    fenceCharacter: '`',
    fenceLength: 3,
    infoRaw: 'js',
    ...descriptor
  }, {
    documentRef,
    createHistoryAnnotation: () => 'isolated-history',
    onFailure,
    onClose
  });
  return { documentRef, dispatches, view, editor };
}

test('Atomic 8.8 keeps code language normalization and tokenization behavior behind the public entry', () => {
  assert.equal(getNormalizedCodeLanguage('language-TypeScript'), 'ts');
  const lines = highlightCode('const value = 42;', 'javascript');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].number, 1);
  assert.equal(lines[0].tokens.some(token => token.className === 'keyword' && token.text === 'const'), true);
  assert.equal(lines[0].tokens.some(token => token.className === 'number' && token.text === '42'), true);
});

test('Atomic 8.8 fence-safe writeback grows a backtick fence beyond embedded line-leading runs', () => {
  const result = buildCodeBlockWriteback({
    writebackMode: 'fenced', fenceCharacter: '`', fenceLength: 3, infoRaw: ' js '
  }, 'alpha\n```danger\nomega');
  assert.equal(result, '````js\nalpha\n```danger\nomega\n````');
});

test('Atomic 8.8 preserves tilde fence and indented writeback semantics', () => {
  assert.equal(buildCodeBlockWriteback({
    writebackMode: 'fenced', fenceCharacter: '~', fenceLength: 4, infoRaw: 'txt'
  }, '~~~nested'), '~~~~txt\n~~~nested\n~~~~');
  assert.equal(buildCodeBlockWriteback({ writebackMode: 'indented' }, 'a\n\nb'), '    a\n\n    b');
});

test('Atomic 8.8 direct edit commits one transaction with isolated history and returns the edited source descriptor', () => {
  const closed = [];
  const { editor, dispatches } = createHarness({ onClose: result => closed.push(result) });
  editor.value = 'let answer = 42;';
  const descriptor = editor.__markdownEditorCommitCodeBlock();
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].annotations, 'isolated-history');
  assert.equal(dispatches[0].changes.from, 10);
  assert.equal(dispatches[0].changes.to, 30);
  assert.equal(dispatches[0].changes.insert, '```js\nlet answer = 42;\n```');
  assert.deepEqual(descriptor, { from: 10, to: 36, editFrom: 16, editTo: 32, preferredPosition: 16 });
  assert.equal(editor.__markdownEditorCommitCodeBlock(), false);
  assert.equal(dispatches.length, 1);
  assert.equal(closed.length, 0);
});

test('Atomic 8.8 direct edit rejects stale ranges without dispatching and reports the preserved failure', () => {
  const failures = [];
  const { editor, dispatches } = createHarness({
    length: 20,
    descriptor: { from: 10, to: 30 },
    onFailure: (error, details) => failures.push({ error, details })
  });
  editor.value = 'changed';
  assert.equal(editor.__markdownEditorCommitCodeBlock(), false);
  assert.equal(dispatches.length, 0);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].error.message, '代码块范围已经失效');
  assert.deepEqual(failures[0].details, { from: 10, to: 30, documentLength: 20 });
});

test('Atomic 8.8 Escape cancels direct editing, restores the original value and dispatches nothing', () => {
  const closed = [];
  const { editor, dispatches } = createHarness({ onClose: result => closed.push(result) });
  editor.value = 'temporary change';
  const event = editor.dispatch('keydown', { key: 'Escape' });
  assert.equal(event.defaultPrevented, true);
  assert.equal(editor.value, 'const x = 1;');
  assert.equal(dispatches.length, 0);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].reason, 'cancelled');
  assert.equal(closed[0].descriptor, null);
});

test('Atomic 8.8 Ctrl/Cmd+Enter commits and closes once without a duplicate blur transaction', () => {
  const closed = [];
  const { editor, dispatches } = createHarness({ onClose: result => closed.push(result) });
  editor.value = 'updated';
  const event = editor.dispatch('keydown', { key: 'Enter', ctrlKey: true });
  assert.equal(event.defaultPrevented, true);
  assert.equal(dispatches.length, 1);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].reason, 'committed');
  editor.blur();
  assert.equal(dispatches.length, 1);
  assert.equal(closed.length, 1);
});

test('Atomic 8.8 direct-editor destroy removes its Session-owned document listener and cannot publish a late close', () => {
  const closed = [];
  const { editor, documentRef, dispatches } = createHarness({ onClose: result => closed.push(result) });
  assert.equal(documentRef.listenerCount('pointerdown'), 1);
  editor.value = 'changed after destroy';
  editor.__markdownEditorDestroyCodeBlock();
  assert.equal(documentRef.listenerCount('pointerdown'), 0);
  editor.blur();
  assert.equal(dispatches.length, 0);
  assert.equal(closed.length, 0);
});

test('Atomic 8.8 Code Block copy uses the provided clipboard capability without DOM fallback', async () => {
  const writes = [];
  await copyCodeBlockText('copy me', {
    navigatorRef: { clipboard: { async writeText(value) { writes.push(value); } } }
  });
  assert.deepEqual(writes, ['copy me']);
});
