import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWindowCloseController,
  createWindowController,
  createWindowControlsView,
  createWindowDragRegion,
  createWindowState
} from '../../../src/features/window/index.js';
import { assertLifecycleZero, createLifecycleResourceLedger } from '../../helpers/lifecycle-resource-ledger.mjs';

function createTrackedWindowState(ledger) {
  const state = createWindowState();
  const counter = ledger.createSubscriptionSource();
  return {
    get snapshot() { return state.snapshot; },
    setAvailable: value => state.setAvailable(value),
    setMaximized: value => state.setMaximized(value),
    setClosePhase: value => state.setClosePhase(value),
    subscribe(listener) {
      const releaseCount = counter.subscribe(() => {});
      const releaseState = state.subscribe(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        releaseState();
        releaseCount();
      };
    },
    destroy: () => state.destroy()
  };
}

function createButton(ledger) {
  const attributes = new Map();
  const use = { setAttribute(name, value) { attributes.set(`use:${name}`, String(value)); } };
  return ledger.createEventTarget({
    classList: ledger.createClassList(),
    dataset: {},
    title: '',
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    querySelector(selector) { return selector === 'use' ? use : null; }
  });
}

test('Atomic 6.14 Window aggregate lifecycle returns control/drag/native subscriptions to zero', async () => {
  const ledger = createLifecycleResourceLedger();
  const state = createTrackedWindowState(ledger);
  const resizeSource = ledger.createSubscriptionSource();
  const closeSource = ledger.createSubscriptionSource();
  let maximized = false;
  const windowPort = {
    async startDrag() {},
    async minimize() {},
    async toggleMaximize() { maximized = !maximized; return maximized; },
    async isMaximized() { return maximized; },
    subscribeResize(listener) { return resizeSource.subscribe(listener); },
    subscribeCloseRequest(listener) { return closeSource.subscribe(listener); },
    async requestClose() {},
    async forceClose() {}
  };
  const minimizeButton = createButton(ledger);
  const maximizeButton = createButton(ledger);
  const closeButton = createButton(ledger);
  const root = { classList: ledger.createClassList() };
  const controls = { hidden: true };
  const dragTarget = ledger.createEventTarget();
  let controller = null;
  const controlsView = createWindowControlsView({
    state,
    root,
    controls,
    minimizeButton,
    maximizeButton,
    closeButton,
    onMinimize: () => controller.minimize(),
    onToggleMaximize: () => controller.toggleMaximize(),
    onClose: () => controller.requestClose('control')
  });
  const dragRegion = createWindowDragRegion({
    target: dragTarget,
    enabled: true,
    startDrag: () => controller.startDrag(),
    toggleMaximize: () => controller.toggleMaximize()
  });
  const closeController = createWindowCloseController({
    state,
    windowPort,
    closeSave: { async prepareClose() { return true; } },
    supported: true
  });
  controller = createWindowController({
    state,
    windowPort,
    controlsView,
    dragRegion,
    closeController,
    supported: true
  });

  const firstStart = controller.start();
  const secondStart = controller.start();
  assert.equal(secondStart, firstStart, 'Window Controller reuses the same start transition');
  await firstStart;
  const once = ledger.snapshot();
  assert.deepEqual({ listeners: once.listeners, subscriptions: once.subscriptions }, { listeners: 4, subscriptions: 3 });
  await controller.start();
  assert.deepEqual(ledger.snapshot(), once, 'repeated Window start must not add resources');

  const firstDestroy = controller.destroy();
  const secondDestroy = controller.destroy();
  assert.equal(secondDestroy, firstDestroy, 'Window Controller reuses the same destroy transition');
  await firstDestroy;
  await secondDestroy;
  assertLifecycleZero(assert, ledger, 'Window aggregate resources');
});
