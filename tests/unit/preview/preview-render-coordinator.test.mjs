import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreviewRenderCoordinator } from '../../../src/features/preview/pipeline/preview-render-coordinator.js';

function blocks(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `b-${index}`,
    startLine: index + 1,
    endLine: index + 1,
    start: index,
    end: index + 1,
    raw: `block ${index}`
  }));
}

function renderers(calls) {
  return {
    reuseStable(context) {
      calls.push(['reuse', context]);
      return { mode: 'unchanged' };
    },
    renderWholeDocument(context) {
      calls.push(['whole', context]);
      return { mode: 'worker-whole-document' };
    },
    mountVirtual(context) {
      calls.push(['virtual', context]);
      return { mode: 'virtual-window' };
    },
    mountChapter(context) {
      calls.push(['chapter', context]);
      return { mode: 'worker-chapter-preview' };
    },
    renderIncremental(context) {
      calls.push(['incremental', context]);
      return { mode: 'incremental' };
    }
  };
}

test('Render Coordinator selects the full incremental DOM path without reading presentation state', () => {
  const coordinator = createPreviewRenderCoordinator();
  const modelResult = {
    blocks: blocks(4),
    changedIds: new Set(['b-1']),
    removedIds: new Set(),
    incremental: true,
    reason: 'transactions'
  };
  const plan = coordinator.createPlan({
    modelResult,
    sourceLength: 1200,
    previewPerformanceMode: 'auto',
    previousMode: 'full',
    previousScopeKey: 'full',
    forceFullRebuild: false
  });

  assert.equal(plan.mode, 'full');
  assert.equal(plan.scopeKey, 'full');
  assert.equal(plan.scopeChanged, false);
  assert.equal(plan.strategy, 'dom-incremental');
  assert.equal(plan.renderResult, modelResult);

  const calls = [];
  const patchResult = coordinator.execute(plan, renderers(calls));
  assert.equal(patchResult.mode, 'incremental');
  assert.deepEqual(calls.map(([name]) => name), ['incremental']);
  coordinator.destroy();
});

test('Render Coordinator selects worker whole-document, virtual and chapter targets through explicit ports', () => {
  const coordinator = createPreviewRenderCoordinator();
  const calls = [];
  const ports = renderers(calls);

  const whole = coordinator.createPlan({
    modelResult: { blocks: blocks(5), wholeDocument: true, wholeHtml: '<p>x</p>' },
    sourceLength: 150000,
    previewPerformanceMode: 'full',
    previousMode: 'full',
    previousScopeKey: 'full'
  });
  assert.equal(whole.strategy, 'dom-whole-document');
  coordinator.execute(whole, ports);

  const virtual = coordinator.createPlan({
    modelResult: { blocks: blocks(50), changedIds: new Set(), removedIds: new Set() },
    sourceLength: 500000,
    previewPerformanceMode: 'auto',
    previousMode: 'full',
    previousScopeKey: 'full'
  });
  assert.equal(virtual.mode, 'virtual');
  assert.equal(virtual.strategy, 'virtual-mount');
  assert.equal(virtual.scopeChanged, true);
  coordinator.execute(virtual, ports);

  const chapterBlocks = blocks(60);
  const chapter = coordinator.createPlan({
    modelResult: {
      blocks: chapterBlocks,
      changedIds: new Set(['b-20', 'b-55']),
      removedIds: new Set(['removed']),
      focusChapter: {
        headingId: 'chapter-a',
        startLine: 21,
        endLine: 30,
        startIndex: 20,
        endIndex: 30
      }
    },
    sourceLength: 1200000,
    previewPerformanceMode: 'auto',
    previousMode: 'virtual',
    previousScopeKey: 'virtual'
  });
  assert.equal(chapter.mode, 'chapter');
  assert.equal(chapter.strategy, 'chapter-view');
  assert.equal(chapter.renderResult.blocks.length, 24);
  assert.ok(chapter.renderResult.blocks.some(block => block.id === 'b-20'));
  assert.ok(!chapter.renderResult.blocks.some(block => block.id === 'b-55'));
  assert.deepEqual([...chapter.renderResult.changedIds], ['b-20']);
  assert.match(chapter.scopeKey, /^chapter:chapter-a:30:/);
  coordinator.execute(chapter, ports);

  assert.deepEqual(calls.map(([name]) => name), ['whole', 'virtual', 'chapter']);
  coordinator.destroy();
});

test('Render Coordinator preserves unchanged reuse as its own strategy and never selects a second renderer', () => {
  const coordinator = createPreviewRenderCoordinator();
  const plan = coordinator.createPlan({
    modelResult: { blocks: blocks(3), reason: 'unchanged' },
    sourceLength: 3000,
    previewPerformanceMode: 'auto',
    previousMode: 'full',
    previousScopeKey: 'full',
    forceFullRebuild: false
  });
  assert.equal(plan.strategy, 'stable-reuse');

  const calls = [];
  const patch = coordinator.execute(plan, renderers(calls));
  assert.equal(patch.mode, 'unchanged');
  assert.deepEqual(calls.map(([name]) => name), ['reuse']);
  coordinator.destroy();
});

test('Render Coordinator forces a normal renderer when theme or scope invalidates unchanged reuse', () => {
  const coordinator = createPreviewRenderCoordinator();
  const modelResult = { blocks: blocks(3), reason: 'unchanged', incremental: true };

  const forced = coordinator.createPlan({
    modelResult,
    sourceLength: 3000,
    previewPerformanceMode: 'auto',
    previousMode: 'full',
    previousScopeKey: 'full',
    forceFullRebuild: true
  });
  assert.equal(forced.strategy, 'dom-incremental');
  assert.equal(forced.forceRender, true);

  const scopeChanged = coordinator.createPlan({
    modelResult,
    sourceLength: 500000,
    previewPerformanceMode: 'auto',
    previousMode: 'full',
    previousScopeKey: 'full',
    forceFullRebuild: false
  });
  assert.equal(scopeChanged.mode, 'virtual');
  assert.equal(scopeChanged.scopeChanged, true);
  assert.equal(scopeChanged.forceRender, true);
  assert.equal(scopeChanged.strategy, 'virtual-mount');
  coordinator.destroy();
});

test('Render Coordinator rejects incomplete renderer ports and all work after destroy', () => {
  const coordinator = createPreviewRenderCoordinator();
  const plan = coordinator.createPlan({
    modelResult: { blocks: blocks(1) },
    sourceLength: 10,
    previewPerformanceMode: 'full',
    previousMode: 'full',
    previousScopeKey: 'full'
  });

  assert.throws(() => coordinator.execute(plan, {}), /renderIncremental/);
  coordinator.destroy();
  assert.throws(() => coordinator.createPlan({ modelResult: {}, sourceLength: 0 }), /destroyed/);
  assert.throws(() => coordinator.execute(plan, renderers([])), /destroyed/);
});
