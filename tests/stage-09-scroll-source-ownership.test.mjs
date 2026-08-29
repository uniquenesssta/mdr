import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScrollSourceOwnership,
  createScrollSyncController
} from '../src/features/sync/index.js';

class FakeElement {
  constructor() {
    this.scrollHeight = 1200;
    this.clientHeight = 200;
    this.scrollTop = 0;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  contains(target) {
    return target?.owner === this;
  }

  scrollTo(options) {
    this.scrollTop = Number(options?.top) || 0;
  }
}

function installFrameRuntime() {
  const originalRequestFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  const originalCancelFrame = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 1 });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => {} });
  return () => {
    if (originalRequestFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', originalRequestFrame);
    else delete globalThis.requestAnimationFrame;
    if (originalCancelFrame) Object.defineProperty(globalThis, 'cancelAnimationFrame', originalCancelFrame);
    else delete globalThis.cancelAnimationFrame;
  };
}

function makeOwnership() {
  let time = 0;
  const ownership = createScrollSourceOwnership({ now: () => time });
  return {
    ownership,
    setTime(value) { time = Number(value) || 0; },
    advance(value) { time += Number(value) || 0; }
  };
}

test('R9-02 source owner starts neutral and exposes the preserved source-state projection only', () => {
  const { ownership } = makeOwnership();
  try {
    assert.deepEqual(ownership.getState(), {
      sourceSide: '',
      sourceReason: '',
      sourceLastEventAt: 0,
      suspendedUntil: 0,
      programmaticUntil: { editor: 0, preview: 0 },
      sourceSwitches: 0,
      lastSourceSide: '',
      lastSourceReason: ''
    });
  } finally {
    ownership.destroy();
  }
});

test('R9-02 user gestures own side reason time and switch count without duplicate same-side switches', () => {
  const { ownership, setTime } = makeOwnership();
  try {
    setTime(10);
    assert.deepEqual(ownership.beginUserGesture('editor', 'wheel'), { accepted: true, sourceChanged: true });
    setTime(20);
    assert.deepEqual(ownership.beginUserGesture('editor', 'pointer'), { accepted: true, sourceChanged: false });
    setTime(30);
    ownership.beginUserGesture('preview', 'touch');
    assert.deepEqual(ownership.getState(), {
      sourceSide: 'preview',
      sourceReason: 'touch',
      sourceLastEventAt: 30,
      suspendedUntil: 0,
      programmaticUntil: { editor: 0, preview: 0 },
      sourceSwitches: 2,
      lastSourceSide: 'preview',
      lastSourceReason: 'touch'
    });
  } finally {
    ownership.destroy();
  }
});

test('R9-02 programmatic windows preserve the 120ms minimum and user input clears its own side window', () => {
  const { ownership, setTime } = makeOwnership();
  try {
    ownership.markProgrammaticScroll('editor', 1);
    setTime(119);
    assert.equal(ownership.isProgrammatic('editor'), true);
    setTime(121);
    assert.equal(ownership.isProgrammatic('editor'), false);
    ownership.markProgrammaticScroll('editor', 500);
    ownership.beginUserGesture('editor', 'wheel');
    assert.equal(ownership.getState().programmaticUntil.editor, 0);
  } finally {
    ownership.destroy();
  }
});

test('R9-02 suspension extends monotonically and expires without changing source identity', () => {
  const { ownership, setTime } = makeOwnership();
  try {
    ownership.beginUserGesture('editor', 'keyboard');
    ownership.suspend(360);
    setTime(100);
    ownership.suspend(100);
    assert.equal(ownership.getState().suspendedUntil, 360);
    assert.equal(ownership.isSuspended(), true);
    setTime(361);
    assert.equal(ownership.isSuspended(), false);
    assert.equal(ownership.getState().sourceSide, 'editor');
  } finally {
    ownership.destroy();
  }
});

test('R9-02 target classification never lets passive or programmatic sides mutate source ownership', () => {
  const { ownership } = makeOwnership();
  try {
    ownership.beginUserGesture('editor', 'wheel');
    ownership.markProgrammaticScroll('preview', 700);
    assert.equal(ownership.classify('editor'), 'user');
    assert.equal(ownership.classify('preview'), 'programmatic');
    assert.equal(ownership.classify('other'), 'passive');
    assert.equal(ownership.getState().sourceSide, 'editor');
    assert.equal(ownership.getState().sourceReason, 'wheel');
  } finally {
    ownership.destroy();
  }
});

test('R9-02 sequence allocation is monotonic and destroy is terminal and idempotent', () => {
  const { ownership } = makeOwnership();
  assert.equal(ownership.nextSequence(), 1);
  assert.equal(ownership.nextSequence(), 2);
  ownership.beginUserGesture('preview', 'touch');
  ownership.destroy();
  ownership.destroy();
  assert.equal(ownership.nextSequence(), 0);
  assert.deepEqual(ownership.beginUserGesture('editor', 'wheel'), { accepted: false, sourceChanged: false });
  assert.equal(ownership.getState().sourceSide, '');
});

test('R9-02 scroll controller delegates source state to an injected owner and does not destroy external ownership', () => {
  const restoreFrames = installFrameRuntime();
  const { ownership, setTime } = makeOwnership();
  const editor = new FakeElement();
  const preview = new FakeElement();
  const controller = createScrollSyncController(editor, preview, { sourceOwnership: ownership });
  try {
    setTime(42);
    controller.beginUserGesture('editor', 'wheel');
    controller.markProgrammaticScroll('preview', 500);
    controller.suspend(360);
    const state = controller.getState();
    assert.equal(state.sourceSide, 'editor');
    assert.equal(state.sourceReason, 'wheel');
    assert.equal(state.sourceLastEventAt, 42);
    assert.equal(state.programmaticUntil.preview, 542);
    assert.equal(state.suspendedUntil, 402);
    controller.destroy();
    setTime(50);
    assert.deepEqual(ownership.beginUserGesture('preview', 'touch'), { accepted: true, sourceChanged: true });
  } finally {
    controller.destroy();
    ownership.destroy();
    restoreFrames();
  }
});
