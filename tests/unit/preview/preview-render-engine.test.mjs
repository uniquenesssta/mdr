import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreviewRenderEngine } from '../../../src/features/preview/pipeline/preview-render-engine.js';

function createHarness({ sourceLength = 32, workerFailure = false, stable = false } = {}) {
  const calls = [];
  const previewBody = { children: [{ id: 'rendered' }] };
  const documentBody = {
    dataset: {},
    classList: { contains() { return false; } },
    getAttribute() { return 'light'; }
  };
  const documentRef = { body: documentBody, defaultView: { localStorage: null } };
  const root = {
    ownerDocument: documentRef,
    clientWidth: 800,
    scrollTop: 0,
    replaceChildren() { calls.push('root.replaceChildren'); },
    querySelector(selector) { return selector === '.markdown-body' ? previewBody : null; }
  };
  const editor = { textLength: sourceLength, value: '# preview', virtualEditor: null };
  const documentModel = {
    getTextLength() { return sourceLength; },
    createSnapshot() { calls.push('model.snapshot'); return '# preview'; },
    getDocumentVersion() { return 7; }
  };
  const snapshot = {
    mode: 'full',
    status: 'idle',
    lastStableResult: stable ? { scopeKey: 'full', renderMode: 'dom-keyed' } : null,
    focusSection: null,
    error: null
  };
  const state = {
    snapshot,
    beginRender() { calls.push('state.beginRender'); return 1; },
    isCurrentVersion(version) { return version === 1; },
    setFocusSection(_version, section) { snapshot.focusSection = section; calls.push('state.focus'); },
    commitStable(_version, value) { calls.push(['state.stable', value]); snapshot.lastStableResult = value.result; },
    commitDegraded(_version, value) { calls.push(['state.degraded', value]); snapshot.error = value.error; },
    failRender(_version, value) { calls.push(['state.failed', value]); snapshot.error = value.error; },
    invalidate(value) { calls.push(['state.invalidate', value]); return 2; }
  };
  const scheduler = {
    cancel(channel) { calls.push(['scheduler.cancel', channel]); },
    cancelAll() { calls.push('scheduler.cancelAll'); }
  };
  const modelResult = {
    tokens: [],
    referenceDefinitions: {},
    focusChapter: null,
    statistics: { characters: sourceLength },
    headings: [],
    headingIndexChanged: false,
    documentVersion: 7,
    blocks: [{ id: 'b1', startLine: 1, endLine: 1 }],
    changedIds: ['b1'],
    removedIds: [],
    parsedChars: sourceLength,
    incremental: true
  };
  const renderCoordinator = {
    createPlan({ modelResult: result }) {
      return { mode: 'full', scopeKey: 'full', scopeChanged: false, modelResult: result };
    },
    execute(plan, ports) {
      return ports.renderIncremental({ renderResult: plan.modelResult, forceRender: false });
    }
  };
  const renderer = {
    patchBlocks(result) {
      calls.push('renderer.patchBlocks');
      return { body: previewBody, changedNodes: [], reused: 0, parsedChars: result.parsedChars, virtualized: false };
    },
    patchHtml() { calls.push('renderer.patchHtml'); return { body: previewBody, changedNodes: [], reused: 0, virtualized: false }; },
    createBlockNodes() { return []; },
    applyBlockSourceRange() {}
  };
  const enhancementCoordinator = {
    begin(version) { calls.push(['enhancement.begin', version]); },
    setPriorityRange(range) { calls.push(['enhancement.priority', range]); },
    enqueue() { calls.push('enhancement.enqueue'); },
    schedulePostprocess(job) { calls.push('enhancement.postprocess'); job.run?.(); job.finish?.(); },
    cancel() { calls.push('enhancement.cancel'); },
    getStats() { return { pending: 0 }; }
  };
  const recoveryView = {
    inspect() { return stable ? { present: true, recovery: false, empty: false } : { present: false, recovery: false, empty: true }; },
    recover({ preserveStable }) { calls.push(['recovery', preserveStable]); return { body: previewBody, preserved: preserveStable }; }
  };
  let renderWholeCalls = 0;
  const markdownRenderer = {
    updateIncremental() { calls.push('markdown.incremental'); return modelResult; },
    setReferenceDefinitions() {},
    resetIncremental() { calls.push('markdown.reset'); },
    renderFragment() { return ''; },
    renderWhole() { renderWholeCalls += 1; return { html: '<p>fallback</p>', tokens: [] }; },
    destroy() { calls.push('markdown.destroy'); }
  };
  let workerFactoryCalls = 0;
  let workerDestroyCalls = 0;
  const createWorkerClient = () => {
    workerFactoryCalls += 1;
    return {
      async update() {
        calls.push('worker.update');
        if (workerFailure) throw new Error('worker failed');
        return modelResult;
      },
      destroy() { workerDestroyCalls += 1; calls.push('worker.destroy'); }
    };
  };
  const createVirtualController = () => { throw new Error('virtual controller should not be required in this harness'); };
  const shell = {
    getPreviewPerformanceMode() { return 'auto'; },
    getEditorFontSize() { return 16; },
    preparePreviewEditorMetrics() {},
    updateDocumentStatistics() {},
    updatePreviewStrategyBadge() {},
    invalidatePreviewAnchorStructure() {},
    refreshPreviewAnchorStructure() {},
    getPreviewAnchorCount() { return 0; },
    getPreviewAnchorMetrics() { return []; },
    annotatePreviewSourceLines() {}
  };

  const engine = createPreviewRenderEngine({
    root,
    editor,
    documentModel,
    state,
    scheduler,
    renderCoordinator,
    renderer,
    enhancementCoordinator,
    recoveryView,
    markdownRenderer,
    createWorkerClient,
    createVirtualController,
    shell,
    layoutState: { snapshot: { mode: 'preview' } },
    selectionController: { notifyPreviewReplaced() {}, notifyPreviewMounted() {} },
    scrollController: {},
    notify(message) { calls.push(['notify', message]); },
    now: () => 1
  });

  return {
    engine,
    calls,
    previewBody,
    get workerFactoryCalls() { return workerFactoryCalls; },
    get workerDestroyCalls() { return workerDestroyCalls; },
    get renderWholeCalls() { return renderWholeCalls; }
  };
}

test('Atomic 7.14 RenderEngine keeps small-document incremental rendering on the canonical main-thread path', async () => {
  const harness = createHarness({ sourceLength: 32 });
  const result = await harness.engine.update();

  assert.equal(harness.workerFactoryCalls, 0);
  assert.equal(result.body, harness.previewBody);
  assert.equal(harness.calls.includes('renderer.patchBlocks'), true);
  assert.equal(harness.calls.some(value => Array.isArray(value) && value[0] === 'state.stable'), true);
  assert.equal(harness.renderWholeCalls, 0);

  harness.engine.destroy();
  assert.equal(harness.calls.filter(value => value === 'markdown.destroy').length, 1);
  await assert.rejects(harness.engine.update(), /destroyed/);
});

test('Atomic 7.14 Worker failure preserves the stable preview and never falls through to whole-document main-thread rendering', async () => {
  const harness = createHarness({ sourceLength: 100000, workerFailure: true, stable: true });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  let result;
  try {
    result = await harness.engine.update();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], 'Incremental preview fallback:');
  assert.match(String(warnings[0][1]?.message || warnings[0][1]), /worker failed/);
  assert.equal(harness.workerFactoryCalls, 1);
  assert.equal(harness.workerDestroyCalls, 1);
  assert.equal(harness.renderWholeCalls, 0);
  assert.equal(result.mode, 'worker-safe-fallback-stale');
  assert.deepEqual(harness.calls.find(value => Array.isArray(value) && value[0] === 'recovery'), ['recovery', true]);
  assert.equal(harness.calls.some(value => Array.isArray(value) && value[0] === 'state.degraded'), true);

  harness.engine.destroy();
});
