import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCompactShellController,
  createCompactSplitController,
  createLayoutState,
  createSidebarLayoutController,
  createSidebarResizeController,
  createSplitPaneController,
  createSplitResizeController,
  createSystemFullscreenController,
  createToolbarBoundaryController
} from '../../../src/features/layout/index.js';
import { assertLifecycleZero, createLifecycleResourceLedger } from '../../helpers/lifecycle-resource-ledger.mjs';

function createTrackedLayoutState(ledger) {
  const state = createLayoutState();
  const subscriptionCounter = ledger.createSubscriptionSource();
  return {
    get snapshot() { return state.snapshot; },
    setSidebar: (...args) => state.setSidebar(...args),
    setSplit: (...args) => state.setSplit(...args),
    setCompact: (...args) => state.setCompact(...args),
    setFullscreen: (...args) => state.setFullscreen(...args),
    setResize: (...args) => state.setResize(...args),
    subscribe(listener) {
      const releaseCount = subscriptionCounter.subscribe(() => {});
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

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    get(key) { return values.has(key) ? values.get(key) : null; },
    set(key, value) { values.set(key, String(value)); return Promise.resolve(); }
  };
}

function decorateElement(ledger, extra = {}) {
  return ledger.createEventTarget({
    classList: ledger.createClassList(),
    style: ledger.createStyle(),
    setAttribute() {},
    querySelector() { return null; },
    ...extra
  });
}

function assertStableStart(ledger, start) {
  start();
  const once = ledger.snapshot();
  start();
  assert.deepEqual(ledger.snapshot(), once, 'repeated start must not increase active resources');
  return once;
}

test('Atomic 6.14 Sidebar Resize releases pointer capture, viewport listener and every pointer listener', () => {
  const ledger = createLifecycleResourceLedger();
  const state = createTrackedLayoutState(ledger);
  const resizer = ledger.createPointerTarget({ classList: ledger.createClassList(), setAttribute() {} });
  const viewport = ledger.createEventTarget({ innerWidth: 1280 });
  const workspace = { clientWidth: 1100, getBoundingClientRect: () => ({ left: 10, width: 1100 }) };
  const root = { style: ledger.createStyle() };
  const body = { classList: ledger.createClassList(), style: ledger.createStyle() };
  const controller = createSidebarResizeController({
    state, workspace, resizer, root, body, storage: createStorage(), viewport,
    matchMedia: () => ({ matches: false })
  });

  const started = assertStableStart(ledger, () => controller.start());
  assert.equal(started.listeners, 6);
  resizer.dispatch('pointerdown', { pointerId: 17, button: 0, isPrimary: true, preventDefault() {} });
  assert.equal(ledger.snapshot().pointerCaptures, 1);
  controller.destroy();
  controller.destroy();
  assertLifecycleZero(assert, ledger, 'Sidebar Resize resources');
  state.destroy();
});

test('Atomic 6.14 Split Resize releases pointer listeners, state subscription, RAF and capture', () => {
  const ledger = createLifecycleResourceLedger();
  const state = createTrackedLayoutState(ledger);
  const resizer = ledger.createPointerTarget({ classList: ledger.createClassList(), setAttribute() {} });
  const main = { getBoundingClientRect: () => ({ left: 0, width: 1000 }) };
  const editorPane = { style: ledger.createStyle() };
  const previewPane = { style: ledger.createStyle() };
  const body = { classList: ledger.createClassList(), style: ledger.createStyle() };
  const controller = createSplitResizeController({
    state, main, editorPane, previewPane, resizer, body, storage: createStorage(),
    requestFrame: callback => ledger.requestFrame(callback),
    cancelFrame: id => ledger.cancelFrame(id)
  });

  const started = assertStableStart(ledger, () => controller.start());
  assert.equal(started.listeners, 5);
  assert.equal(started.subscriptions, 1);
  resizer.dispatch('pointerdown', { pointerId: 5, button: 0, isPrimary: true, preventDefault() {} });
  resizer.dispatch('pointermove', { pointerId: 5, clientX: 620, preventDefault() {} });
  assert.equal(ledger.snapshot().pointerCaptures, 1);
  assert.equal(ledger.snapshot().frames, 1);
  controller.destroy();
  controller.destroy();
  assertLifecycleZero(assert, ledger, 'Split Resize resources');
  state.destroy();
});

test('Atomic 6.14 Split Pane keeps exactly one collapse listener and destroys it', () => {
  const ledger = createLifecycleResourceLedger();
  const state = createTrackedLayoutState(ledger);
  const previewCollapseButton = decorateElement(ledger);
  const controller = createSplitPaneController({
    state,
    editorPane: decorateElement(ledger),
    previewPane: decorateElement(ledger),
    resizer: decorateElement(ledger),
    editorCollapseButton: decorateElement(ledger),
    previewCollapseButton,
    storage: createStorage()
  });

  const started = assertStableStart(ledger, () => controller.start());
  assert.equal(started.listeners, 1);
  controller.destroy();
  controller.destroy();
  assertLifecycleZero(assert, ledger, 'Split Pane resources');
  state.destroy();
});

test('Atomic 6.14 Compact Split disconnects observer, pane listeners and RAF with stale callback suppression', () => {
  const ledger = createLifecycleResourceLedger();
  const state = createTrackedLayoutState(ledger);
  const editorPane = decorateElement(ledger);
  const previewPane = decorateElement(ledger);
  const controller = createCompactSplitController({
    state,
    main: { clientWidth: 900, getBoundingClientRect: () => ({ width: 900 }), classList: ledger.createClassList() },
    editorPane,
    previewPane,
    paneController: { setCollapsed(value) { state.setSplit(value); } },
    viewport: ledger.createEventTarget({ innerWidth: 1280 }),
    createResizeObserver: callback => ledger.createResizeObserver(callback),
    requestFrame: callback => ledger.requestFrame(callback),
    cancelFrame: id => ledger.cancelFrame(id)
  });

  const started = assertStableStart(ledger, () => controller.start());
  assert.deepEqual({ listeners: started.listeners, observers: started.observers }, { listeners: 2, observers: 1 });
  const observer = ledger.observerRecords[0];
  observer.callback();
  assert.equal(ledger.snapshot().frames, 1);
  controller.destroy();
  controller.destroy();
  assertLifecycleZero(assert, ledger, 'Compact Split resources');
  observer.callback();
  assertLifecycleZero(assert, ledger, 'Compact Split stale callback resources');
  state.destroy();
});

test('Atomic 6.14 Compact Shell clears resize listener, resize-burst RAF and settle timer', () => {
  const ledger = createLifecycleResourceLedger();
  const state = createTrackedLayoutState(ledger);
  const viewport = ledger.createEventTarget({ innerWidth: 900, innerHeight: 700 });
  const controller = createCompactShellController({
    state,
    root: { classList: ledger.createClassList() },
    viewport,
    requestFrame: callback => ledger.requestFrame(callback),
    cancelFrame: id => ledger.cancelFrame(id),
    setTimer: callback => ledger.setTimer(callback),
    clearTimer: id => ledger.clearTimer(id),
    now: () => 100
  });

  const started = assertStableStart(ledger, () => controller.start());
  assert.equal(started.listeners, 1);
  viewport.dispatch('resize');
  assert.deepEqual({ frames: ledger.snapshot().frames, timers: ledger.snapshot().timers }, { frames: 1, timers: 1 });
  controller.destroy();
  controller.destroy();
  assertLifecycleZero(assert, ledger, 'Compact Shell resources');
  state.destroy();
});

test('Atomic 6.14 Toolbar Boundary disconnects observer and cancels the single coalesced frame', () => {
  const ledger = createLifecycleResourceLedger();
  const toolbar = decorateElement(ledger, {
    clientWidth: 800,
    offsetWidth: 800,
    getBoundingClientRect: () => ({ width: 800 })
  });
  const controller = createToolbarBoundaryController({
    toolbar,
    formatGroup: { scrollWidth: 300 },
    actions: { scrollWidth: 200 },
    getStyle: () => ({ paddingLeft: '0', paddingRight: '0', gap: '8' }),
    createResizeObserver: callback => ledger.createResizeObserver(callback),
    requestFrame: callback => ledger.requestFrame(callback),
    cancelFrame: id => ledger.cancelFrame(id)
  });

  controller.start();
  const once = ledger.snapshot();
  controller.start();
  assert.equal(ledger.snapshot().observers, once.observers, 'restart does not allocate another observer');
  assert.equal(ledger.snapshot().frames, 1, 'restart keeps one coalesced RAF');
  controller.destroy();
  controller.destroy();
  assertLifecycleZero(assert, ledger, 'Toolbar Boundary resources');
});

test('Atomic 6.14 System Fullscreen owns exactly one platform subscription and Sidebar Layout owns one state subscription', () => {
  const ledger = createLifecycleResourceLedger();
  const state = createTrackedLayoutState(ledger);
  const fullscreenSource = ledger.createSubscriptionSource();
  const fullscreenController = createSystemFullscreenController({
    state,
    supported: true,
    fullscreen: {
      isEnabled: () => true,
      isActive: () => false,
      enter: async () => {},
      exit: async () => {},
      subscribe: listener => fullscreenSource.subscribe(listener)
    }
  });
  const sidebarLayoutController = createSidebarLayoutController({
    state,
    sidebar: decorateElement(ledger),
    resizer: decorateElement(ledger)
  });

  fullscreenController.start();
  fullscreenController.start();
  sidebarLayoutController.start();
  sidebarLayoutController.start();
  assert.equal(ledger.snapshot().subscriptions, 2);
  sidebarLayoutController.destroy();
  sidebarLayoutController.destroy();
  fullscreenController.destroy();
  fullscreenController.destroy();
  assertLifecycleZero(assert, ledger, 'Fullscreen and Sidebar Layout subscriptions');
  state.destroy();
});
