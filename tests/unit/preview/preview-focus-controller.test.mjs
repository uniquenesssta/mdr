import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewFocusController } from '../../../src/features/preview/pipeline/preview-focus-controller.js';

function createScheduler() {
  const pending = new Set();
  const calls = [];
  const scheduled = new Map();
  return {
    calls,
    pending,
    scheduled,
    schedule(channel, run, options) {
      calls.push(['schedule', channel, options]);
      pending.add(channel);
      scheduled.set(channel, run);
      return true;
    },
    cancel(channel) {
      calls.push(['cancel', channel]);
      pending.delete(channel);
      scheduled.delete(channel);
      return true;
    },
    hasPending(channel) {
      return pending.has(channel);
    }
  };
}

function createHarness(overrides = {}) {
  const scheduler = createScheduler();
  let mode = overrides.mode || 'chapter';
  let focusSection = overrides.focusSection || { startLine: 1, endLine: 10 };
  let virtualActive = overrides.virtualActive ?? true;
  let virtualContains = overrides.virtualContains ?? false;
  const events = [];
  const controller = createPreviewFocusController({ scheduler, focusDelay: 37 });
  controller.connect({
    isSuspended: () => false,
    isCursorTrackingEligible: () => true,
    getFocusSection: () => focusSection,
    getMode: () => mode,
    isVirtualWindowActive: () => virtualActive,
    virtualWindowContainsLine: () => virtualContains,
    async refreshPreview(context) {
      events.push(['refresh', context.line]);
      focusSection = { startLine: context.line, endLine: context.line + 4 };
      virtualContains = true;
      return true;
    },
    ensureLineVisible(line) {
      events.push(['ensure', line]);
      return { line };
    },
    invalidateAnchors() {
      events.push(['invalidate']);
    },
    scrollToLine(line, behavior, ratio) {
      events.push(['scroll', line, behavior, ratio]);
    },
    ...overrides.capabilities
  });
  return {
    controller,
    scheduler,
    events,
    setMode(value) { mode = value; },
    setFocusSection(value) { focusSection = value; },
    setVirtualActive(value) { virtualActive = value; },
    setVirtualContains(value) { virtualContains = value; }
  };
}

test('Atomic 7.11 refreshes chapter scope before ensure-line-visible and preview positioning', async () => {
  const harness = createHarness();
  const result = await harness.controller.focusLine(40, { behavior: 'smooth' });
  assert.equal(result, true);
  assert.deepEqual(harness.events, [
    ['refresh', 40],
    ['ensure', 40],
    ['invalidate'],
    ['scroll', 40, 'smooth', 0.5]
  ]);
  assert.ok(harness.scheduler.calls.some(call => call[0] === 'cancel' && call[1] === 'input'));
});

test('Atomic 7.11 stale focus cannot overwrite a newer request after async chapter refresh', async () => {
  let releaseOld;
  const scheduler = createScheduler();
  const events = [];
  let section = { startLine: 1, endLine: 10 };
  const controller = createPreviewFocusController({ scheduler, focusDelay: 0 });
  controller.connect({
    isSuspended: () => false,
    isCursorTrackingEligible: () => true,
    getFocusSection: () => section,
    getMode: () => 'chapter',
    isVirtualWindowActive: () => false,
    virtualWindowContainsLine: () => false,
    refreshPreview({ line }) {
      if (line === 50) return new Promise(resolve => { releaseOld = () => { section = { startLine: 50, endLine: 55 }; resolve(); }; });
      section = { startLine: line, endLine: line + 5 };
      return true;
    },
    ensureLineVisible: () => null,
    invalidateAnchors: () => events.push('invalidate'),
    scrollToLine: line => events.push(line)
  });

  const oldRequest = controller.focusLine(50);
  const newRequest = await controller.focusLine(5);
  assert.equal(newRequest, true);
  assert.deepEqual(events, [5]);
  releaseOld();
  assert.equal(await oldRequest, false);
  assert.deepEqual(events, [5]);
});

test('Atomic 7.11 deduplicates same-target scope refresh while only the newest request may commit focus', async () => {
  let release;
  let refreshCount = 0;
  const scheduler = createScheduler();
  const events = [];
  const controller = createPreviewFocusController({ scheduler });
  controller.connect({
    isSuspended: () => false,
    isCursorTrackingEligible: () => true,
    getFocusSection: () => ({ startLine: 1, endLine: 2 }),
    getMode: () => 'chapter',
    isVirtualWindowActive: () => false,
    virtualWindowContainsLine: () => false,
    refreshPreview() {
      refreshCount += 1;
      return new Promise(resolve => { release = resolve; });
    },
    ensureLineVisible: () => null,
    invalidateAnchors: () => {},
    scrollToLine: line => events.push(line)
  });

  const first = controller.focusLine(80);
  const second = controller.focusLine(80);
  assert.equal(refreshCount, 1);
  release();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(events, [80]);
});

test('Atomic 7.11 cursor focus scheduling occurs only when crossing the tracked chapter', () => {
  const harness = createHarness({ virtualActive: false, virtualContains: false });
  assert.equal(harness.controller.scheduleCursorFocus(5), false);
  assert.equal(harness.controller.scheduleCursorFocus(25), true);
  const call = harness.scheduler.calls.find(item => item[0] === 'schedule' && item[1] === 'focus');
  assert.deepEqual(call, ['schedule', 'focus', { kind: 'timeout', delay: 37 }]);
});

test('Atomic 7.11 cursor focus scheduling respects input ownership and suspension', () => {
  const scheduler = createScheduler();
  let suspended = false;
  const controller = createPreviewFocusController({ scheduler, focusDelay: 12 });
  controller.connect({
    isSuspended: () => suspended,
    isCursorTrackingEligible: () => true,
    getFocusSection: () => null,
    getMode: () => 'virtual',
    isVirtualWindowActive: () => false,
    virtualWindowContainsLine: () => false,
    refreshPreview: () => true,
    ensureLineVisible: () => null,
    invalidateAnchors: () => {},
    scrollToLine: () => {}
  });
  scheduler.pending.add('input');
  assert.equal(controller.scheduleCursorFocus(20), false);
  scheduler.pending.delete('input');
  suspended = true;
  assert.equal(controller.scheduleCursorFocus(20), false);
  assert.equal(scheduler.calls.filter(call => call[0] === 'schedule').length, 0);
});

test('Atomic 7.11 cancel and destroy invalidate pending requests and make destruction terminal', async () => {
  let release;
  const scheduler = createScheduler();
  const controller = createPreviewFocusController({ scheduler });
  controller.connect({
    isSuspended: () => false,
    isCursorTrackingEligible: () => true,
    getFocusSection: () => null,
    getMode: () => 'chapter',
    isVirtualWindowActive: () => false,
    virtualWindowContainsLine: () => false,
    refreshPreview: () => new Promise(resolve => { release = resolve; }),
    ensureLineVisible: () => null,
    invalidateAnchors: () => {},
    scrollToLine: () => assert.fail('cancelled focus must not scroll')
  });
  const pending = controller.focusLine(99);
  controller.cancel();
  release();
  assert.equal(await pending, false);
  controller.destroy();
  controller.destroy();
  assert.throws(() => controller.cancel(), /destroyed/);
  await assert.rejects(controller.focusLine(1), /destroyed/);
});
