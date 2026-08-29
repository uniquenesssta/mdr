import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreviewController } from '../../../src/features/preview/application/preview-controller.js';
import { mountPreviewCommandHandler } from '../../../src/features/preview/application/preview-command-handler.js';

function createHarness() {
  const calls = [];
  const runtime = {
    setTimeout(callback) { calls.push('setTimeout'); callback(); return 1; },
    clearTimeout() { calls.push('clearTimeout'); }
  };
  const documentRef = {
    defaultView: runtime,
    body: { dataset: {} },
    getElementById() { return null; }
  };
  const root = {
    ownerDocument: documentRef,
    hidden: false,
    scrollTop: 0,
    clientHeight: 400,
    replaceChildren() { calls.push('replaceChildren'); },
    querySelector() { return null; }
  };
  const editor = { textLength: 0, value: '', selectionStart: 0, virtualEditor: null };
  const documentModel = { getNonWhitespaceCount() { return 0; } };
  const layoutState = { snapshot: { mode: 'preview' } };
  const state = {
    snapshot: { mode: 'full', status: 'idle', lastStableResult: null, focusSection: null, error: null },
    invalidate() { calls.push('state.invalidate'); return 1; },
    isCurrentVersion() { return true; }
  };
  const scheduler = {
    schedule(channel) { calls.push(`schedule:${channel}`); return 1; },
    cancel(channel) { calls.push(`cancel:${channel}`); }
  };
  const layoutStability = {
    connect(port) { calls.push('layout.connect'); this.port = port; },
    start() { calls.push('layout.start'); },
    cancel() { calls.push('layout.cancel'); },
    requestRefresh(options) { calls.push(['layout.refresh', options]); return 'layout-refresh'; }
  };
  const focusController = {
    connect(port) { calls.push('focus.connect'); this.port = port; },
    scheduleCursorFocus(line) { calls.push(['focus.schedule', line]); return line; },
    cancel() { calls.push('focus.cancel'); },
    focusLine(line, options) { calls.push(['focus.line', line, options]); return 'focus-result'; }
  };
  const enhancementCoordinator = {
    connect(port) { calls.push('enhancement.connect'); this.port = port; },
    begin(version) { calls.push(['enhancement.begin', version]); }
  };
  const renderer = {
    renderTaskLists() {}, renderCode() {}, renderMath() {}, renderMermaid() {}
  };
  const recoveryView = { inspect() { return { present: false, recovery: false, empty: true }; } };
  const renderEngine = {
    update() { calls.push('engine.update'); return 'update-result'; },
    reset() { calls.push('engine.reset'); return 'reset-result'; },
    deactivateVirtual() { calls.push('engine.deactivate'); return true; },
    getVirtualStats() { return { blocks: 9, mountedBlocks: 3 }; },
    isVirtualActive() { return true; },
    containsVirtualLine(line) { return line === 11; },
    containsVirtualLineRange(from, to) { return from === 10 && to === 12; },
    hasVirtualLineRangeMounted(from, to) { return from === 10 && to === 12; },
    ensureVirtualLineVisible(line) { return { line }; },
    ensureVirtualLineRangeVisible(from, to) { return { from, to }; },
    getVirtualMountedAnchors() { return ['anchor']; },
    getVirtualMetrics() { return [{ startLine: 10, endLine: 12 }]; },
    getVirtualContentYForLine(line) { return line * 10; },
    getVirtualLineForContentY(y) { return y / 10; },
    refreshVirtualViewport(options) { calls.push(['engine.refresh', options]); return true; },
    scheduleVirtualMeasure() { calls.push('engine.measure'); },
    animateChanges() {},
    destroy() { calls.push('engine.destroy'); }
  };
  const presentation = { math: { containsMath() { return false; } } };
  const shell = {};

  const controller = createPreviewController({
    root,
    editor,
    documentModel,
    layoutState,
    state,
    scheduler,
    layoutStability,
    focusController,
    enhancementCoordinator,
    renderer,
    recoveryView,
    renderEngine,
    presentation,
    shell
  });
  return { controller, calls };
}

test('Atomic 7.14 command handler accepts the canonical PreviewController and exposes one virtual facade', () => {
  const { controller } = createHarness();
  const host = {};
  const mounted = mountPreviewCommandHandler(host, controller);

  assert.equal(host.markdownEditorPreviewCommandPort, mounted.port);
  assert.equal(mounted.port.virtual.active, true);
  assert.deepEqual(mounted.port.virtual.getStats(), { blocks: 9, mountedBlocks: 3 });
  assert.deepEqual(mounted.port.virtual.getMountedAnchors(), ['anchor']);
  assert.deepEqual(mounted.port.virtual.getMetrics(), [{ startLine: 10, endLine: 12 }]);
  assert.equal(mounted.port.virtual.getContentYForLine(11), 110);
  assert.equal(mounted.port.virtual.getLineForContentY(110), 11);
  assert.equal(mounted.port.virtual.containsLineRange(10, 12), true);
  assert.equal(mounted.port.virtual.hasLineRangeMounted(10, 12), true);
  assert.deepEqual(mounted.port.virtual.ensureLineRangeVisible(10, 12), { from: 10, to: 12 });
  assert.deepEqual(mounted.port.virtual.ensureLineVisible(11), { line: 11 });

  mounted.destroy();
  assert.equal(Object.hasOwn(host, 'markdownEditorPreviewCommandPort'), false);
  assert.throws(() => mounted.port.virtual.getMetrics(), /destroyed/);
  controller.destroy();
});

test('Atomic 7.14 PreviewController lifecycle is idempotent and destroys its RenderEngine exactly once', () => {
  const { controller, calls } = createHarness();
  assert.equal(controller.start(), true);
  assert.equal(controller.start(), false);
  assert.equal(controller.requestLayoutRefresh({ forceRender: true }), 'layout-refresh');
  assert.equal(controller.focusLine(11, { reason: 'test' }), 'focus-result');

  controller.destroy();
  controller.destroy();
  assert.equal(calls.filter(value => value === 'engine.destroy').length, 1);
  assert.throws(() => controller.update(), /destroyed/);
});
