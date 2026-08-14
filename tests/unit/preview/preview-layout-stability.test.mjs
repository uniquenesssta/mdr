import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreviewCancellation } from '../../../src/features/preview/pipeline/preview-cancellation.js';
import { createPreviewLayoutStability } from '../../../src/features/preview/pipeline/preview-layout-stability.js';
import { createPreviewScheduler } from '../../../src/features/preview/pipeline/preview-scheduler.js';

function createClassList(collapsed = false) {
  let value = Boolean(collapsed);
  return {
    contains(name) { return name === 'collapsed' && value; },
    setCollapsed(next) { value = Boolean(next); }
  };
}

function createHarness({ width = 420, height = 260, collapsed = false, thresholds = {} } = {}) {
  let sequence = 0;
  const timers = new Map();
  const frames = new Map();
  const cancellation = createPreviewCancellation();
  const scheduler = createPreviewScheduler({
    cancellation,
    setTimer(callback) {
      const id = ++sequence;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    requestFrame(callback) {
      const id = ++sequence;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) { frames.delete(id); }
  });
  const root = { clientWidth: width, clientHeight: height };
  const pane = { classList: createClassList(collapsed) };
  let resizeCallback = null;
  const observed = [];
  let disconnected = 0;
  const records = [];
  const errors = [];
  const counters = {
    renders: 0,
    refreshViewport: 0,
    invalidations: 0,
    geometry: 0,
    stable: false,
    target: { present: false, loading: false, empty: true },
    suspended: false
  };
  const stability = createPreviewLayoutStability({
    root,
    pane,
    scheduler,
    thresholds: {
      maxAttempts: thresholds.maxAttempts ?? 18,
      stableFrames: thresholds.stableFrames ?? 2,
      retryMs: thresholds.retryMs ?? 34
    },
    createResizeObserver(callback) {
      resizeCallback = callback;
      return {
        observe(target) { observed.push(target); },
        disconnect() { disconnected += 1; }
      };
    },
    now: (() => { let time = 0; return () => ++time; })(),
    record(operation, entry) { records.push([operation, entry]); },
    reportError(message, error) { errors.push([message, error]); }
  });
  stability.connect({
    isSuspended: () => counters.suspended,
    hasStablePreview: () => counters.stable,
    inspectRenderTarget: () => counters.target,
    render() {
      counters.renders += 1;
      counters.stable = true;
      counters.target = { present: true, loading: false, empty: false };
    },
    refreshViewport() { counters.refreshViewport += 1; },
    invalidateGeometry() { counters.invalidations += 1; },
    notifyGeometryChanged(reason) {
      assert.equal(reason, 'preview');
      counters.geometry += 1;
    },
    getStats: () => ({ previewBlocks: 7, mountedBlocks: 3 })
  });

  const runOne = async map => {
    const entry = map.entries().next().value;
    assert.ok(entry, 'expected scheduled work');
    const [id, callback] = entry;
    map.delete(id);
    callback();
    await Promise.resolve();
    await Promise.resolve();
  };
  const settleVisible = async () => {
    await runOne(frames);
    await runOne(frames);
    await runOne(frames);
  };
  return {
    stability, scheduler, root, pane, counters, timers, frames, records, errors,
    observed, get disconnected() { return disconnected; },
    get resizeCallback() { return resizeCallback; },
    runOne, settleVisible
  };
}

test('Atomic 7.9 waits for visible stable geometry before rendering and refreshes geometry twice', async () => {
  const h = createHarness();
  assert.equal(h.stability.start(), true);
  assert.equal(h.stability.start(), false);
  assert.equal(h.observed.length, 2);
  h.stability.requestRefresh({ forceRender: true, reason: 'test-visible' });

  await h.settleVisible();
  assert.equal(h.counters.renders, 1);
  assert.equal(h.counters.refreshViewport, 1);
  assert.equal(h.counters.invalidations, 1);
  assert.equal(h.counters.geometry, 1);
  assert.equal(h.frames.size, 1);
  await h.runOne(h.frames);
  assert.equal(h.counters.refreshViewport, 2);
  assert.equal(h.counters.invalidations, 2);
  assert.equal(h.counters.geometry, 2);
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0][0], 'render.preview-layout-refresh');
  assert.equal(h.records[0][1].details.stableFrames, 2);
  assert.equal(h.records[0][1].details.previewBlocks, 7);
});

test('Atomic 7.9 hidden preview retries without rendering and observer recovery prevents first-visible blank', async () => {
  const h = createHarness({ width: 0, height: 0 });
  h.stability.start();
  h.stability.requestRefresh({ forceRender: true, reason: 'hidden-start' });
  await h.runOne(h.frames);
  assert.equal(h.counters.renders, 0);
  assert.equal(h.timers.size, 1);

  h.root.clientWidth = 640;
  h.root.clientHeight = 360;
  h.resizeCallback();
  assert.equal(h.timers.size, 0, 'observer recovery replaces hidden retry owner');
  assert.equal(h.frames.size, 1);
  await h.settleVisible();
  assert.equal(h.counters.renders, 1);
  await h.runOne(h.frames);
  assert.equal(h.counters.geometry, 2);
  assert.equal(h.records.at(-1)[1].details.reason, 'preview-became-visible');
});

test('Atomic 7.9 maximum attempts bounds unstable visible layout and still commits the latest geometry', async () => {
  const h = createHarness({ thresholds: { maxAttempts: 3, stableFrames: 9 } });
  h.stability.start();
  h.stability.requestRefresh({ forceRender: true, reason: 'unstable' });
  await h.runOne(h.frames);
  h.root.clientWidth += 20;
  await h.runOne(h.frames);
  h.root.clientWidth += 20;
  await h.runOne(h.frames);
  assert.equal(h.counters.renders, 1);
  assert.equal(h.records[0][1].details.attempts, 3);
  assert.equal(h.records[0][1].details.stableFrames, 0);
});

test('Atomic 7.9 skips redundant render for populated stable preview but still refreshes geometry', async () => {
  const h = createHarness();
  h.counters.stable = true;
  h.counters.target = { present: true, loading: false, empty: false };
  h.stability.start();
  h.stability.requestRefresh({ forceRender: false, reason: 'resize' });
  await h.settleVisible();
  assert.equal(h.counters.renders, 0);
  assert.equal(h.counters.geometry, 1);
  assert.equal(h.records[0][1].details.renderRequired, false);
  await h.runOne(h.frames);
  assert.equal(h.counters.geometry, 2);
});

test('Atomic 7.9 suspension and replacement requests prevent stale layout commits', async () => {
  const h = createHarness({ thresholds: { stableFrames: 0 } });
  h.stability.start();

  h.counters.suspended = true;
  h.stability.requestRefresh({ forceRender: true, reason: 'suspended' });
  await h.runOne(h.frames);
  assert.equal(h.counters.renders, 0);
  assert.equal(h.counters.geometry, 0);
  assert.equal(h.records.length, 0);

  h.counters.suspended = false;
  h.stability.requestRefresh({ forceRender: false, reason: 'old' });
  h.stability.requestRefresh({ forceRender: false, reason: 'new' });
  assert.equal(h.frames.size, 1);
  await h.runOne(h.frames);
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0][1].details.reason, 'new');
});

test('Atomic 7.9 destroy disconnects observer, cancels layout work and is terminal', () => {
  const h = createHarness();
  h.stability.start();
  h.stability.requestRefresh({ forceRender: true });
  assert.equal(h.frames.size, 1);
  h.stability.destroy();
  assert.equal(h.disconnected, 1);
  assert.equal(h.frames.size, 0);
  assert.doesNotThrow(() => h.stability.destroy());
  assert.throws(() => h.stability.start(), /destroyed/i);
  assert.throws(() => h.stability.cancel(), /destroyed/i);
});
