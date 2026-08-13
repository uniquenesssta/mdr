import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreviewCancellation } from '../../../src/features/preview/pipeline/preview-cancellation.js';
import { createPreviewScheduler } from '../../../src/features/preview/pipeline/preview-scheduler.js';

function createHarness() {
  let sequence = 0;
  const timers = new Map();
  const frames = new Map();
  const idles = new Map();
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
    cancelFrame(id) { frames.delete(id); },
    requestIdle(callback) {
      const id = ++sequence;
      idles.set(id, callback);
      return id;
    },
    cancelIdle(id) { idles.delete(id); }
  });
  const runOne = async map => {
    const [entry] = map.entries();
    assert.ok(entry, 'expected one scheduled callback');
    const [id, callback] = entry;
    map.delete(id);
    await callback({ didTimeout: false, timeRemaining: () => 8 });
    await Promise.resolve();
  };
  return { cancellation, scheduler, timers, frames, idles, runOne };
}

test('Atomic 7.4 coalesces only within the same channel', async () => {
  const { scheduler, timers, runOne } = createHarness();
  const commits = [];

  scheduler.schedule('input', task => task.commit(() => commits.push('input-old')), { kind: 'timeout', delay: 10 });
  scheduler.schedule('focus', task => task.commit(() => commits.push('focus')), { kind: 'timeout', delay: 10 });
  scheduler.schedule('input', task => task.commit(() => commits.push('input-new')), { kind: 'timeout', delay: 10 });

  assert.equal(timers.size, 2);
  assert.equal(scheduler.hasPending('input'), true);
  assert.equal(scheduler.hasPending('focus'), true);

  await runOne(timers);
  await runOne(timers);
  assert.deepEqual(commits.sort(), ['focus', 'input-new']);
});

test('Atomic 7.4 old async work cannot commit after a newer task owns the channel', async () => {
  const { scheduler, timers, runOne } = createHarness();
  const commits = [];
  let releaseOld;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });

  const old = scheduler.schedule('layout', async task => {
    await oldGate;
    task.commit(() => commits.push('old'));
  }, { kind: 'timeout' });
  await runOne(timers);

  const fresh = scheduler.schedule('layout', task => {
    task.commit(() => commits.push('fresh'));
  }, { kind: 'timeout' });
  await runOne(timers);

  assert.equal(old.isCurrent(), false);
  assert.equal(fresh.isCurrent(), true);
  releaseOld();
  await old.done;
  assert.deepEqual(commits, ['fresh']);
});

test('Atomic 7.4 continuation keeps its token and is cancelled by a newer channel owner', async () => {
  const { scheduler, frames, runOne } = createHarness();
  const commits = [];

  const old = scheduler.schedule('enhancement', task => {
    task.schedule(next => next.commit(() => commits.push('old-continuation')), { kind: 'frame' });
  }, { kind: 'frame' });
  await runOne(frames);
  assert.equal(frames.size, 1);

  scheduler.schedule('enhancement', task => task.commit(() => commits.push('fresh')), { kind: 'frame' });
  assert.equal(old.isCurrent(), false);
  assert.equal(frames.size, 1);
  await runOne(frames);

  assert.deepEqual(commits, ['fresh']);
});

test('Atomic 7.4 cancel and destroy clear queued resources and block old callbacks', async () => {
  const { scheduler, timers, frames, idles } = createHarness();
  const commits = [];

  const input = scheduler.schedule('input', task => task.commit(() => commits.push('input')), { kind: 'timeout' });
  const layout = scheduler.schedule('layout', task => task.commit(() => commits.push('layout')), { kind: 'frame' });
  const enhancement = scheduler.schedule('enhancement', task => task.commit(() => commits.push('enhancement')), { kind: 'idle' });

  scheduler.cancel('input');
  assert.equal(input.isCurrent(), false);
  assert.equal(timers.size, 0);
  assert.equal(frames.size, 1);
  assert.equal(idles.size, 1);

  scheduler.destroy();
  assert.equal(layout.isCurrent(), false);
  assert.equal(enhancement.isCurrent(), false);
  assert.equal(frames.size, 0);
  assert.equal(idles.size, 0);
  assert.deepEqual(commits, []);
  assert.throws(() => scheduler.schedule('input', () => {}, { kind: 'timeout' }), /destroyed/i);
});

test('Atomic 7.4 background resources are cancelled with their channel token', async () => {
  const callbacks = new Map();
  const cancelled = [];
  let sequence = 0;
  const backgroundScheduler = {
    schedule(key, callback, options) {
      const id = ++sequence;
      callbacks.set(id, { key, callback, options });
      return {
        cancel() {
          callbacks.delete(id);
          cancelled.push(key);
        }
      };
    }
  };
  const cancellation = createPreviewCancellation();
  const scheduler = createPreviewScheduler({
    cancellation,
    getBackgroundScheduler: () => backgroundScheduler
  });
  const commits = [];

  const stale = scheduler.schedule('enhancement', task => task.commit(() => commits.push('stale')), {
    kind: 'background',
    timeout: 260
  });
  const fresh = scheduler.schedule('enhancement', task => task.commit(() => commits.push('fresh')), {
    kind: 'background',
    timeout: 260
  });

  assert.equal(stale.isCurrent(), false);
  assert.equal(fresh.isCurrent(), true);
  assert.equal(cancelled.length, 1);
  assert.equal(callbacks.size, 1);
  const [{ callback, options }] = callbacks.values();
  assert.deepEqual(options, { priority: 'background', timeout: 260 });
  callbacks.clear();
  callback({ signal: new AbortController().signal, deadline: { didTimeout: false, timeRemaining: () => 6 } });
  await fresh.done;

  assert.deepEqual(commits, ['fresh']);
});

test('Atomic 7.4 background fallback uses configured timer delay when idle scheduling is unavailable', async () => {
  const timers = new Map();
  const delays = [];
  let sequence = 0;
  const cancellation = createPreviewCancellation();
  const scheduler = createPreviewScheduler({
    cancellation,
    requestIdle: null,
    cancelIdle: null,
    getBackgroundScheduler: () => null,
    setTimer(callback, delay) {
      const id = ++sequence;
      timers.set(id, callback);
      delays.push(delay);
      return id;
    },
    clearTimer(id) { timers.delete(id); }
  });
  const commits = [];

  const task = scheduler.schedule('enhancement', context => {
    assert.equal(context.deadline.didTimeout, true);
    context.commit(() => commits.push('fallback'));
  }, { kind: 'background', fallbackMs: 32 });

  assert.deepEqual(delays, [32]);
  const callback = timers.values().next().value;
  timers.clear();
  callback();
  await task.done;
  assert.deepEqual(commits, ['fallback']);
});

test('Atomic 7.4 reports cleanup failures while invalidating the affected task', () => {
  const errors = [];
  const cancellation = createPreviewCancellation();
  const scheduler = createPreviewScheduler({
    cancellation,
    requestFrame(callback) { return callback; },
    cancelFrame() { throw new Error('frame release failed'); },
    reportError(message, error) { errors.push([message, error]); }
  });
  const task = scheduler.schedule('layout', () => {}, { kind: 'frame' });

  assert.doesNotThrow(() => scheduler.cancel('layout'));
  assert.equal(task.isCurrent(), false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], 'Preview Scheduler resource cleanup failed.');
  assert.equal(errors[0][1] instanceof AggregateError, true);
});
