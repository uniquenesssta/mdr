import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScrollSourceOwnership,
  createScrollSyncController
} from '../src/features/sync/index.js';

class FakeElement {
  constructor({ scrollHeight = 1200, clientHeight = 200, scrollTop = 0 } = {}) {
    this.scrollHeight = scrollHeight;
    this.clientHeight = clientHeight;
    this.scrollTop = scrollTop;
    this.listeners = new Map();
    this.scrollCalls = [];
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ target: this, ...event });
  }

  contains(target) {
    return target?.owner === this;
  }

  scrollTo(options) {
    this.scrollCalls.push(options);
    this.scrollTop = Number(options?.top) || 0;
  }
}

function createFrameRuntime() {
  let nextId = 1;
  const callbacks = new Map();
  const active = new Set();
  return {
    requestFrame(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      active.add(id);
      return id;
    },
    cancelFrame(id) {
      active.delete(id);
    },
    activeIds() {
      return [...active];
    },
    activeCount() {
      return active.size;
    },
    flushActive() {
      const ids = [...active];
      for (const id of ids) {
        active.delete(id);
        callbacks.get(id)?.();
      }
    },
    force(id) {
      callbacks.get(id)?.();
    }
  };
}

function createHarness() {
  let time = 0;
  const frames = createFrameRuntime();
  const ownership = createScrollSourceOwnership({ now: () => time });
  const editor = new FakeElement();
  const preview = new FakeElement();
  const controller = createScrollSyncController(editor, preview, {
    sourceOwnership: ownership,
    requestFrame: callback => frames.requestFrame(callback),
    cancelFrame: id => frames.cancelFrame(id)
  });
  return {
    frames,
    ownership,
    editor,
    preview,
    controller,
    setTime(value) { time = Number(value) || 0; },
    destroy() {
      controller.destroy();
      ownership.destroy();
    }
  };
}

test('R9-03 user source events coalesce into one cancellable mapper publication frame', () => {
  const h = createHarness();
  try {
    const calls = { editor: 0, preview: 0 };
    h.controller.configure({
      syncFromEditor: () => { calls.editor += 1; },
      syncFromPreview: () => { calls.preview += 1; }
    });
    h.editor.emit('wheel');
    h.editor.emit('scroll');
    h.editor.emit('scroll');
    assert.equal(h.frames.activeCount(), 1);
    h.frames.flushActive();
    assert.deepEqual(calls, { editor: 1, preview: 0 });

    h.preview.emit('scroll');
    h.frames.flushActive();
    assert.deepEqual(calls, { editor: 1, preview: 0 });
    assert.equal(h.controller.getState().ignoredTargetEvents, 1);
  } finally {
    h.destroy();
  }
});

test('R9-03 source takeover cancels stale source and target RAF work before publication', () => {
  const h = createHarness();
  try {
    const calls = { editor: 0, preview: 0 };
    h.controller.configure({
      syncFromEditor: () => { calls.editor += 1; },
      syncFromPreview: () => { calls.preview += 1; }
    });
    h.editor.emit('wheel');
    h.editor.emit('scroll');
    h.controller.scheduleTarget('preview', 220);
    const staleIds = h.frames.activeIds();
    assert.equal(staleIds.length, 2);

    h.preview.emit('wheel');
    assert.equal(h.frames.activeCount(), 0);
    for (const id of staleIds) h.frames.force(id);
    assert.deepEqual(calls, { editor: 0, preview: 0 });
    assert.equal(h.preview.scrollTop, 0);

    h.preview.emit('scroll');
    assert.equal(h.frames.activeCount(), 1);
    h.frames.flushActive();
    assert.deepEqual(calls, { editor: 0, preview: 1 });
  } finally {
    h.destroy();
  }
});

test('R9-03 target writes coalesce to the latest value and preserve clamp and programmatic-window semantics', () => {
  const h = createHarness();
  try {
    h.preview.scrollTop = 10;
    h.preview.scrollHeight = 1000;
    h.preview.clientHeight = 200;
    h.controller.scheduleTarget('preview', 9999, { reason: 'first' });
    h.controller.scheduleTarget('preview', 250, { reason: 'latest', settleMs: 500 });
    assert.equal(h.frames.activeCount(), 1);
    h.frames.flushActive();
    const state = h.controller.getState();
    assert.equal(h.preview.scrollTop, 250);
    assert.equal(state.targetWrites, 1);
    assert.equal(state.lastTargetSide, 'preview');
    assert.equal(state.lastTargetTop, 250);
    assert.equal(state.lastTargetDelta, 240);
    assert.equal(state.programmaticUntil.preview, 500);
  } finally {
    h.destroy();
  }
});

test('R9-03 geometry recalibration reuses the current source mapper frame and never takes source ownership', () => {
  const h = createHarness();
  try {
    let editorCalls = 0;
    h.controller.configure({ syncFromEditor: () => { editorCalls += 1; } });
    h.editor.emit('wheel');
    h.editor.emit('scroll');
    h.controller.notifyGeometryChanged('editor');
    assert.equal(h.frames.activeCount(), 1);
    h.frames.flushActive();
    assert.equal(editorCalls, 1);
    assert.equal(h.controller.getState().geometryResyncs, 1);

    h.preview.scrollTop = 20;
    assert.equal(h.controller.compensate('preview', 30, 'virtual-height'), true);
    assert.equal(h.controller.getState().sourceSide, 'editor');
    assert.equal(h.controller.getState().sourceReason, 'wheel');
    assert.equal(h.frames.activeCount(), 1);
    h.frames.flushActive();
    assert.equal(editorCalls, 2);
    assert.equal(h.controller.getState().geometryResyncs, 2);
  } finally {
    h.destroy();
  }
});

test('R9-03 syncNow invokes the configured mapper directly without allocating RAF work', () => {
  const h = createHarness();
  try {
    let calls = 0;
    h.controller.configure({ syncFromEditor: () => { calls += 1; } });
    h.editor.emit('wheel');
    h.controller.syncNow('editor');
    assert.equal(calls, 1);
    assert.equal(h.frames.activeCount(), 0);
  } finally {
    h.destroy();
  }
});

test('R9-03 destroy cancels every owned RAF, removes listeners and rejects forced late callbacks', () => {
  const h = createHarness();
  let calls = 0;
  h.controller.configure({ syncFromEditor: () => { calls += 1; } });
  h.editor.emit('wheel');
  h.editor.emit('scroll');
  h.controller.scheduleTarget('preview', 200);
  const staleIds = h.frames.activeIds();
  assert.equal(staleIds.length, 2);
  h.controller.destroy();
  h.controller.destroy();
  assert.equal(h.frames.activeCount(), 0);
  for (const element of [h.editor, h.preview]) {
    for (const listeners of element.listeners.values()) assert.equal(listeners.size, 0);
  }
  for (const id of staleIds) h.frames.force(id);
  assert.equal(calls, 0);
  assert.equal(h.preview.scrollTop, 0);
  h.ownership.destroy();
});

test('R9-03 validates explicit RAF capabilities before installing runtime listeners', () => {
  const editor = new FakeElement();
  const preview = new FakeElement();
  assert.throws(
    () => createScrollSyncController(editor, preview, { requestFrame: 123, cancelFrame() {} }),
    /requestFrame capability/
  );
  assert.throws(
    () => createScrollSyncController(editor, preview, { requestFrame() { return 1; }, cancelFrame: 123 }),
    /cancelFrame capability/
  );
  for (const element of [editor, preview]) {
    for (const listeners of element.listeners.values()) assert.equal(listeners.size, 0);
  }
});
