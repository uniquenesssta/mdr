import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionFeedbackGuard } from '../src/features/sync/index.js';
import { createSelectionSyncController } from '../src/sync/selection-controller.js';

function createTimers() {
  let nextId = 1;
  const callbacks = new Map();
  const active = new Set();
  return {
    set(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      active.add(id);
      return id;
    },
    clear(id) { active.delete(id); },
    activeCount() { return active.size; },
    activeIds() { return [...active]; },
    flush(id = this.activeIds()[0]) {
      if (!id || !active.has(id)) return;
      active.delete(id);
      callbacks.get(id)?.();
    },
    flushAll() { for (const id of [...active]) this.flush(id); },
    force(id) { callbacks.get(id)?.(); }
  };
}

function createFrames() {
  let nextId = 1;
  const callbacks = new Map();
  const active = new Set();
  return {
    request(callback) { const id = nextId++; callbacks.set(id, callback); active.add(id); return id; },
    cancel(id) { active.delete(id); },
    activeCount() { return active.size; },
    flushAll(limit = 20) {
      while (active.size && limit-- > 0) {
        const [id] = active;
        active.delete(id);
        callbacks.get(id)?.();
      }
    }
  };
}

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, event = {}) { for (const listener of [...(this.listeners.get(type) || [])]) listener(event); }
}

function createPreviewReader(snapshot) {
  let subscriber = null;
  return {
    read: () => snapshot,
    subscribe(callback) { subscriber = callback; return () => { if (subscriber === callback) subscriber = null; }; },
    start() {},
    stop() {},
    emit(event) { subscriber?.(event); }
  };
}

function installControllerGlobals(frames, documentRef) {
  const previous = new Map();
  const values = {
    requestAnimationFrame: callback => frames.request(callback),
    cancelAnimationFrame: frameId => frames.cancel(frameId),
    document: documentRef,
    performance: { now: () => 100 },
    window: {
      markdownEditorDocumentModel: { getState: () => ({ version: 7 }) },
      markdownEditorPerf: { record() {}, diagnostic() {} }
    }
  };
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(globalThis, key) ? globalThis[key] : undefined);
    globalThis[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  };
}

test('R9-08 Feedback Guard begins immutable sequence/source/revision transactions and validates sources', () => {
  const guard = createSelectionFeedbackGuard();
  const token = guard.begin('editor');
  assert.deepEqual(token, { sequence: 1, source: 'editor', revision: 0 });
  assert.equal(Object.isFrozen(token), true);
  assert.deepEqual(guard.getState(), { sequence: 1, source: 'editor', revision: 0, active: true, destroyed: false });
  assert.throws(() => guard.begin('other'), /editor or preview/);
  guard.destroy();
});

test('R9-08 Feedback Guard blocks opposite-side feedback and optional same-source reentrancy without one boolean lock', () => {
  const guard = createSelectionFeedbackGuard();
  guard.begin('preview');
  assert.equal(guard.shouldIgnore('editor', { allowSource: true }), true);
  assert.equal(guard.shouldIgnore('preview', { allowSource: true }), false);
  assert.equal(guard.shouldIgnore('preview'), true);
  guard.destroy();
});

test('R9-08 Feedback Guard revision invalidates stale events while preserving an active source across preview replacement', () => {
  const guard = createSelectionFeedbackGuard();
  guard.begin('editor');
  assert.equal(guard.advanceRevision(), 1);
  assert.equal(guard.shouldIgnore('preview', { revision: 0, allowSource: true }), true);
  assert.equal(guard.shouldIgnore('preview', { revision: 1, allowSource: true }), true);
  assert.equal(guard.shouldIgnore('editor', { revision: 1, allowSource: true }), false);
  assert.deepEqual(guard.getState(), { sequence: 1, source: 'editor', revision: 1, active: true, destroyed: false });
  guard.destroy();
});

test('R9-08 Feedback Guard sequence prevents a stale release callback from unlocking a newer transaction', () => {
  const timers = createTimers();
  const guard = createSelectionFeedbackGuard({ setTimer: callback => timers.set(callback), clearTimer: id => timers.clear(id) });
  const first = guard.begin('preview');
  guard.release(first, 96);
  const [staleTimer] = timers.activeIds();
  const second = guard.begin('preview');
  assert.equal(second.sequence, 2);
  timers.force(staleTimer);
  assert.equal(guard.getState().source, 'preview');
  guard.release(second, 0);
  assert.equal(guard.getState().source, '');
  guard.destroy();
});

test('R9-08 Feedback Guard reset cancels release work and stale forced callbacks cannot republish authority', () => {
  const timers = createTimers();
  const guard = createSelectionFeedbackGuard({ setTimer: callback => timers.set(callback), clearTimer: id => timers.clear(id) });
  const token = guard.begin('editor');
  guard.release(token, 32);
  const [staleTimer] = timers.activeIds();
  guard.reset();
  assert.equal(timers.activeCount(), 0);
  assert.equal(guard.getState().source, '');
  const next = guard.begin('preview');
  timers.force(staleTimer);
  assert.equal(guard.getState().source, 'preview');
  assert.ok(next.sequence > token.sequence);
  guard.destroy();
});

test('R9-08 Feedback Guard destroy is terminal idempotent and fail-safe for late feedback reads', () => {
  const guard = createSelectionFeedbackGuard();
  guard.begin('editor');
  guard.destroy();
  guard.destroy();
  assert.equal(guard.shouldIgnore('preview'), true);
  assert.equal(guard.getState().destroyed, true);
  assert.equal(guard.getState().source, '');
  assert.throws(() => guard.begin('editor'), /destroyed/);
  assert.throws(() => guard.advanceRevision(), /destroyed/);
});

test('R9-08 SelectionSyncController uses the shared Guard to reject editor feedback during preview-to-editor settlement', () => {
  const timers = createTimers();
  const frames = createFrames();
  const editor = new FakeTarget();
  const preview = new FakeTarget();
  const documentRef = new FakeTarget();
  const restore = installControllerGlobals(frames, documentRef);
  const guard = createSelectionFeedbackGuard({ setTimer: callback => timers.set(callback), clearTimer: id => timers.clear(id) });
  const editorReader = { read: () => ({ from: 2, to: 6, isCollapsed: false }) };
  const previewSnapshot = Object.freeze({ text: 'abcd', anchorOffset: 0, focusOffset: 4 });
  const previewReader = createPreviewReader(previewSnapshot);
  const controller = createSelectionSyncController(editor, preview, {
    editorSelectionReader: editorReader,
    previewSelectionReader: previewReader,
    feedbackGuard: guard
  }).configure({ syncPreviewToEditor: () => ({ status: 'mapped', selectionLength: 4 }) });
  try {
    controller.start();
    controller.runPreview('test-preview', true, previewSnapshot, true);
    assert.equal(guard.getState().source, 'preview');
    editor.emit('select');
    assert.equal(frames.activeCount(), 0);
    assert.equal(controller.getState().ignoredFeedbackEvents, 1);
    timers.flushAll();
    editor.emit('select');
    assert.equal(frames.activeCount(), 1);
  } finally {
    controller.stop();
    guard.destroy();
    restore();
  }
});

test('R9-08 SelectionSyncController exposes compatibility applyingSide/previewRevision from Guard state instead of owning duplicates', () => {
  const guard = createSelectionFeedbackGuard();
  const editor = new FakeTarget();
  const preview = new FakeTarget();
  const editorReader = { read: () => ({ from: 1, to: 2, isCollapsed: false }) };
  const previewReader = createPreviewReader(null);
  const controller = createSelectionSyncController(editor, preview, {
    editorSelectionReader: editorReader,
    previewSelectionReader: previewReader,
    feedbackGuard: guard
  });
  const token = guard.begin('editor');
  controller.notifyPreviewMounted();
  assert.equal(controller.getState().applyingSide, 'editor');
  assert.equal(controller.getState().previewRevision, 1);
  guard.release(token, 0);
  assert.equal(controller.getState().applyingSide, '');
  guard.destroy();
});
