import test from 'node:test';
import assert from 'node:assert/strict';
import {
  destroyHybridWidgetGeometryScheduler,
  scheduleHybridWidgetGeometry
} from '../src/features/hybrid-editor/lifecycle/widget-geometry-scheduler.js';
import {
  attachHybridWidgetLifecycle,
  destroyHybridWidgetLifecycle
} from '../src/features/hybrid-editor/lifecycle/widget-lifecycle.js';

function createClock() {
  let nextId = 0;
  const frames = new Map();
  const timers = new Map();
  class FakeElement {}
  return {
    Element: FakeElement,
    frames,
    timers,
    requestAnimationFrame(callback) {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) {
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    flushFrame() {
      const entry = frames.entries().next().value;
      if (!entry) return false;
      const [id, callback] = entry;
      frames.delete(id);
      callback();
      return true;
    },
    flushTimer() {
      const entry = timers.entries().next().value;
      if (!entry) return false;
      const [id, callback] = entry;
      timers.delete(id);
      callback();
      return true;
    }
  };
}

function createHarness({ withObserver = true } = {}) {
  const clock = createClock();
  const geometryReasons = [];
  const metricsRebuilds = [];
  const scrollSignals = [];
  const selectionSignals = [];
  const observerState = { instances: [], disconnects: 0, observes: 0 };
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      observerState.instances.push(this);
    }
    observe() { observerState.observes += 1; }
    disconnect() { observerState.disconnects += 1; }
    trigger(width = 100, height = 50) { this.callback([{ contentRect: { width, height } }]); }
  }
  if (withObserver) clock.ResizeObserver = FakeResizeObserver;
  clock.scheduleEditorMetricsRebuild = delay => metricsRebuilds.push(delay);
  clock.markdownEditorScrollSync = { notifyGeometryChanged: surface => scrollSignals.push(surface) };
  clock.markdownEditorSelectionController = { notifyEditorGeometry: reason => selectionSignals.push(reason) };
  clock.markdownEditorPerf = {
    record(operation, payload) {
      if (operation === 'hybrid.widget-geometry') geometryReasons.push(payload.details.reason);
    }
  };

  const element = new clock.Element();
  element.ownerDocument = { defaultView: clock };
  element.getBoundingClientRect = () => ({ width: 100, height: 50 });
  const view = {
    destroyed: false,
    dom: { isConnected: true, ownerDocument: { defaultView: clock } },
    measures: 0,
    requestMeasure() { this.measures += 1; }
  };
  return {
    clock, element, view, geometryReasons, metricsRebuilds,
    scrollSignals, selectionSignals, observerState
  };
}

test('Atomic 8.5 attach has one owner and repeated destroy is side-effect idempotent', () => {
  const h = createHarness();
  const first = attachHybridWidgetLifecycle(h.element, h.view, 'image');
  const second = attachHybridWidgetLifecycle(h.element, h.view, 'image');
  assert.equal(first, second);
  assert.equal(h.observerState.observes, 1);
  first();
  first();
  destroyHybridWidgetLifecycle(h.element);
  assert.equal(h.observerState.disconnects, 1);
  assert.equal(h.clock.frames.size, 0);
});

test('Atomic 8.5 mount and ResizeObserver changes delegate geometry reasons without duplicate dimensions', () => {
  const h = createHarness();
  const destroy = attachHybridWidgetLifecycle(h.element, h.view, 'table');
  assert.equal(h.clock.frames.size, 1);
  h.clock.flushFrame();
  assert.equal(h.clock.frames.size, 1);
  h.clock.flushFrame();
  assert.deepEqual(h.geometryReasons, ['table-mounted']);

  const observer = h.observerState.instances[0];
  observer.trigger(120, 70);
  assert.equal(h.clock.frames.size, 1);
  h.clock.flushFrame();
  assert.equal(h.geometryReasons.at(-1), 'table-resize');
  observer.trigger(120, 70);
  assert.equal(h.clock.frames.size, 0);
  destroy();
  destroyHybridWidgetGeometryScheduler(h.view);
});

test('Atomic 8.5 geometry scheduler coalesces to the latest reason and preserves the 120ms settle refresh contract', () => {
  const h = createHarness();
  assert.equal(scheduleHybridWidgetGeometry(h.view, 'first'), true);
  assert.equal(scheduleHybridWidgetGeometry(h.view, 'latest'), true);
  assert.equal(h.clock.frames.size, 1);
  assert.equal(h.clock.timers.size, 1);
  h.clock.flushFrame();
  assert.equal(h.geometryReasons.at(-1), 'latest');
  h.clock.flushTimer();
  assert.deepEqual(h.geometryReasons, ['latest', 'latest:settled']);
  assert.equal(h.view.measures, 2);
  assert.deepEqual(h.metricsRebuilds, [40, 40]);
  assert.deepEqual(h.scrollSignals, ['editor', 'editor']);
  assert.deepEqual(h.selectionSignals, ['hybrid-widget:latest', 'hybrid-widget:latest:settled']);
  destroyHybridWidgetGeometryScheduler(h.view);
});

test('Atomic 8.5 scheduler destroy cancels pending frame and settle work and is idempotent', () => {
  const h = createHarness();
  scheduleHybridWidgetGeometry(h.view, 'pending');
  assert.equal(h.clock.frames.size, 1);
  assert.equal(h.clock.timers.size, 1);
  assert.equal(destroyHybridWidgetGeometryScheduler(h.view), true);
  assert.equal(destroyHybridWidgetGeometryScheduler(h.view), false);
  assert.equal(h.clock.frames.size, 0);
  assert.equal(h.clock.timers.size, 0);
  assert.equal(h.view.measures, 0);
});

test('Atomic 8.5 cleanup rejects stale observer callbacks and remains valid without ResizeObserver', () => {
  const h = createHarness();
  const destroy = attachHybridWidgetLifecycle(h.element, h.view, 'mermaid');
  const observer = h.observerState.instances[0];
  destroy();
  observer.trigger(140, 90);
  assert.equal(h.clock.frames.size, 0);

  const withoutObserver = createHarness({ withObserver: false });
  const cleanup = attachHybridWidgetLifecycle(withoutObserver.element, withoutObserver.view, 'html');
  assert.equal(withoutObserver.observerState.instances.length, 0);
  cleanup();
  cleanup();
  assert.equal(withoutObserver.clock.frames.size, 0);
});
