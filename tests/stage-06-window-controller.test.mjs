import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCloseSavePort,
  createWindowCloseController,
  createWindowController,
  createWindowControlsView,
  createWindowDragRegion,
  createWindowState,
  mountClassicCloseSavePort
} from '../src/features/window/index.js';

function classList() {
  return { toggle() {} };
}
function button() {
  const listeners = new Map();
  return {
    dataset: {}, title: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    setAttribute() {},
    querySelector() { return { setAttribute() {} }; }
  };
}

test('Atomic 6.13 public Window entry composes one unavailable lifecycle without browser or desktop globals', async () => {
  const host = {};
  const closeSave = createCloseSavePort();
  const classic = mountClassicCloseSavePort(host, closeSave);
  host.markdownEditorCloseSavePort.register(() => true);
  const state = createWindowState();
  const root = { classList: classList() };
  const controls = { hidden: false };
  const minimizeButton = button();
  const maximizeButton = button();
  const closeButton = button();
  let controller = null;
  const controlsView = createWindowControlsView({
    state, root, controls, minimizeButton, maximizeButton, closeButton,
    onMinimize: () => controller.minimize(),
    onToggleMaximize: () => controller.toggleMaximize(),
    onClose: () => controller.requestClose()
  });
  const dragTarget = { addEventListener() {}, removeEventListener() {} };
  const dragRegion = createWindowDragRegion({
    target: dragTarget,
    enabled: false,
    startDrag: () => controller.startDrag(),
    toggleMaximize: () => controller.toggleMaximize()
  });
  const windowPort = Object.freeze({
    async startDrag() { throw new Error('must not run'); },
    async minimize() { throw new Error('must not run'); },
    async toggleMaximize() { throw new Error('must not run'); },
    async isMaximized() { throw new Error('must not run'); },
    async subscribeResize() { throw new Error('must not run'); },
    async subscribeCloseRequest() { throw new Error('must not run'); },
    async requestClose() { throw new Error('must not run'); },
    async forceClose() { throw new Error('must not run'); }
  });
  const closeController = createWindowCloseController({ state, windowPort, closeSave, supported: false });
  controller = createWindowController({
    state, windowPort, controlsView, dragRegion, closeController, supported: false
  });

  await controller.start();
  assert.equal(state.snapshot.available, false);
  assert.equal(controls.hidden, true);
  assert.equal((await controller.minimize()).reason, 'unsupported');
  assert.equal((await controller.requestClose()).reason, 'unsupported');
  await controller.destroy();
  classic.destroy();
  closeSave.destroy();
  assert.equal(host.markdownEditorCloseSavePort, undefined);
});
