import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScrollGeometrySession,
  createScrollSourceOwnership,
  createScrollSyncController
} from '../src/features/sync/index.js';

class FakeElement {
  constructor({ scrollHeight = 1200, clientHeight = 200, scrollTop = 0 } = {}) {
    this.scrollHeight = scrollHeight;
    this.clientHeight = clientHeight;
    this.scrollTop = scrollTop;
    this.listeners = new Map();
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
    this.scrollTop = Number(options?.top) || 0;
  }
}

function createSessionHarness() {
  let time = 0;
  const ownership = createScrollSourceOwnership({ now: () => time });
  const tops = { editor: 100, preview: 20 };
  const writes = [];
  const schedules = [];
  const session = createScrollGeometrySession({
    sourceOwnership: ownership,
    readScrollTop: side => tops[side],
    applyScrollTop(side, top, options) {
      writes.push({ side, top, options });
      tops[side] = top;
      return true;
    },
    scheduleSourceSync(side) {
      schedules.push(side);
      return true;
    }
  });
  return {
    ownership,
    tops,
    writes,
    schedules,
    session,
    setTime(value) { time = Number(value) || 0; },
    destroy() {
      session.destroy();
      ownership.destroy();
    }
  };
}

function createFrameRuntime() {
  let nextId = 1;
  const callbacks = new Map();
  const active = new Set();
  return {
    request(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      active.add(id);
      return id;
    },
    cancel(id) { active.delete(id); },
    flush() {
      const ids = [...active];
      active.clear();
      for (const id of ids) callbacks.get(id)?.();
    },
    count() { return active.size; }
  };
}

test('R9-06 requires read-only source ownership plus explicit geometry capabilities', () => {
  assert.throws(() => createScrollGeometrySession(), /ScrollSourceOwnership/);
  const ownership = createScrollSourceOwnership({ now: () => 0 });
  try {
    assert.throws(() => createScrollGeometrySession({ sourceOwnership: ownership }), /readScrollTop/);
    assert.throws(() => createScrollGeometrySession({
      sourceOwnership: ownership,
      readScrollTop() { return 0; }
    }), /applyScrollTop/);
    assert.throws(() => createScrollGeometrySession({
      sourceOwnership: ownership,
      readScrollTop() { return 0; },
      applyScrollTop() { return false; }
    }), /scheduleSourceSync/);
  } finally {
    ownership.destroy();
  }
});

test('R9-06 geometry change without a real source schedules nothing and owns no source identity', () => {
  const h = createSessionHarness();
  try {
    assert.equal(h.session.notifyGeometryChanged('preview'), false);
    assert.deepEqual(h.schedules, []);
    assert.deepEqual(h.session.getState(), { geometryResyncs: 0 });
    assert.equal(h.ownership.getState().sourceSide, '');
  } finally {
    h.destroy();
  }
});

test('R9-06 geometry changes coalesce on the current authenticated source and count only a published resync', () => {
  const h = createSessionHarness();
  try {
    h.ownership.beginUserGesture('editor', 'wheel');
    assert.equal(h.session.notifyGeometryChanged('preview'), true);
    assert.equal(h.session.notifyGeometryChanged('editor'), true);
    assert.deepEqual(h.schedules, ['editor']);
    assert.equal(h.session.settleSourceSync('editor', { published: true }), true);
    assert.deepEqual(h.session.getState(), { geometryResyncs: 1 });
    assert.equal(h.session.settleSourceSync('editor', { published: true }), false);
    assert.deepEqual(h.session.getState(), { geometryResyncs: 1 });
    assert.equal(h.ownership.getState().sourceReason, 'wheel');
  } finally {
    h.destroy();
  }
});

test('R9-06 rejected or cancelled recalibration never increments geometryResyncs', () => {
  const h = createSessionHarness();
  try {
    h.ownership.beginUserGesture('preview', 'touch');
    assert.equal(h.session.notifyGeometryChanged(), true);
    assert.equal(h.session.settleSourceSync('preview', { published: false }), false);
    assert.equal(h.session.getState().geometryResyncs, 0);
    assert.equal(h.session.notifyGeometryChanged(), true);
    h.session.cancelPending();
    assert.equal(h.session.settleSourceSync('preview', { published: true }), false);
    assert.equal(h.session.getState().geometryResyncs, 0);
  } finally {
    h.destroy();
  }
});

test('R9-06 compensation writes only the requested target and resynchronizes from the existing source', () => {
  const h = createSessionHarness();
  try {
    h.ownership.beginUserGesture('editor', 'wheel');
    assert.equal(h.session.compensate('preview', 30, 'virtual-height'), true);
    assert.equal(h.tops.preview, 50);
    assert.deepEqual(h.schedules, ['editor']);
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.writes[0], {
      side: 'preview',
      top: 50,
      options: { reason: 'virtual-height', behavior: 'auto', settleMs: 900 }
    });
    assert.equal(h.ownership.getState().sourceSide, 'editor');
    assert.equal(h.ownership.getState().sourceReason, 'wheel');
    assert.equal(h.session.compensate('preview', 0.25), false);
    assert.equal(h.writes.length, 1);
  } finally {
    h.destroy();
  }
});

test('R9-06 ScrollSyncController compatibility API delegates geometry without creating a feedback source', () => {
  let time = 0;
  const ownership = createScrollSourceOwnership({ now: () => time });
  const frames = createFrameRuntime();
  const editor = new FakeElement({ scrollTop: 100 });
  const preview = new FakeElement({ scrollTop: 20 });
  const controller = createScrollSyncController(editor, preview, {
    sourceOwnership: ownership,
    requestFrame: callback => frames.request(callback),
    cancelFrame: id => frames.cancel(id)
  });
  try {
    let editorCalls = 0;
    controller.configure({ syncFromEditor: () => { editorCalls += 1; } });
    editor.emit('wheel');
    assert.equal(controller.compensate('preview', 30, 'virtual-height'), true);
    assert.equal(preview.scrollTop, 50);
    assert.equal(controller.getState().sourceSide, 'editor');
    assert.equal(controller.getState().sourceReason, 'wheel');
    assert.equal(frames.count(), 1);
    frames.flush();
    assert.equal(editorCalls, 1);
    assert.equal(controller.getState().geometryResyncs, 1);
  } finally {
    controller.destroy();
    ownership.destroy();
  }
});

test('R9-06 destroy is terminal and idempotent for pending geometry work', () => {
  const h = createSessionHarness();
  h.ownership.beginUserGesture('editor', 'wheel');
  assert.equal(h.session.notifyGeometryChanged(), true);
  h.session.destroy();
  h.session.destroy();
  assert.equal(h.session.notifyGeometryChanged(), false);
  assert.equal(h.session.compensate('editor', 20), false);
  assert.equal(h.session.settleSourceSync('editor', { published: true }), false);
  assert.deepEqual(h.session.getState(), { geometryResyncs: 0 });
  assert.equal(h.ownership.getState().sourceSide, 'editor');
  h.ownership.destroy();
});
