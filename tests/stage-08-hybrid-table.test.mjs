import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeTableCell } from '../src/model-kernel/index.js';
import { createTableCellEditor } from '../src/features/hybrid-editor/widgets/table/table-cell-editor.js';
import { writeTableCellValue } from '../src/features/hybrid-editor/widgets/table/table-writeback.js';

class FakeDocument {
  constructor() {
    this.listeners = new Map();
  }
  createElement(tagName) {
    if (String(tagName).toLowerCase() !== 'input') throw new Error(`unexpected element ${tagName}`);
    return new FakeInput(this);
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
  querySelector() { return null; }
}

class FakeInput {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.value = '';
    this.className = '';
    this.type = '';
    this.title = '';
    this.disabled = false;
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
      shiftKey: false,
      relatedTarget: null,
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
  focus() { this.dispatch('focus'); }
  select() { this.selected = true; }
  contains(target) { return target === this; }
}

function createEditorHarness(overrides = {}) {
  const documentRef = new FakeDocument();
  const dispatches = [];
  const scheduled = [];
  const closed = [];
  const failures = [];
  const view = {
    state: { doc: { length: overrides.documentLength ?? 100 } },
    dispatch(transaction) { dispatches.push(transaction); }
  };
  const descriptor = {
    cell: { value: 'A', from: 10, to: 11 },
    cellKey: '1:1',
    tableFrom: 2,
    rowIndex: 1,
    columnIndex: 1,
    rowCount: 3,
    columnCount: 3,
    ariaLabel: '第 1 行第 2 列',
    ...overrides.descriptor
  };
  const input = createTableCellEditor(view, descriptor, {
    documentRef,
    encodeTableCell,
    createHistoryAnnotation: () => 'isolated-history',
    scheduleCellEdit: (tableFrom, cellKey) => scheduled.push({ tableFrom, cellKey }),
    onFailure: (error, details) => failures.push({ error, details }),
    onClose: result => closed.push(result)
  });
  return { documentRef, dispatches, scheduled, closed, failures, view, descriptor, input };
}

function assertNavigation(key, shiftKey, expectedKey) {
  const { input, scheduled, dispatches } = createEditorHarness();
  const event = input.dispatch('keydown', { key, shiftKey });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(scheduled, expectedKey ? [{ tableFrom: 2, cellKey: expectedKey }] : []);
  assert.equal(dispatches.length, 0);
}

test('Atomic 8.9 Tab moves to the next cell and wraps across the row boundary', () => {
  const harness = createEditorHarness({ descriptor: { rowIndex: 1, columnIndex: 2 } });
  const event = harness.input.dispatch('keydown', { key: 'Tab' });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(harness.scheduled, [{ tableFrom: 2, cellKey: '2:0' }]);
});

test('Atomic 8.9 Shift+Tab moves to the previous cell', () => {
  assertNavigation('Tab', true, '1:0');
});

test('Atomic 8.9 Enter moves down in the same column', () => {
  assertNavigation('Enter', false, '2:1');
});

test('Atomic 8.9 Shift+Enter moves up in the same column', () => {
  assertNavigation('Enter', true, '0:1');
});

test('Atomic 8.9 cell writeback uses the frozen encoder and exactly one isolated editor transaction', () => {
  const dispatches = [];
  const interactions = [];
  const view = { state: { doc: { length: 40 } }, dispatch: transaction => dispatches.push(transaction) };
  const result = writeTableCellValue(view, {
    cell: { value: 'old', from: 5, to: 8 }, tableFrom: 0, rowIndex: 0, columnIndex: 0
  }, 'a|b\nc', 'old', {
    encodeTableCell,
    createHistoryAnnotation: () => 'isolated-history',
    recordInteraction: (operation, details) => interactions.push({ operation, details })
  });
  assert.equal(result.changed, true);
  assert.equal(result.failed, false);
  assert.equal(result.insert, 'a\\|b c');
  assert.deepEqual(dispatches, [{
    changes: { from: 5, to: 8, insert: 'a\\|b c' },
    annotations: 'isolated-history'
  }]);
  assert.equal(interactions[0].operation, 'hybrid.table-cell-edit-commit');
});

test('Atomic 8.9 unchanged cells and stale ranges never dispatch', () => {
  const dispatches = [];
  const failures = [];
  const view = { state: { doc: { length: 10 } }, dispatch: transaction => dispatches.push(transaction) };
  const unchanged = writeTableCellValue(view, {
    cell: { value: 'same', from: 1, to: 5 }, tableFrom: 0, rowIndex: 0, columnIndex: 0
  }, 'same', 'same', { encodeTableCell });
  const stale = writeTableCellValue(view, {
    cell: { value: 'old', from: 8, to: 20 }, tableFrom: 0, rowIndex: 0, columnIndex: 0
  }, 'changed', 'old', {
    encodeTableCell,
    onFailure: (error, details) => failures.push({ error, details })
  });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.failed, false);
  assert.equal(stale.changed, false);
  assert.equal(stale.failed, true);
  assert.equal(dispatches.length, 0);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].error.message, '表格单元格范围已经失效');
});

test('Atomic 8.9 Escape cancels a direct cell edit, restores source value and dispatches nothing', () => {
  const { input, dispatches, closed, documentRef } = createEditorHarness();
  assert.equal(documentRef.listenerCount('pointerdown'), 1);
  input.value = 'temporary';
  const event = input.dispatch('keydown', { key: 'Escape' });
  assert.equal(event.defaultPrevented, true);
  assert.equal(input.value, 'A');
  assert.equal(dispatches.length, 0);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].reason, 'cancelled');
  assert.equal(documentRef.listenerCount('pointerdown'), 0);
});

test('Atomic 8.9 cell-editor destroy removes its Session-owned document listener and cannot publish a late close', () => {
  const { input, dispatches, closed, documentRef } = createEditorHarness();
  assert.equal(documentRef.listenerCount('pointerdown'), 1);
  input.value = 'changed after destroy';
  input.__markdownEditorDestroyTableCell();
  assert.equal(documentRef.listenerCount('pointerdown'), 0);
  input.blur();
  assert.equal(dispatches.length, 0);
  assert.equal(closed.length, 0);
});

test('Atomic 8.9 missing cells stay disabled and require source editing instead of inventing a writeback range', () => {
  const { input, documentRef } = createEditorHarness({ descriptor: { cell: null, cellKey: '2:2' } });
  assert.equal(input.disabled, true);
  assert.match(input.title, /编辑源码/);
  assert.equal(documentRef.listenerCount('pointerdown'), 0);
  assert.equal(typeof input.__markdownEditorCommitTableCell, 'undefined');
});
