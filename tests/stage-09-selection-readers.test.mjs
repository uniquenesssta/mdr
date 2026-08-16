import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEditorSelectionReader,
  createPreviewSelectionReader
} from '../src/features/sync/index.js';

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.members = new Set();
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }
  contains(node) { return this.members.has(node); }
}

function createFrames() {
  let nextId = 1;
  const callbacks = new Map();
  const active = new Set();
  return {
    request(callback) { const id = nextId++; callbacks.set(id, callback); active.add(id); return id; },
    cancel(id) { active.delete(id); },
    activeCount() { return active.size; },
    activeIds() { return [...active]; },
    flushOne() {
      const [id] = active;
      if (!id) return;
      active.delete(id);
      callbacks.get(id)?.();
    },
    flushAll(limit = 20) { while (active.size && limit-- > 0) this.flushOne(); },
    force(id) { callbacks.get(id)?.(); }
  };
}

function previewHarness() {
  const preview = new FakeTarget();
  const documentRef = new FakeTarget();
  const frames = createFrames();
  const anchorNode = { id: 'anchor' };
  const focusNode = { id: 'focus' };
  preview.members.add(anchorNode);
  preview.members.add(focusNode);
  let selection = null;
  const reader = createPreviewSelectionReader({
    previewElement: preview,
    documentRef,
    getSelection: () => selection,
    requestFrame: callback => frames.request(callback),
    cancelFrame: id => frames.cancel(id)
  });
  const makeSelection = ({ text = 'hello', collapsed = false, anchorOffset = 1, focusOffset = 4 } = {}) => {
    const range = {
      startContainer: anchorNode,
      startOffset: anchorOffset,
      endContainer: focusNode,
      endOffset: focusOffset,
      cloneRange() { return { ...this, cloneRange: this.cloneRange }; }
    };
    return {
      anchorNode,
      anchorOffset,
      focusNode,
      focusOffset,
      isCollapsed: collapsed,
      rangeCount: 1,
      toString: () => text,
      getRangeAt: () => range
    };
  };
  return { preview, documentRef, frames, reader, makeSelection, setSelection(value) { selection = value; } };
}

test('R9-07 EditorSelectionReader requires neutral editor selection capability and returns immutable normalized final boundaries', () => {
  assert.throws(() => createEditorSelectionReader({ editorApi: {} }), /getSelection/);
  const reader = createEditorSelectionReader({
    editorApi: { getSelection: () => ({ anchor: 9, head: 3, from: 3, to: 9 }) }
  });
  const snapshot = reader.read();
  assert.deepEqual(snapshot, { anchor: 9, head: 3, from: 3, to: 9, isCollapsed: false });
  assert.equal(Object.isFrozen(snapshot), true);
  reader.destroy();
  reader.destroy();
  assert.throws(() => reader.read(), /destroyed/);
});

test('R9-07 EditorSelectionReader normalizes invalid/collapsed offsets without document or DOM reads', () => {
  const reader = createEditorSelectionReader({ editorApi: { getSelection: () => ({ anchor: -2, head: 'bad', from: 0, to: 0 }) } });
  assert.deepEqual(reader.read(), { anchor: 0, head: 0, from: 0, to: 0, isCollapsed: true });
  reader.destroy();
});

test('R9-07 PreviewSelectionReader rejects missing collapsed blank and outside-preview selections', () => {
  const h = previewHarness();
  try {
    assert.equal(h.reader.read(), null);
    h.setSelection(h.makeSelection({ collapsed: true }));
    assert.equal(h.reader.read(), null);
    h.setSelection(h.makeSelection({ text: '   ' }));
    assert.equal(h.reader.read(), null);
    const outside = h.makeSelection();
    outside.focusNode = { id: 'outside' };
    h.setSelection(outside);
    assert.equal(h.reader.read(), null);
  } finally { h.reader.destroy(); }
});

test('R9-07 PreviewSelectionReader returns immutable final boundary snapshot with a cloned stable range', () => {
  const h = previewHarness();
  try {
    const nativeSelection = h.makeSelection({ text: 'stable', anchorOffset: 2, focusOffset: 5 });
    h.setSelection(nativeSelection);
    const snapshot = h.reader.read();
    assert.equal(snapshot.text, 'stable');
    assert.equal(snapshot.anchorOffset, 2);
    assert.equal(snapshot.focusOffset, 5);
    assert.equal(snapshot.isCollapsed, false);
    assert.notEqual(snapshot.range, nativeSelection.getRangeAt(0));
    assert.equal(Object.isFrozen(snapshot), true);
  } finally { h.reader.destroy(); }
});

test('R9-07 PreviewSelectionReader waits through pointer selection and publishes one two-frame final snapshot on pointerup', () => {
  const h = previewHarness();
  const events = [];
  try {
    h.reader.subscribe(event => events.push(event));
    h.reader.start();
    h.setSelection(h.makeSelection({ text: 'dragging', focusOffset: 3 }));
    h.preview.emit('pointerdown');
    h.documentRef.emit('selectionchange');
    h.documentRef.emit('selectionchange');
    assert.equal(h.frames.activeCount(), 0);
    h.setSelection(h.makeSelection({ text: 'final', focusOffset: 8 }));
    h.documentRef.emit('pointerup');
    assert.equal(h.frames.activeCount(), 1);
    h.frames.flushOne();
    assert.equal(events.length, 0);
    h.frames.flushOne();
    assert.equal(events.length, 1);
    assert.equal(events[0].reason, 'preview-pointerup');
    assert.equal(events[0].force, true);
    assert.equal(events[0].snapshot.text, 'final');
  } finally { h.reader.destroy(); }
});

test('R9-07 PreviewSelectionReader coalesces stable selectionchange work and stale cancelled callbacks cannot publish', () => {
  const h = previewHarness();
  const events = [];
  try {
    h.reader.subscribe(event => events.push(event));
    h.reader.start();
    h.setSelection(h.makeSelection({ text: 'first' }));
    h.documentRef.emit('selectionchange');
    const [stale] = h.frames.activeIds();
    h.setSelection(h.makeSelection({ text: 'latest', focusOffset: 7 }));
    h.documentRef.emit('selectionchange');
    assert.equal(h.frames.activeCount(), 1);
    h.frames.force(stale);
    assert.equal(events.length, 0);
    h.frames.flushAll();
    assert.equal(events.length, 1);
    assert.equal(events[0].reason, 'document-selectionchange');
    assert.equal(events[0].snapshot.text, 'latest');
  } finally { h.reader.destroy(); }
});

test('R9-07 PreviewSelectionReader stop/destroy remove every listener cancel pending work and remain terminal/idempotent', () => {
  const h = previewHarness();
  const events = [];
  h.reader.subscribe(event => events.push(event));
  h.reader.start();
  h.setSelection(h.makeSelection());
  h.documentRef.emit('selectionchange');
  const stale = h.frames.activeIds()[0];
  h.reader.stop();
  assert.equal(h.frames.activeCount(), 0);
  for (const target of [h.preview, h.documentRef]) {
    for (const listeners of target.listeners.values()) assert.equal(listeners.size, 0);
  }
  h.frames.force(stale);
  assert.equal(events.length, 0);
  h.reader.destroy();
  h.reader.destroy();
  assert.equal(h.reader.read(), null);
  assert.throws(() => h.reader.start(), /destroyed/);
});
