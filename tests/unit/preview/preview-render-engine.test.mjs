import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreviewRenderEngine } from '../../../src/features/preview/pipeline/preview-render-engine.js';
import { createPreviewEnhancementCoordinator } from '../../../src/features/preview/pipeline/preview-enhancement-coordinator.js';
import { createMermaidRenderer } from '../../../src/features/preview/render/mermaid-renderer.js';

function createHarness({ sourceLength = 32, workerFailure = false, stable = false, body = null,
  scheduler: suppliedScheduler = null, enhancements = null, reuseAfterFirst = false } = {}) {
  const calls = [];
  const previewBody = body || { children: [{ id: 'rendered' }] };
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
  let version = 0;
  const state = {
    snapshot,
    beginRender() { calls.push('state.beginRender'); return ++version; },
    isCurrentVersion(value) { return value === version; },
    setFocusSection(_version, section) { snapshot.focusSection = section; calls.push('state.focus'); },
    commitStable(_version, value) { calls.push(['state.stable', value]); snapshot.lastStableResult = value.result; },
    commitDegraded(_version, value) { calls.push(['state.degraded', value]); snapshot.error = value.error; },
    failRender(_version, value) { calls.push(['state.failed', value]); snapshot.error = value.error; },
    invalidate(value) { calls.push(['state.invalidate', value]); return 2; }
  };
  const scheduler = suppliedScheduler || {
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
      if (reuseAfterFirst && snapshot.lastStableResult) return ports.reuseStable({ renderResult: plan.modelResult });
      return ports.renderIncremental({ renderResult: plan.modelResult, forceRender: false });
    }
  };
  const renderer = {
    patchBlocks(result) {
      calls.push('renderer.patchBlocks');
      return { body: previewBody, changedNodes: body ? [...body.children] : [], reused: 0, parsedChars: result.parsedChars, virtualized: false };
    },
    patchHtml() { calls.push('renderer.patchHtml'); return { body: previewBody, changedNodes: [], reused: 0, virtualized: false }; },
    createBlockNodes() { return []; },
    applyBlockSourceRange() {}
  };
  const enhancementCoordinator = enhancements || {
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
    state,
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

function createEnhancementRaceHarness(t, { holdFirstDiagram = false } = {}) {
  class Element {
    dataset = {};
    attributes = [];
    isConnected = true;
    classList = { add() {}, remove() {} };
    querySelectorAll() { return []; }
    matches() { return false; }
  }
  class Pre extends Element {
    matches(selector) { return selector === 'pre'; }
    querySelector() { return this.code; }
    replaceWith(container) {
      assert.equal(this.isConnected, true, 'Only the current render may replace a connected fence.');
      this.isConnected = false;
      body.children[body.children.indexOf(this)] = container;
    }
  }
  for (const [key, value] of Object.entries({ Element, HTMLPreElement: Pre })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  const math = new Element(), pre = new Pre(), body = new Element();
  pre.code = { textContent: 'flowchart LR\n A --> B', closest: () => pre };
  body.children = [math, pre];
  body.querySelectorAll = () => pre.isConnected ? [pre.code] : [];
  let queue = [];
  const scheduler = {
    schedule(channel, callback) { this.cancel(channel); queue.push({ channel, callback }); },
    cancel(channel) { queue = queue.filter(item => item.channel !== channel); },
    cancelAll() { queue = []; },
    hasPending(channel) { return queue.some(item => item.channel === channel); },
    async runNext() {
      const job = queue.shift();
      if (!job) return false;
      await job.callback({
        isCurrent: () => true,
        commit(callback) { callback(); return true; },
        schedule: callback => { queue.push({ channel: job.channel, callback }); return true; },
        deadline: { didTimeout: true, timeRemaining: () => 10 }
      });
      return true;
    },
    async drain() {
      for (let count = 0; queue.length && count < 30; count += 1) await this.runNext();
      assert.equal(queue.length, 0, 'Enhancement work must settle without another preview update.');
    }
  };
  let harness, releaseDiagram, diagramCalls = 0, mathCalls = 0;
  const events = [];
  const mermaid = createMermaidRenderer({ root: body,
    documentRef: { body: {}, createElement: () => new Element() },
    presentation: { mermaid: { async renderDiagram(container, _source, { isCancelled }) {
      diagramCalls += 1;
      if (holdFirstDiagram && diagramCalls === 1) await new Promise(resolve => { releaseDiagram = resolve; });
      if (isCancelled()) { events.push('diagram:cancelled'); return { status: 'cancelled' }; }
      container.dataset.mermaidRendered = 'true';
      events.push('diagram:committed'); return { status: 'rendered' };
    } } }
  });
  const enhancements = createPreviewEnhancementCoordinator({ scheduler });
  enhancements.connect({
    getLineRange: () => ({ start: 1, end: 1 }), getPriority: () => 0,
    hasMath: node => node === math && !math.rendered,
    hasMermaid: node => node === pre && pre.isConnected,
    isConnected: node => node.isConnected,
    styleRoots() {}, renderMath() { mathCalls += 1; math.rendered = true; },
    renderMermaid: (roots, isCancelled) => mermaid.render(roots, isCancelled),
    animate() { events.push('animate'); }, onBatchComplete() {},
    isVersionCurrent: version => harness.state.isCurrentVersion(version)
  });
  harness = createHarness({ body, scheduler, enhancements, reuseAfterFirst: true });
  t.after(() => { harness.engine.destroy(); enhancements.destroy(); mermaid.destroy(); });
  return { ...harness, scheduler, enhancements, body, math, pre, events,
    releaseDiagram: () => releaseDiagram(), get diagramCalls() { return diagramCalls; },
    get mathCalls() { return mathCalls; } };
}

for (const supersedingUpdates of [1, 3]) {
  test(`R14-05 reused preview resumes cancelled queued math and Mermaid after ${supersedingUpdates} superseding updates`, async t => {
    const h = createEnhancementRaceHarness(t);
    await h.engine.update();
    assert.ok(h.enhancements.getStats().pending > 0);
    for (let index = 0; index < supersedingUpdates; index += 1) {
      assert.equal((await h.engine.update()).mode, 'unchanged-enhancement-retry');
    }
    await h.scheduler.drain();
    assert.equal(h.math.rendered, true);
    assert.equal(h.mathCalls, 1);
    assert.equal(h.diagramCalls, 1);
    assert.deepEqual(h.events, ['diagram:committed'], 'Reused content must not replay entry animations.');
    assert.equal(h.body.children[1].dataset.mermaidRendered, 'true');
  });
}

test('R14-05 reused busy Mermaid fence renders in the new generation after the old result is cancelled', async t => {
  const h = createEnhancementRaceHarness(t, { holdFirstDiagram: true });
  await h.engine.update();
  await h.scheduler.runNext(); // annotation frame, before the background render
  const oldRender = h.scheduler.runNext();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.diagramCalls, 1);
  assert.equal(h.pre.dataset.mermaidRendering, 'true');
  assert.equal(h.enhancements.getStats().running, true);
  assert.equal((await h.engine.update()).mode, 'unchanged-enhancement-retry');
  h.releaseDiagram(); await oldRender; await h.scheduler.drain();
  assert.equal(h.mathCalls, 1);
  assert.equal(h.diagramCalls, 2);
  assert.deepEqual(h.events.filter(event => event.startsWith('diagram:')), ['diagram:cancelled', 'diagram:committed']);
  assert.equal(h.body.children[1].dataset.mermaidRendered, 'true');
  assert.equal(h.enhancements.getStats().pending, 0);
});

test('R14-05 settled unchanged preview keeps its fast path without replaying enhancement work', async t => {
  const h = createEnhancementRaceHarness(t);
  await h.engine.update(); await h.scheduler.drain();
  const before = [...h.events];
  assert.equal((await h.engine.update()).mode, 'unchanged');
  await h.scheduler.drain();
  assert.equal(h.mathCalls, 1); assert.equal(h.diagramCalls, 1);
  assert.deepEqual(h.events, before);
});
