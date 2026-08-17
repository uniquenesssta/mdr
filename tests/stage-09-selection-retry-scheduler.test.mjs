import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionRetryScheduler } from '../src/features/sync/index.js';
import { createFinalSelectionController, createFrames } from './helpers/stage-09-selection-controller-harness.mjs';

function createGuard() {
  let revision = 0;
  return {
    begin(source) { return { sequence: 1, source, revision }; },
    shouldIgnore() { return false; },
    advanceRevision() { revision += 1; return revision; },
    release() { return true; },
    reset() {},
    getRevision() { return revision; },
    getState() { return { source: '', revision }; }
  };
}

test('R9-10 Retry Scheduler requires explicit frame capabilities and versioned retry jobs', () => {
  assert.throws(() => createSelectionRetryScheduler(), /requestFrame\/cancelFrame/);
  const frames = createFrames();
  const scheduler = createSelectionRetryScheduler({ requestFrame: cb => frames.request(cb), cancelFrame: id => frames.cancel(id) });
  assert.throws(() => scheduler.schedule({ version: 1, run() {} }), /getVersion\/run/);
  assert.throws(() => scheduler.schedule({ getVersion: () => 1, run() {} }), /version token/);
  scheduler.destroy();
});

test('R9-10 Retry Scheduler owns one next-frame recoverable attempt and publishes immutable attempt context', () => {
  const frames = createFrames();
  const scheduler = createSelectionRetryScheduler({ requestFrame: cb => frames.request(cb), cancelFrame: id => frames.cancel(id) });
  const calls = [];
  assert.equal(scheduler.schedule({ version: 'v1', getVersion: () => 'v1', run: context => calls.push(context) }), true);
  assert.equal(frames.activeCount(), 1);
  frames.flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { generation: 1, version: 'v1', attempt: 1, maxRetries: 3 });
  assert.equal(Object.isFrozen(calls[0]), true);
  assert.deepEqual(scheduler.getState(), {
    generation: 1, version: 'v1', attempts: 1, maxRetries: 3, pending: false, pendingAttempt: 0,
    scheduled: 1, executed: 1, cancelled: 0, stale: 0, destroyed: false
  });
  scheduler.destroy();
});

test('R9-10 Retry Scheduler enforces the bounded retry count without Controller-owned attempt state', () => {
  const frames = createFrames();
  const scheduler = createSelectionRetryScheduler({ requestFrame: cb => frames.request(cb), cancelFrame: id => frames.cancel(id), maxRetries: 3 });
  const attempts = [];
  for (let expected = 1; expected <= 3; expected += 1) {
    assert.equal(scheduler.schedule({ version: 9, getVersion: () => 9, run: ({ attempt }) => attempts.push(attempt) }), true);
    frames.flush();
  }
  assert.equal(scheduler.schedule({ version: 9, getVersion: () => 9, run() {} }), false);
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.equal(scheduler.getState().attempts, 3);
  assert.equal(scheduler.getState().scheduled, 3);
  scheduler.destroy();
});

test('R9-10 Retry Scheduler automatically replaces an older retry and forced stale callbacks cannot execute', () => {
  const frames = createFrames();
  const scheduler = createSelectionRetryScheduler({ requestFrame: cb => frames.request(cb), cancelFrame: id => frames.cancel(id) });
  const calls = [];
  scheduler.schedule({ version: 'old', getVersion: () => 'old', run: () => calls.push('old') });
  const [oldFrame] = frames.activeIds();
  scheduler.schedule({ version: 'new', getVersion: () => 'new', run: ({ attempt }) => calls.push(`new:${attempt}`) });
  assert.equal(frames.activeCount(), 1);
  frames.force(oldFrame);
  assert.deepEqual(calls, []);
  frames.flush();
  assert.deepEqual(calls, ['new:1']);
  assert.equal(scheduler.getState().cancelled, 1);
  scheduler.destroy();
});

test('R9-10 Retry Scheduler drops a pending retry when the caller version changes without a replacement request', () => {
  const frames = createFrames();
  let version = 'v1';
  const scheduler = createSelectionRetryScheduler({ requestFrame: cb => frames.request(cb), cancelFrame: id => frames.cancel(id) });
  let ran = false;
  scheduler.schedule({ version, getVersion: () => version, run: () => { ran = true; } });
  version = 'v2';
  frames.flush();
  assert.equal(ran, false);
  assert.equal(scheduler.getState().stale, 1);
  assert.equal(scheduler.getState().version, null);
  assert.equal(scheduler.getState().attempts, 0);
  scheduler.destroy();
});

test('R9-10 Retry Scheduler cancel/destroy invalidate pending work and remain terminal/idempotent', () => {
  const frames = createFrames();
  const scheduler = createSelectionRetryScheduler({ requestFrame: cb => frames.request(cb), cancelFrame: id => frames.cancel(id) });
  let ran = 0;
  scheduler.schedule({ version: 1, getVersion: () => 1, run: () => { ran += 1; } });
  const [staleFrame] = frames.activeIds();
  scheduler.cancel();
  frames.force(staleFrame);
  assert.equal(ran, 0);
  assert.equal(frames.activeCount(), 0);
  scheduler.destroy();
  scheduler.destroy();
  assert.equal(scheduler.getState().destroyed, true);
  assert.throws(() => scheduler.schedule({ version: 1, getVersion: () => 1, run() {} }), /destroyed/);
});

test('R9-10 final SelectionSyncController delegates only recoverable pending editor results with makeEditorKey version checks', () => {
  const frames = createFrames();
  const scheduled = [];
  const retryScheduler = {
    cancel() {},
    schedule(options) { scheduled.push(options); return true; }
  };
  let virtualPending = true;
  const { controller } = createFinalSelectionController({
    frames,
    feedbackGuard: createGuard(),
    retryScheduler,
    getPreviewVirtual: () => virtualPending ? {
      active: true,
      containsLineRange: () => false,
      hasLineRangeMounted: () => false
    } : null
  });
  controller.runEditor(false, 'test', true, 0);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].version, '7:2:6:0');
  assert.equal(scheduled[0].getVersion(), '7:2:6:0');
  virtualPending = false;
  controller.runEditor(false, 'test-failed', true, 0);
  assert.equal(scheduled.length, 1);
  controller.destroy();
});

test('R9-10 final SelectionSyncController cancels stale retries at lifecycle boundaries while Scheduler owns retry replacement', () => {
  const frames = createFrames();
  let cancels = 0;
  const scheduled = [];
  const retryScheduler = {
    cancel() { cancels += 1; },
    schedule(options) { scheduled.push(options); return true; }
  };
  const { controller } = createFinalSelectionController({
    frames,
    feedbackGuard: createGuard(),
    retryScheduler,
    getPreviewVirtual: () => ({ active: true, containsLineRange: () => false, hasLineRangeMounted: () => false })
  });
  controller.start();
  controller.scheduleEditor(false, 'fresh');
  assert.equal(cancels, 1);
  frames.flush();
  assert.equal(scheduled.length, 1);
  const cancelsBeforeRetryReplacement = cancels;
  scheduled[0].run({ attempt: 1 });
  assert.equal(scheduled.length, 2);
  assert.equal(cancels, cancelsBeforeRetryReplacement);
  controller.clear();
  assert.equal(cancels, 2);
  controller.stop();
  assert.equal(cancels, 3);
  controller.destroy();
});