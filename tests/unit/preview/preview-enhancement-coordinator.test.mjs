import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewEnhancementCoordinator } from '../../../src/features/preview/pipeline/preview-enhancement-coordinator.js';

function createScheduler() {
  let inputPending = false;
  let queue = [];
  const events = [];
  return {
    events,
    setInputPending(value) { inputPending = Boolean(value); },
    schedule(channel, callback, options = {}) {
      events.push(['schedule', channel, options.kind]);
      queue = queue.filter(item => item.channel !== channel);
      queue.push({ channel, callback, options });
      return { cancel: () => this.cancel(channel) };
    },
    cancel(channel) {
      events.push(['cancel', channel]);
      const had = queue.some(item => item.channel === channel);
      queue = queue.filter(item => item.channel !== channel);
      return had;
    },
    hasPending(channel) {
      if (channel === 'input') return inputPending;
      return queue.some(item => item.channel === channel);
    },
    async runNext({ timeRemaining = 10, didTimeout = false } = {}) {
      const item = queue.shift();
      if (!item) return false;
      const task = {
        deadline: { didTimeout, timeRemaining: () => timeRemaining },
        schedule: (callback, options = {}) => {
          queue.push({ channel: item.channel, callback, options });
          events.push(['continue', item.channel, options.kind]);
          return true;
        }
      };
      await item.callback(task);
      return true;
    },
    pendingKinds() { return queue.map(item => item.options.kind); },
    pendingCount() { return queue.length; }
  };
}

function createHarness(options = {}) {
  const scheduler = options.scheduler || createScheduler();
  const events = [];
  const meta = new WeakMap();
  let currentVersion = 1;
  let releaseMermaid = null;
  const coordinator = createPreviewEnhancementCoordinator({
    scheduler,
    thresholds: { idleTimeoutMs: 180, fallbackMs: 16, minimumTimeRemainingMs: 3 }
  });
  coordinator.connect({
    getLineRange(root) { return meta.get(root)?.range || { start: 1, end: 1 }; },
    getPriority(root) { return meta.get(root)?.priority; },
    hasMath(root) { return Boolean(meta.get(root)?.math); },
    hasMermaid(root) { return Boolean(meta.get(root)?.mermaid); },
    isConnected(root) { return meta.get(root)?.connected !== false; },
    styleRoots([root]) { events.push(`style:${meta.get(root)?.name}`); },
    renderMath([root]) { events.push(`math:${meta.get(root)?.name}`); },
    async renderMermaid([root], isCancelled) {
      events.push(`mermaid:start:${meta.get(root)?.name}`);
      if (meta.get(root)?.holdMermaid) {
        await new Promise(resolve => { releaseMermaid = resolve; });
      }
      events.push(`mermaid:end:${meta.get(root)?.name}:${isCancelled() ? 'cancelled' : 'current'}`);
    },
    animate([root]) { events.push(`animate:${meta.get(root)?.name}`); },
    onBatchComplete(type, root) { events.push(`complete:${type}:${meta.get(root)?.name}`); },
    isVersionCurrent(version) { return version === currentVersion; }
  });
  coordinator.begin(1);
  return {
    coordinator,
    scheduler,
    events,
    root(name, data = {}) {
      const root = {};
      meta.set(root, { name, connected: true, range: { start: 1, end: 1 }, ...data });
      return root;
    },
    setCurrentVersion(value) { currentVersion = value; },
    releaseMermaid() { releaseMermaid?.(); }
  };
}

async function drain(scheduler, limit = 40) {
  for (let index = 0; index < limit && scheduler.pendingCount(); index += 1) await scheduler.runNext();
}

test('Atomic 7.12 validates scheduler and one-time capability connection', () => {
  assert.throws(() => createPreviewEnhancementCoordinator(), /requires Preview Scheduler/);
  const scheduler = createScheduler();
  const coordinator = createPreviewEnhancementCoordinator({ scheduler });
  assert.throws(() => coordinator.begin(1), /not connected/);
  assert.throws(() => coordinator.connect({}), /getLineRange/);
});

test('Atomic 7.12 orders visible, chapter and buffer enhancements and keeps math before Mermaid', async () => {
  const h = createHarness();
  const buffer = h.root('buffer', { priority: 2, math: true, mermaid: true });
  const chapter = h.root('chapter', { priority: 1, math: true, mermaid: true });
  const visible = h.root('visible', { priority: 0, math: true, mermaid: true });
  h.coordinator.enqueue([buffer, chapter, visible], [visible]);
  await drain(h.scheduler);
  const starts = h.events.filter(value => !value.startsWith('complete') && !value.startsWith('animate'));
  assert.deepEqual(starts, [
    'style:visible', 'math:visible', 'mermaid:start:visible', 'mermaid:end:visible:current',
    'style:chapter', 'math:chapter', 'mermaid:start:chapter', 'mermaid:end:chapter:current',
    'style:buffer', 'math:buffer', 'mermaid:start:buffer', 'mermaid:end:buffer:current'
  ]);
});

test('Atomic 7.12 does not run secondary enhancement while input is pending', async () => {
  const h = createHarness();
  const root = h.root('visible', { priority: 0, math: true });
  h.coordinator.enqueue([root]);
  h.scheduler.setInputPending(true);
  await h.scheduler.runNext();
  assert.deepEqual(h.events, []);
  assert.equal(h.scheduler.pendingCount(), 1);
  h.scheduler.setInputPending(false);
  await drain(h.scheduler);
  assert.ok(h.events.includes('math:visible'));
});

test('Atomic 7.12 begin cancels queued work and invalidates the previous render generation', async () => {
  const h = createHarness();
  const oldRoot = h.root('old', { priority: 0, math: true });
  h.coordinator.enqueue([oldRoot]);
  h.setCurrentVersion(2);
  h.coordinator.begin(2);
  await drain(h.scheduler);
  assert.deepEqual(h.events, []);
  assert.equal(h.coordinator.getStats().version, 2);
  assert.equal(h.coordinator.getStats().pending, 0);
});

test('Atomic 7.12 stale async Mermaid cannot commit after a newer begin', async () => {
  const h = createHarness();
  const oldRoot = h.root('old', { priority: 0, mermaid: true, holdMermaid: true });
  h.coordinator.enqueue([oldRoot]);
  const running = h.scheduler.runNext();
  await new Promise(resolve => setTimeout(resolve, 0));
  h.setCurrentVersion(2);
  h.coordinator.begin(2);
  const fresh = h.root('fresh', { priority: 0, math: true });
  h.coordinator.enqueue([fresh]);
  h.releaseMermaid();
  await running;
  await drain(h.scheduler);
  assert.ok(h.events.includes('mermaid:end:old:cancelled'));
  assert.ok(!h.events.includes('complete:mermaid:old'));
  assert.ok(h.events.includes('math:fresh'));
});

test('Atomic 7.12 deduplicates heavy jobs for roots re-enqueued in the same generation', async () => {
  const h = createHarness();
  const root = h.root('same', { priority: 0, math: true, mermaid: true });
  h.coordinator.enqueue([root]);
  h.coordinator.enqueue([root]);
  await drain(h.scheduler);
  assert.equal(h.events.filter(value => value === 'math:same').length, 1);
  assert.equal(h.events.filter(value => value === 'mermaid:start:same').length, 1);
  assert.equal(h.events.filter(value => value === 'style:same').length, 2);
});

test('Atomic 7.12 postprocess frame work preempts queued background work without losing it', async () => {
  const h = createHarness();
  const root = h.root('root', { priority: 0, math: true });
  h.coordinator.enqueue([root]);
  const order = [];
  h.coordinator.schedulePostprocess({
    renderVersion: 1,
    run: () => order.push('annotate'),
    finish: () => order.push('finish'),
    deferFinish: true
  });
  assert.equal(h.scheduler.pendingKinds()[0], 'frame');
  await h.scheduler.runNext();
  assert.deepEqual(order, ['annotate']);
  await drain(h.scheduler);
  assert.deepEqual(order, ['annotate', 'finish']);
  assert.ok(h.events.includes('math:root'));
});

test('Atomic 7.12 skips disconnected roots before presentation work', async () => {
  const h = createHarness();
  const root = h.root('gone', { priority: 0, math: true, mermaid: true, connected: false });
  h.coordinator.enqueue([root]);
  await drain(h.scheduler);
  assert.deepEqual(h.events, []);
});

test('Atomic 7.12 cancel clears pending work and cancels the enhancement lane', async () => {
  const h = createHarness();
  h.coordinator.enqueue([h.root('pending', { math: true })]);
  assert.ok(h.coordinator.getStats().pending > 0);
  h.coordinator.cancel();
  assert.equal(h.coordinator.getStats().pending, 0);
  assert.ok(h.scheduler.events.some(event => event[0] === 'cancel' && event[1] === 'enhancement'));
  await drain(h.scheduler);
  assert.deepEqual(h.events, []);
});

test('Atomic 7.12 destroy is idempotent, cancels work and makes mutation terminal', () => {
  const h = createHarness();
  h.coordinator.destroy();
  h.coordinator.destroy();
  assert.throws(() => h.coordinator.enqueue([]), /destroyed/);
  assert.throws(() => h.coordinator.begin(2), /destroyed/);
  assert.deepEqual(h.coordinator.getStats(), { version: 1, pending: 0, priorityRange: null, running: false });
});
