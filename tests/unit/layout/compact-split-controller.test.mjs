import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutState } from '../../../src/features/layout/state/layout-state.js';
import { createCompactSplitController } from '../../../src/features/layout/split/compact-split-controller.js';

function pane() {
  const listeners = new Map();
  return { addEventListener: (t, f) => listeners.set(t, f), removeEventListener: (t, f) => { if (listeners.get(t) === f) listeners.delete(t); }, listeners };
}

test('Atomic 6.3 CompactSplit applies 720/760 hysteresis and mutually exclusive compact panes', () => {
  const state = createLayoutState();
  let width = 710; let resizeCallback = null; let frame = 0;
  const classes = new Set(); const calls = [];
  const editorPane = pane(); const previewPane = pane();
  const controller = createCompactSplitController({
    state,
    main: { clientWidth: 710, getBoundingClientRect: () => ({ width }), classList: { toggle: (n, a) => a ? classes.add(n) : classes.delete(n) } },
    editorPane, previewPane,
    paneController: { setCollapsed(value, reason) { state.setSplit(value); calls.push([value, reason]); } },
    viewport: { addEventListener() {}, removeEventListener() {} },
    createResizeObserver(callback) { resizeCallback = callback; return { observe() {}, disconnect() { resizeCallback = null; } }; },
    requestFrame(callback) { callback(); return ++frame; }, cancelFrame() {}
  });
  controller.start();
  assert.equal(state.snapshot.split.compactActive, true);
  assert.equal(state.snapshot.split.compactPane, 'editor');
  assert.deepEqual([state.snapshot.split.editorCollapsed, state.snapshot.split.previewCollapsed], [false, true]);
  width = 740; resizeCallback();
  assert.equal(state.snapshot.split.compactActive, true, '740 remains compact because active exit threshold is 760');
  controller.activatePane('preview', 'test');
  assert.deepEqual([state.snapshot.split.editorCollapsed, state.snapshot.split.previewCollapsed], [true, false]);
  width = 780; resizeCallback();
  assert.equal(state.snapshot.split.compactActive, false);
  assert.deepEqual([state.snapshot.split.editorCollapsed, state.snapshot.split.previewCollapsed], [false, false]);
  controller.destroy();
  assert.equal(resizeCallback, null);
  assert.equal(editorPane.listeners.size, 0);
  assert.equal(previewPane.listeners.size, 0);
  state.destroy();
});

test('Atomic 6.14 CompactSplit stale ResizeObserver callback cannot allocate work after destroy', () => {
  const state = createLayoutState();
  const editorPane = pane();
  const previewPane = pane();
  let staleResizeCallback = null;
  let nextFrame = 0;
  const activeFrames = new Set();
  const controller = createCompactSplitController({
    state,
    main: {
      clientWidth: 900,
      getBoundingClientRect: () => ({ width: 900 }),
      classList: { toggle() {} }
    },
    editorPane,
    previewPane,
    paneController: { setCollapsed(value) { state.setSplit(value); } },
    viewport: { addEventListener() {}, removeEventListener() {} },
    createResizeObserver(callback) {
      staleResizeCallback = callback;
      return { observe() {}, disconnect() {} };
    },
    requestFrame(callback) {
      const id = ++nextFrame;
      activeFrames.add(id);
      return id;
    },
    cancelFrame(id) { activeFrames.delete(id); }
  });

  controller.start();
  assert.equal(activeFrames.size, 0, 'start does not need a queued frame');
  const capturedCallback = staleResizeCallback;
  controller.destroy();
  assert.equal(activeFrames.size, 0, 'destroy leaves no queued frame');
  capturedCallback();
  assert.equal(activeFrames.size, 0, 'stale observer callback must not create a post-destroy frame');
  state.destroy();
});
