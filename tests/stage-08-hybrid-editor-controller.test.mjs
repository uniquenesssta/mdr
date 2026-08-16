
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHybridDecorationCoordinator,
  createHybridEditorController
} from '../src/features/hybrid-editor/index.js';

function createDoc(text = '') {
  return {
    length: text.length,
    lines: Math.max(1, text.split('\n').length),
    sliceString(from, to) { return text.slice(from, to); }
  };
}

function createDecorationCoordinator(overrides = {}) {
  return createHybridDecorationCoordinator({
    getSyntaxTree: () => ({}),
    getEditableRanges: () => [],
    getActiveSourceRange: () => null,
    collectHybridBlocks: () => [],
    buildInlinePresentation: () => ({ ranges: [], stats: { visibleLines: 1, decoratedLines: 1 } }),
    createBlockDecoration: () => null,
    createDecorationSet: ranges => [...ranges],
    emptyDecorations: [],
    getTableVisualEditing: () => false,
    getCodeVisualEditing: () => false,
    now: () => 0,
    ...overrides
  });
}

function createControllerHarness(overrides = {}) {
  const microtasks = [];
  const calls = [];
  const sourceEditorPort = { destroy: () => calls.push('source-editor-destroy') };
  const sourceEditController = {
    handleEditorUpdate: () => calls.push('source-update'),
    closeFromPointer: () => false,
    destroy: () => calls.push('source-controller-destroy')
  };
  const sourceEditPortMount = { destroy: () => calls.push('source-mount-destroy') };
  let generation = 0;
  const decorationCoordinator = {
    build() {
      generation += 1;
      return {
        decorations: [`inline-${generation}`],
        blockDecorations: [`block-${generation}`],
        blockSignature: `sig-${generation}`,
        stats: { decoratedLines: generation }
      };
    }
  };
  const view = { destroyed: false, dom: { isConnected: true } };
  const controller = createHybridEditorController({
    view,
    decorationCoordinator,
    sourceEditorPort,
    sourceEditController,
    sourceEditPortMount,
    dispatchBlockDecorations: (_view, value) => calls.push(['dispatch', value]),
    isBlockDecorationUpdate: () => false,
    configurationChanged: () => false,
    destroyGeometry: () => calls.push('geometry-destroy'),
    destroySession: () => calls.push('session-destroy'),
    enqueueMicrotask: callback => microtasks.push(callback),
    ...overrides
  });
  return { controller, view, calls, microtasks, decorationCoordinator, sourceEditController };
}

test('Atomic 8.15 decoration coordinator requires explicit integration capabilities', () => {
  assert.throws(() => createHybridDecorationCoordinator({}), /getSyntaxTree/);
  assert.equal(typeof createDecorationCoordinator().build, 'function');
});

test('Atomic 8.15 preserves the EOF double-newline presentation correction for code and Mermaid only', () => {
  const coordinator = createDecorationCoordinator();
  const view = { state: { doc: createDoc('abc\n\n') } };
  assert.deepEqual(coordinator.getBlockPresentationRange(view, { type: 'code', from: 0, to: 5 }), { from: 0, to: 4 });
  assert.deepEqual(coordinator.getBlockPresentationRange(view, { type: 'mermaid', from: 0, to: 5 }), { from: 0, to: 4 });
  assert.deepEqual(coordinator.getBlockPresentationRange(view, { type: 'html', from: 0, to: 5 }), { from: 0, to: 5 });
});

test('Atomic 8.15 decoration coordinator rejects invalid block ranges and reports them without aborting the build', () => {
  const diagnostics = [];
  const coordinator = createDecorationCoordinator({
    collectHybridBlocks: () => [
      { type: 'html', from: 0, to: 2, source: 'ok' },
      { type: 'html', from: 1, to: 4, source: 'overlap' }
    ],
    createBlockDecoration: (_view, descriptor) => descriptor.source,
    reportDiagnostic: (operation, options) => diagnostics.push([operation, options])
  });
  const view = { state: { doc: createDoc('abcd') } };
  const result = coordinator.build(view);
  assert.deepEqual(result.blockDecorations, ['ok']);
  assert.equal(result.stats.renderedBlocks, 1);
  assert.equal(diagnostics.some(([operation]) => operation === 'hybrid.invalid-block-range'), true);
});

test('Atomic 8.15 block signatures preserve content and visual-editing identity', () => {
  const coordinator = createDecorationCoordinator();
  const blocks = [{ type: 'code', from: 1, to: 5, language: 'js', code: 'x' }];
  const off = coordinator.getBlockSignature(blocks, { codeVisualEditing: false });
  const on = coordinator.getBlockSignature(blocks, { codeVisualEditing: true });
  assert.notEqual(off, on);
  assert.notEqual(off, coordinator.getBlockSignature([{ ...blocks[0], code: 'y' }], { codeVisualEditing: false }));
});

test('Atomic 8.15 editor controller coalesces deferred block publication and publishes the latest candidate', () => {
  const { controller, microtasks, calls } = createControllerHarness();
  assert.equal(microtasks.length, 1);
  controller.scheduleBlockUpdate(['newest'], 'sig-newest');
  assert.equal(microtasks.length, 1);
  microtasks.shift()();
  assert.deepEqual(calls.filter(value => Array.isArray(value)), [['dispatch', ['newest']]]);
});

test('Atomic 8.15 editor controller rebuilds only for meaningful editor/configuration updates', () => {
  let configChanged = false;
  const { controller, view, calls } = createControllerHarness({ configurationChanged: () => configChanged });
  const idle = { view, transactions: [], docChanged: false, selectionSet: false, viewportChanged: false, focusChanged: false };
  assert.equal(controller.update(idle), false);
  assert.equal(calls.filter(value => value === 'source-update').length, 1);
  configChanged = true;
  assert.equal(controller.update(idle), true);
  assert.deepEqual(controller.getDecorations(), ['inline-2']);
});

test('Atomic 8.15 destroy is idempotent, preserves cleanup order and rejects queued late block publication', () => {
  const { controller, microtasks, calls } = createControllerHarness();
  controller.destroy();
  controller.destroy();
  while (microtasks.length) microtasks.shift()();
  assert.deepEqual(calls, [
    'source-mount-destroy',
    'source-controller-destroy',
    'source-editor-destroy',
    'geometry-destroy',
    'session-destroy'
  ]);
  assert.equal(controller.update({}), false);
});
