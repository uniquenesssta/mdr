import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutState } from '../../../src/features/layout/state/layout-state.js';
import { createSplitResizeController } from '../../../src/features/layout/split/split-resize-controller.js';

function handle() {
  const listeners = new Map(); const attrs = new Map(); const captures = new Set(); const classes = new Set();
  return {
    listeners, attrs, captures,
    classList: { toggle: (n, a) => a ? classes.add(n) : classes.delete(n) },
    addEventListener: (t, f) => listeners.set(t, f), removeEventListener: (t, f) => { if (listeners.get(t) === f) listeners.delete(t); },
    setPointerCapture: id => captures.add(id), releasePointerCapture: id => captures.delete(id), hasPointerCapture: id => captures.has(id),
    setAttribute: (n, v) => attrs.set(n, v), emit: (t, e) => listeners.get(t)?.(e)
  };
}

test('Atomic 6.3 SplitResize captures one pointer, clamps/persists ratio and emits geometry only', () => {
  const state = createLayoutState(); const resizer = handle(); const data = new Map(); const geometry = [];
  const editorPane = { style: {} }; const previewPane = { style: {} };
  const bodyClasses = new Set(); const body = { classList: { toggle: (n, a) => a ? bodyClasses.add(n) : bodyClasses.delete(n) }, style: {} };
  let nextFrame = 0; const frames = new Map();
  const controller = createSplitResizeController({
    state, main: { getBoundingClientRect: () => ({ left: 100, width: 1000 }) }, editorPane, previewPane, resizer, body,
    storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) },
    requestFrame(callback) { const id = ++nextFrame; frames.set(id, callback); callback(); frames.delete(id); return id; },
    cancelFrame(id) { frames.delete(id); }, onGeometryChanged: detail => geometry.push(detail)
  });
  data.set('md_editor_ratio', '0.6');
  controller.start();
  assert.equal(state.snapshot.split.ratio, 0.6);
  resizer.emit('pointerdown', { pointerId: 7, button: 0, isPrimary: true, preventDefault() {} });
  assert.equal(state.snapshot.resize.splitActive, true);
  assert.equal(resizer.captures.has(7), true);
  resizer.emit('pointermove', { pointerId: 7, clientX: 1080, preventDefault() {} });
  assert.equal(state.snapshot.split.ratio, 0.85);
  resizer.emit('pointerup', { pointerId: 7 });
  assert.equal(state.snapshot.resize.splitActive, false);
  assert.equal(data.get('md_editor_ratio'), '0.85');
  assert.equal(resizer.captures.size, 0);
  assert.ok(geometry.length >= 2);
  assert.equal(editorPane.style.flex, '0 0 85%');
  controller.destroy();
  assert.equal(resizer.listeners.size, 0);
  state.destroy();
});

test('Atomic 6.3 SplitResize refuses drag while compact/collapsed and destroy cancels active capture', () => {
  const state = createLayoutState({ split: { compactActive: true, compactPane: 'editor', editorCollapsed: false, previewCollapsed: true } });
  const resizer = handle(); const controller = createSplitResizeController({
    state, main: { getBoundingClientRect: () => ({ left: 0, width: 1000 }) }, editorPane: { style: {} }, previewPane: { style: {} }, resizer,
    body: { classList: { toggle() {} }, style: {} }, storage: { getItem: () => null, setItem() {} },
    requestFrame(callback) { callback(); return 1; }, cancelFrame() {}, onGeometryChanged() {}
  });
  controller.start();
  resizer.emit('pointerdown', { pointerId: 3, button: 0, isPrimary: true });
  assert.equal(resizer.captures.size, 0);
  state.setSplit({ compactActive: false, previewCollapsed: false });
  resizer.emit('pointerdown', { pointerId: 4, button: 0, isPrimary: true, preventDefault() {} });
  assert.equal(resizer.captures.has(4), true);
  controller.destroy();
  assert.equal(resizer.captures.size, 0);
  assert.equal(state.snapshot.resize.splitActive, false);
  state.destroy();
});


test('Atomic 6.3 SplitResize closes pointercancel and lostpointercapture paths without stale resize state', () => {
  for (const terminalEvent of ['pointercancel', 'lostpointercapture']) {
    const state = createLayoutState();
    const resizer = handle();
    const controller = createSplitResizeController({
      state,
      main: { getBoundingClientRect: () => ({ left: 0, width: 1000 }) },
      editorPane: { style: {} },
      previewPane: { style: {} },
      resizer,
      body: { classList: { toggle() {} }, style: {} },
      storage: { getItem: () => null, setItem() {} },
      requestFrame(callback) { callback(); return 1; },
      cancelFrame() {},
      onGeometryChanged() {}
    });
    controller.start();
    resizer.emit('pointerdown', { pointerId: 11, button: 0, isPrimary: true, preventDefault() {} });
    assert.equal(state.snapshot.resize.splitActive, true);
    if (terminalEvent === 'lostpointercapture') resizer.captures.delete(11);
    resizer.emit(terminalEvent, { pointerId: 11 });
    assert.equal(state.snapshot.resize.splitActive, false, `${terminalEvent} must clear splitActive`);
    assert.equal(resizer.captures.size, 0, `${terminalEvent} must leave no capture`);
    controller.destroy();
    state.destroy();
  }
});
