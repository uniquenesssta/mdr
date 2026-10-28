
import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
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

test('source-origin selections retain the activated source range without changing presentation-origin drag behavior', () => {
  const coordinator = createDecorationCoordinator();
  const doc = createDoc('before\n\nsource **bold**\n\nafter');
  const view = { state: { doc, selection: { main: { empty: false, anchor: 10, head: 21 } } }, hasFocus: true };
  assert.deepEqual(coordinator.build(view).editableSourceRanges, []);
  const source = [{ from: 8, to: 23, revealBlock: true }];
  let retained = source;
  for (let i = 0; i < 100; i += 1) retained = coordinator.build(view, { sourceSelectionRanges: retained }).editableSourceRanges;
  assert.deepEqual(retained, source, 'Repeated pointer updates must not accumulate duplicate source ranges');
  view.hasFocus = false;
  assert.deepEqual(coordinator.build(view, { sourceSelectionRanges: retained }).editableSourceRanges, []);
});

test('Hybrid source-selection memory is discarded on document replacement and destroy', () => {
  const first = {}, second = {}, captured = [];
  const view = { state: { doc: first }, dom: { isConnected: true } };
  const ranges = [{ from: 8, to: 23, revealBlock: true }];
  const h = createControllerHarness({ view, decorationCoordinator: {
    build(_view, options) { captured.push(options?.sourceSelectionRanges || []); return {
      decorations: [], blockDecorations: [], blockSignature: '', stats: {}, editableSourceRanges: ranges
    }; }
  } });
  h.controller.refreshPresentation();
  assert.deepEqual(captured.at(-1), ranges);
  view.state.doc = second;
  h.controller.refreshPresentation();
  assert.deepEqual(captured.at(-1), []);
  h.controller.destroy();
  assert.deepEqual(h.controller.sourceSelectionRanges, []);
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

test('table presentation consumes only its empty separator, preserving the following editable paragraph', () => {
  for (const suffix of ['\n\nnext', '\n\n\nnext', '\nnext', '', '\n']) {
    const table = '| a | b |\n| - | - |\n| c | d |';
    const view = { state: EditorState.create({ doc: table + suffix }) };
    const range = createDecorationCoordinator().getBlockPresentationRange(view, { type: 'table', from: 0, to: table.length });
    assert.equal(range.to, table.length + (suffix === '\n' || suffix.startsWith('\n\n') ? 1 : 0), suffix);
    assert.equal(view.state.doc.sliceString(0, table.length), table);
  }
});

test('composition protects the active text from block replacement and releases it when composition ends', () => {
  const source = { from: 20, to: 40, revealBlock: true };
  const explicit = { from: 60, to: 80 };
  const seen = [];
  const coordinator = createDecorationCoordinator({
    getEditableRanges: () => [source], getActiveSourceRange: () => explicit,
    collectHybridBlocks: (_view, _tree, ranges) => { seen.push(ranges); return []; }
  });
  const view = { state: { doc: createDoc('x'.repeat(100)) }, compositionStarted: true };
  coordinator.build(view);
  view.compositionStarted = false;
  coordinator.build(view);
  assert.deepEqual(seen, [[explicit, source], [explicit]]);
});

test('IME protection also covers a separator consumed only by the presentation range', () => {
  const table = '| a | b |\n| - | - |\n| c | d |';
  const separator = { from: table.length + 1, to: table.length + 1, revealBlock: true };
  const coordinator = createDecorationCoordinator({
    getEditableRanges: () => [separator],
    collectHybridBlocks: () => [{ type: 'table', from: 0, to: table.length }]
  });
  const view = { state: EditorState.create({ doc: table + '\n\nafter' }), compositionStarted: true };
  assert.equal(coordinator.build(view).stats.renderedBlocks, 0);
  view.compositionStarted = false;
  assert.equal(coordinator.build(view).stats.renderedBlocks, 1);
});

test('composition-only refresh publishes current presentation and ignores a destroyed view', () => {
  const h = createControllerHarness();
  h.controller.refreshPresentation();
  h.microtasks.shift()();
  assert.deepEqual(h.calls.filter(Array.isArray), [['dispatch', ['block-2']]]);
  h.view.destroyed = true;
  assert.equal(h.controller.refreshPresentation(), false);
  h.controller.destroy();
  assert.equal(h.controller.refreshPresentation(), false);
});

test('replacing a document republishes decorations even when the table signature is identical', () => {
  const h = createControllerHarness();
  h.view.state = { doc: {} };
  h.controller.refreshPresentation();
  h.microtasks.shift()();
  h.view.state = { doc: {} };
  h.controller.scheduleBlockUpdate(['block-2'], 'sig-2');
  h.microtasks.shift()();
  assert.deepEqual(h.calls.filter(Array.isArray), [['dispatch', ['block-2']], ['dispatch', ['block-2']]]);
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
