import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionFeedbackGuard, createSelectionRetryScheduler } from '../src/features/sync/index.js';
import { createFinalSelectionController, createFrames } from './helpers/stage-09-selection-controller-harness.mjs';

function createTimers() {
  let nextId = 1;
  const callbacks = new Map();
  const active = new Set();
  return {
    set(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      active.add(id);
      return id;
    },
    clear(id) { active.delete(id); },
    activeCount() { return active.size; },
    activeIds() { return [...active]; },
    flush(id = this.activeIds()[0]) {
      if (!id || !active.has(id)) return;
      active.delete(id);
      callbacks.get(id)?.();
    },
    flushAll() { for (const id of [...active]) this.flush(id); },
    force(id) { callbacks.get(id)?.(); }
  };
}

test('R9-08 Feedback Guard begins immutable sequence/source/revision transactions and validates sources', () => {
  const guard = createSelectionFeedbackGuard();
  const token = guard.begin('editor');
  assert.deepEqual(token, { sequence: 1, source: 'editor', revision: 0 });
  assert.equal(Object.isFrozen(token), true);
  assert.deepEqual(guard.getState(), { sequence: 1, source: 'editor', revision: 0, active: true, destroyed: false });
  assert.throws(() => guard.begin('other'), /editor or preview/);
  guard.destroy();
});

test('R9-08 Feedback Guard blocks opposite-side feedback and optional same-source reentrancy without one boolean lock', () => {
  const guard = createSelectionFeedbackGuard();
  guard.begin('preview');
  assert.equal(guard.shouldIgnore('editor', { allowSource: true }), true);
  assert.equal(guard.shouldIgnore('preview', { allowSource: true }), false);
  assert.equal(guard.shouldIgnore('preview'), true);
  guard.destroy();
});

test('R9-08 Feedback Guard revision invalidates stale events while preserving an active source across preview replacement', () => {
  const guard = createSelectionFeedbackGuard();
  guard.begin('editor');
  assert.equal(guard.advanceRevision(), 1);
  assert.equal(guard.shouldIgnore('preview', { revision: 0, allowSource: true }), true);
  assert.equal(guard.shouldIgnore('preview', { revision: 1, allowSource: true }), true);
  assert.equal(guard.shouldIgnore('editor', { revision: 1, allowSource: true }), false);
  assert.deepEqual(guard.getState(), { sequence: 1, source: 'editor', revision: 1, active: true, destroyed: false });
  guard.destroy();
});

test('R9-08 Feedback Guard sequence prevents a stale release callback from unlocking a newer transaction', () => {
  const timers = createTimers();
  const guard = createSelectionFeedbackGuard({ setTimer: callback => timers.set(callback), clearTimer: id => timers.clear(id) });
  const first = guard.begin('preview');
  guard.release(first, 96);
  const [staleTimer] = timers.activeIds();
  const second = guard.begin('preview');
  assert.equal(second.sequence, 2);
  timers.force(staleTimer);
  assert.equal(guard.getState().source, 'preview');
  guard.release(second, 0);
  assert.equal(guard.getState().source, '');
  guard.destroy();
});

test('R9-08 Feedback Guard reset cancels release work and stale forced callbacks cannot republish authority', () => {
  const timers = createTimers();
  const guard = createSelectionFeedbackGuard({ setTimer: callback => timers.set(callback), clearTimer: id => timers.clear(id) });
  const token = guard.begin('editor');
  guard.release(token, 32);
  const [staleTimer] = timers.activeIds();
  guard.reset();
  assert.equal(timers.activeCount(), 0);
  assert.equal(guard.getState().source, '');
  const next = guard.begin('preview');
  timers.force(staleTimer);
  assert.equal(guard.getState().source, 'preview');
  assert.ok(next.sequence > token.sequence);
  guard.destroy();
});

test('R9-08 Feedback Guard destroy is terminal idempotent and fail-safe for late feedback reads', () => {
  const guard = createSelectionFeedbackGuard();
  guard.begin('editor');
  guard.destroy();
  guard.destroy();
  assert.equal(guard.shouldIgnore('preview'), true);
  assert.equal(guard.getState().destroyed, true);
  assert.equal(guard.getState().source, '');
  assert.throws(() => guard.begin('editor'), /destroyed/);
  assert.throws(() => guard.advanceRevision(), /destroyed/);
});

test('R9-08 final SelectionSyncController uses the shared Guard to reject editor feedback during preview settlement', () => {
  const timers = createTimers();
  const frames = createFrames();
  const guard = createSelectionFeedbackGuard({ setTimer: callback => timers.set(callback), clearTimer: id => timers.clear(id) });
  const { controller, editor } = createFinalSelectionController({ frames, feedbackGuard: guard });
  try {
    controller.start();
    const token = guard.begin('preview');
    guard.release(token, 96);
    assert.equal(guard.getState().source, 'preview');
    editor.emit('select');
    assert.equal(frames.activeCount(), 0);
    assert.equal(controller.getState().ignoredFeedbackEvents, 1);
    timers.flushAll();
    editor.emit('select');
    assert.equal(frames.activeCount(), 1);
  } finally {
    controller.destroy();
    guard.destroy();
  }
});

test('R9-08 final SelectionSyncController exposes applyingSide/previewRevision from Guard state instead of owning duplicates', () => {
  const guard = createSelectionFeedbackGuard();
  const { controller } = createFinalSelectionController({ feedbackGuard: guard });
  const token = guard.begin('editor');
  controller.notifyPreviewMounted();
  assert.equal(controller.getState().applyingSide, 'editor');
  assert.equal(controller.getState().previewRevision, 1);
  guard.release(token, 0);
  assert.equal(controller.getState().applyingSide, '');
  controller.destroy();
  guard.destroy();
});

test('preview-owned wheel geometry never schedules an old editor selection to scroll the preview', () => {
  const { controller, frames } = createFinalSelectionController();
  controller.scrollController.getState = () => ({ sourceSide: 'preview' });
  controller.notifyEditorGeometry();
  assert.equal(frames.activeCount(), 0);
  controller.destroy();
});

test('a new editor wheel also supersedes the earlier selection alignment and pending editor retries', () => {
  let mounts = 0;
  const { controller } = createFinalSelectionController({ getPreviewVirtual: () => ({ active: true,
    containsLineRange: () => true, hasLineRangeMounted: () => false, ensureLineRangeVisible() { mounts += 1; } }) });
  controller.prepareEditorIntent(controller.editorSelectionReader.read());
  controller.scrollController.getState = () => ({ sourceSide: 'editor', sourceReason: 'wheel' });
  assert.equal(controller.shouldRealignEditorSelection(), false);
  assert.equal(controller.runEditor(true, 'editor-pointerup-retry', true, 1).status, 'offscreen');
  assert.equal(mounts, 0);
  controller.destroy();
});

function createChapterSelection() {
  const frames = createFrames(), timers = createTimers();
  const guard = createSelectionFeedbackGuard({ setTimer: callback => timers.set(callback), clearTimer: id => timers.clear(id) });
  const retry = createSelectionRetryScheduler({ requestFrame: callback => frames.request(callback), cancelFrame: id => frames.cancel(id) });
  const calls = [], scroll = { sourceSide: 'editor', sourceReason: 'pointer' };
  let mounted = false, finish;
  const ready = new Promise(resolve => { finish = resolve; });
  const range = { getClientRects: () => [{ top: 30, bottom: 50, left: 0, right: 20, width: 20, height: 20 }] };
  const h = createFinalSelectionController({ frames, feedbackGuard: guard, retryScheduler: retry,
    highlightSession: { canPresent: () => true, show() { calls.push('highlight'); }, restore() {}, clear() {} },
    selectionMapping: { createPreviewRangesForSourceSelection: () => ({ ranges: [range], sourceCharacters: 4, mappedCharacters: 4, projectionCoverage: 1 }), mapPreviewDomPointToSource() {} },
    getPreviewVirtual: () => ({ active: true, containsLineRange: () => mounted, hasLineRangeMounted: () => mounted, ensureLineRangeVisible: () => ({}) }),
    focusPreviewLine(line, options) { calls.push(['focus', line, options.scroll]); return ready; }
  });
  h.previewMapper.getAnchors = () => [{ dataset: { sourceStartIndex: '0', sourceEndIndex: '10' } }];
  h.controller.scrollController.getState = () => scroll;
  h.controller.scrollController.scrollTo = () => { calls.push('scroll'); };
  return { ...h, frames, timers, guard, calls, scroll, retry,
    async mount() { mounted = true; h.controller.notifyPreviewMounted('chapter-ready'); finish(true); await Promise.resolve(); await Promise.resolve(); },
    destroy() { h.controller.destroy(); guard.destroy(); retry.destroy(); }
  };
}

test('one selection awaits chapter readiness and presents an already-visible exact highlight without scrolling', async () => {
  const h = createChapterSelection();
  try {
    assert.equal(h.controller.runEditor(true, 'editor-pointerup', true, 0).status, 'pending');
    h.frames.flushAll();
    await Promise.resolve();
    assert.equal(h.calls.filter(call => Array.isArray(call)).length, 1, 'one chapter request must replace frame polling');
    assert.deepEqual(h.calls[0], ['focus', 1, false], 'scope preparation must leave scrolling to the current exact selection');
    await h.mount();
    h.frames.flushAll();
    assert.equal(h.calls.filter(call => call === 'highlight').length, 1);
    assert.equal(h.calls.filter(call => call === 'scroll').length, 0, 'the mounted target is already visible; no scroll or second gesture is needed');
  } finally { h.destroy(); }
});

test('wrapped source selections align to the actual character row instead of the paragraph height midpoint', async () => {
  const h = createChapterSelection();
  try {
    await h.mount();
    h.editorApi.getPositionCoordinates = () => ({ top: 90, bottom: 110 });
    h.editorApi.getScrollViewportRect = () => ({ top: 0, bottom: 200 });
    const result = h.controller.syncEditorToPreview(false, 'wrapped-source');
    assert.equal(result.status, 'exact');
    assert.equal(result.sourceViewportRatio, 0.5, 'line-block midpoint would incorrectly return 0.1');
  } finally { h.destroy(); }
});

for (const change of ['wheel', 'pointer', 'selection', 'document', 'destroy']) {
  test(`late chapter readiness cannot align after a newer ${change}`, async () => {
    const h = createChapterSelection();
    try {
      h.controller.runEditor(true, 'editor-pointerup', true, 0);
      if (change === 'wheel') h.scroll.sourceReason = 'wheel';
      if (change === 'pointer') { h.controller.start(); h.editor.emit('pointerdown'); }
      if (change === 'selection') h.controller.editorSelectionReader.read = () => ({ from: 6, to: 9, isCollapsed: false });
      if (change === 'document') h.documentModel.generation = 1;
      if (change === 'destroy') h.controller.destroy();
      await h.mount(); h.frames.flushAll(); h.timers.flushAll(); h.frames.flushAll();
      assert.equal(h.calls.includes('scroll'), false);
      assert.equal(h.calls.includes('highlight'), false);
    } finally { h.destroy(); }
  });
}
