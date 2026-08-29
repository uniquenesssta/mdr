import test from 'node:test';
import assert from 'node:assert/strict';
import { createScrollSyncController } from '../src/features/sync/index.js';

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

function installDeterministicRuntime() {
  const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  const originalRequestFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  const originalCancelFrame = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  let time = 0;
  let nextFrame = 1;
  const frames = new Map();
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => time } });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    }
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value(id) { frames.delete(id); }
  });

  const restore = (name, descriptor) => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };

  return {
    setTime(value) { time = Number(value) || 0; },
    advance(value) { time += Number(value) || 0; },
    flushFrames() {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(time);
    },
    frameCount() { return frames.size; },
    restore() {
      restore('performance', originalPerformance);
      restore('requestAnimationFrame', originalRequestFrame);
      restore('cancelAnimationFrame', originalCancelFrame);
    }
  };
}

function withController(run) {
  const runtime = installDeterministicRuntime();
  const editor = new FakeElement();
  const preview = new FakeElement();
  const controller = createScrollSyncController(editor, preview);
  try {
    return run({ runtime, editor, preview, controller });
  } finally {
    controller.destroy();
    runtime.restore();
  }
}

test('R9-01 freezes wheel, pointer, touch and scroll-key source acquisition semantics', () => {
  withController(({ editor, preview, controller }) => {
    editor.emit('wheel');
    assert.equal(controller.getState().sourceSide, 'editor');
    assert.equal(controller.getState().sourceReason, 'wheel');
    editor.emit('pointerdown');
    assert.equal(controller.getState().sourceReason, 'pointer');
    assert.equal(controller.getState().sourceSwitches, 1);
    preview.emit('touchstart');
    assert.equal(controller.getState().sourceSide, 'preview');
    assert.equal(controller.getState().sourceReason, 'touch');
    editor.emit('keydown', { key: 'ArrowDown' });
    assert.equal(controller.getState().sourceSide, 'editor');
    assert.equal(controller.getState().sourceReason, 'keyboard');
    const switches = controller.getState().sourceSwitches;
    preview.emit('keydown', { key: 'a' });
    assert.equal(controller.getState().sourceSwitches, switches);
    assert.equal(controller.getState().sourceSide, 'editor');
  });
});

test('R9-01 freezes explicit-source-only scroll callbacks and passive-target suppression', () => {
  withController(({ runtime, editor, preview, controller }) => {
    const calls = { editor: 0, preview: 0 };
    controller.configure({
      syncFromEditor: () => { calls.editor += 1; },
      syncFromPreview: () => { calls.preview += 1; }
    });
    editor.emit('wheel');
    editor.emit('scroll');
    assert.equal(runtime.frameCount(), 1);
    runtime.flushFrames();
    assert.deepEqual(calls, { editor: 1, preview: 0 });
    preview.emit('scroll');
    runtime.flushFrames();
    assert.deepEqual(calls, { editor: 1, preview: 0 });
    assert.equal(controller.getState().ignoredTargetEvents, 1);
  });
});

test('R9-01 freezes programmatic-scroll timeout suppression with the 120ms minimum window', () => {
  withController(({ runtime, preview, controller }) => {
    let calls = 0;
    controller.configure({ syncFromPreview: () => { calls += 1; } });
    preview.emit('wheel');
    controller.markProgrammaticScroll('preview', 1);
    runtime.setTime(119);
    preview.emit('scroll');
    runtime.flushFrames();
    assert.equal(calls, 0);
    assert.equal(controller.getState().ignoredTargetEvents, 1);
    runtime.setTime(121);
    preview.emit('scroll');
    runtime.flushFrames();
    assert.equal(calls, 1);
  });
});

test('R9-01 freezes coalesced target writes, clamping and programmatic target marking', () => {
  withController(({ runtime, preview, controller }) => {
    preview.scrollTop = 10;
    preview.scrollHeight = 1000;
    preview.clientHeight = 200;
    controller.scheduleTarget('preview', 9999, { reason: 'first' });
    controller.scheduleTarget('preview', 250, { reason: 'latest', settleMs: 500 });
    assert.equal(runtime.frameCount(), 1);
    runtime.flushFrames();
    const state = controller.getState();
    assert.equal(preview.scrollTop, 250);
    assert.equal(state.targetWrites, 1);
    assert.equal(state.lastTargetSide, 'preview');
    assert.equal(state.lastTargetTop, 250);
    assert.equal(state.lastTargetDelta, 240);
    assert.ok(state.programmaticUntil.preview >= 500);
  });
});

test('R9-01 freezes direct programmatic scroll behavior and suspension timeout', () => {
  withController(({ runtime, editor, controller }) => {
    let calls = 0;
    controller.configure({ syncFromEditor: () => { calls += 1; } });
    editor.emit('wheel');
    assert.equal(controller.scrollTo('editor', 300, { behavior: 'smooth', suspendMs: 360 }), true);
    assert.deepEqual(editor.scrollCalls, [{ top: 300, behavior: 'smooth' }]);
    editor.emit('scroll');
    runtime.flushFrames();
    assert.equal(calls, 0);
    runtime.setTime(901);
    editor.emit('scroll');
    runtime.flushFrames();
    assert.equal(calls, 1);
  });
});

test('R9-01 freezes geometry compensation and one-frame geometry resynchronization', () => {
  withController(({ runtime, editor, controller }) => {
    let calls = 0;
    controller.configure({ syncFromEditor: () => { calls += 1; } });
    editor.scrollTop = 100;
    editor.emit('wheel');
    assert.equal(controller.compensate('editor', 24, 'virtual-height'), true);
    assert.equal(editor.scrollTop, 124);
    assert.equal(runtime.frameCount(), 1);
    runtime.flushFrames();
    assert.equal(calls, 1);
    assert.equal(controller.getState().geometryResyncs, 1);
    assert.equal(controller.compensate('editor', 0.25), false);
  });
});

test('R9-01 preserves public API names and runtime-stat field semantics', () => {
  withController(({ controller }) => {
    const api = controller.getPublicApi();
    assert.deepEqual(Object.keys(api).sort(), [
      'compensate',
      'getState',
      'markManualScroll',
      'markProgrammaticScroll',
      'notifyGeometryChanged',
      'scheduleTarget',
      'scrollTo',
      'suspend',
      'syncNow'
    ]);
    assert.deepEqual(Object.keys(controller.getState()).sort(), [
      'geometryResyncs',
      'ignoredTargetEvents',
      'lastSourceReason',
      'lastSourceSide',
      'lastTargetDelta',
      'lastTargetSide',
      'lastTargetTop',
      'pendingTargetSide',
      'programmaticUntil',
      'sourceLastEventAt',
      'sourceReason',
      'sourceSide',
      'sourceSwitches',
      'suspendedUntil',
      'targetWrites'
    ]);
  });
});

test('R9-01 destroy removes listeners, cancels queued work and remains idempotent', () => {
  const runtime = installDeterministicRuntime();
  const editor = new FakeElement();
  const preview = new FakeElement();
  const controller = createScrollSyncController(editor, preview);
  try {
    editor.emit('wheel');
    editor.emit('scroll');
    controller.scheduleTarget('preview', 200);
    controller.notifyGeometryChanged('editor');
    assert.ok(runtime.frameCount() > 0);
    controller.destroy();
    controller.destroy();
    assert.equal(runtime.frameCount(), 0);
    for (const element of [editor, preview]) {
      for (const listeners of element.listeners.values()) assert.equal(listeners.size, 0);
    }
    editor.emit('scroll');
    runtime.flushFrames();
    assert.equal(runtime.frameCount(), 0);
  } finally {
    controller.destroy();
    runtime.restore();
  }
});
