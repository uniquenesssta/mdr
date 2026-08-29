import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowDragRegion } from '../../../src/features/window/window-drag-region.js';

function target() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    emit(event) { listeners.get('mousedown')?.(event); },
    listenerCount() { return listeners.size; }
  };
}
function event({ buttons = 1, detail = 1, interactive = false } = {}) {
  return {
    buttons,
    detail,
    target: { closest() { return interactive ? {} : null; } }
  };
}

test('Atomic 6.13 Window Drag Region preserves left-drag, interactive exclusion and double-click maximize semantics', async () => {
  const root = target();
  const calls = [];
  const region = createWindowDragRegion({
    target: root,
    startDrag: () => calls.push('drag'),
    toggleMaximize: () => calls.push('maximize')
  });
  assert.equal(region.start(), true);
  assert.equal(region.start(), false);
  root.emit(event());
  root.emit(event({ detail: 2 }));
  root.emit(event({ buttons: 2 }));
  root.emit(event({ interactive: true }));
  await Promise.resolve();
  assert.deepEqual(calls, ['drag', 'maximize']);
});

test('Window Drag Region reports command failures and destroy removes its only listener', async () => {
  const root = target();
  const expected = new Error('drag failed');
  const errors = [];
  const region = createWindowDragRegion({
    target: root,
    startDrag: async () => { throw expected; },
    toggleMaximize: () => {},
    reportError: (message, error) => errors.push({ message, error })
  });
  region.start();
  root.emit(event());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error, expected);
  assert.equal(root.listenerCount(), 1);
  region.destroy();
  region.destroy();
  assert.equal(root.listenerCount(), 0);
  assert.throws(() => region.start(), /destroyed/);
});

test('unsupported Window Drag Region binds no native gesture listener', () => {
  const root = target();
  const region = createWindowDragRegion({ target: root, enabled: false, startDrag() {}, toggleMaximize() {} });
  region.start();
  assert.equal(root.listenerCount(), 0);
  root.emit(event());
  region.destroy();
});
