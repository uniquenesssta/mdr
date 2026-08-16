import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPreviewScrollMapper,
  createSelectionSyncController
} from '../src/features/sync/index.js';

function createTarget() {
  const listeners = new Map();
  return {
    clientHeight: 200,
    scrollTop: 0,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
    getBoundingClientRect() { return { top: 0, bottom: 200, left: 0, right: 300 }; },
    contains(node) { return Boolean(node?.inside); }
  };
}

function createGuard() {
  let revision = 0;
  return {
    begin(source) { return { sequence: 1, source, revision }; },
    shouldIgnore() { return false; },
    advanceRevision() { revision += 1; return revision; },
    release() { return true; },
    reset() {},
    getRevision() { return revision; },
    getState() { return { source: '', revision }; }
  };
}

function createReader(snapshot = null) {
  return {
    read: () => snapshot,
    subscribe() { return () => {}; },
    start() {},
    stop() {}
  };
}

function createFrames() {
  let next = 1;
  const callbacks = new Map();
  return {
    request(callback) { const id = next++; callbacks.set(id, callback); return id; },
    cancel(id) { callbacks.delete(id); },
    flush(id = [...callbacks.keys()][0]) { const callback = callbacks.get(id); callbacks.delete(id); callback?.(); }
  };
}

function createController(overrides = {}) {
  const editor = createTarget();
  const preview = createTarget();
  const frames = createFrames();
  const documentRef = createTarget();
  const highlightCalls = [];
  const source = 'alpha\n\nbeta';
  const documentModel = {
    getTextLength: () => source.length,
    sliceText: (from, to) => source.slice(from, to),
    getDocumentVersion: () => 4
  };
  const editorApi = {
    selection: { start: 0, end: 0 },
    getSelection() { return this.selection; },
    setSelection(start, end) { this.selection = { start, end }; },
    focus() {}
  };
  const editorMapper = {
    getLineNumberAtPosition(position) { return position < 7 ? 1 : 3; },
    getContentYForPosition(position) { return position < 7 ? 20 : 100; }
  };
  const previewMapper = {
    anchors: [],
    getAnchors() { return this.anchors; },
    getMetrics() { return []; },
    getContentYForLine(line) { return line * 20; },
    invalidateStructure() {}
  };
  const highlightSession = {
    canPresent(plan) { return Boolean(plan?.ranges?.length); },
    show(plan, options) { highlightCalls.push({ plan, options }); return true; },
    restore() { return false; },
    clear() { highlightCalls.push({ clear: true }); }
  };
  const retryScheduler = { cancel() {}, schedule() { return false; } };
  const selectionMapping = {
    createPreviewRangesForSourceSelection() { return { ranges: [], atomicElements: [], sourceCharacters: 0, mappedCharacters: 0, projectionCoverage: 1 }; },
    mapPreviewDomPointToSource() { return null; }
  };
  const scrollWrites = [];
  const controller = createSelectionSyncController(editor, preview, {
    editorApi,
    documentModel,
    editorMapper,
    getPreviewMapper: () => previewMapper,
    getPreviewVirtual: () => null,
    focusPreviewLine: () => false,
    editorSelectionReader: createReader(),
    previewSelectionReader: createReader(),
    feedbackGuard: createGuard(),
    highlightSession,
    retryScheduler,
    selectionMapping,
    scrollController: { scrollTo(...args) { scrollWrites.push(args); return true; } },
    documentRef,
    requestFrame: callback => frames.request(callback),
    cancelFrame: id => frames.cancel(id),
    now: () => 100,
    isHybridLayout: () => false,
    updateActiveLine() {},
    record() {},
    diagnostic() {},
    ...overrides
  });
  return { controller, editor, preview, editorApi, documentModel, editorMapper, previewMapper, highlightCalls, scrollWrites, frames };
}

function makeAnchor(start, end, line) {
  return {
    inside: true,
    dataset: {
      sourceStartIndex: String(start),
      sourceEndIndex: String(end),
      sourceLine: String(line),
      sourceEndLine: String(line)
    }
  };
}

test('R9-12 PreviewScrollMapper annotates only exact render metadata and never invents ranges for extra DOM children', () => {
  const children = Array.from({ length: 3 }, () => ({ dataset: {}, offsetTop: 0, offsetHeight: 20 }));
  const body = { children, offsetTop: 0 };
  const preview = {
    querySelector(selector) { return selector === '.markdown-body' ? body : null; },
    querySelectorAll() { return children.filter(child => child.dataset.sourceLine); }
  };
  const virtual = { active: false, getMountedAnchors: () => [], getMetrics: () => [], getContentYForLine: () => 0, getLineForContentY: () => 1 };
  const mapper = createPreviewScrollMapper({ previewElement: preview, virtualApi: virtual });
  const anchors = mapper.annotateSourceLines('a\n\nb\n\nc', [], [
    { start: 0, end: 2, startLine: 1, endLine: 1 },
    { start: 3, end: 5, startLine: 3, endLine: 3 }
  ]);
  assert.equal(anchors.length, 2);
  assert.deepEqual(children[0].dataset, { sourceLine: '1', sourceEndLine: '1', sourceStartIndex: '0', sourceEndIndex: '2' });
  assert.deepEqual(children[1].dataset, { sourceLine: '3', sourceEndLine: '3', sourceStartIndex: '3', sourceEndIndex: '5' });
  assert.equal(children[2].dataset.sourceLine, undefined);
  mapper.destroy();
});

test('R9-12 PreviewScrollMapper token annotation is single-pass and refuses a token whose raw source cannot be located', () => {
  const children = Array.from({ length: 2 }, () => ({ dataset: {}, offsetTop: 0, offsetHeight: 20 }));
  const body = { children, offsetTop: 0 };
  const preview = { querySelector: () => body, querySelectorAll: () => [] };
  const virtual = { active: false, getMountedAnchors: () => [], getMetrics: () => [], getContentYForLine: () => 0, getLineForContentY: () => 1 };
  const mapper = createPreviewScrollMapper({ previewElement: preview, virtualApi: virtual });
  const anchors = mapper.annotateSourceLines('alpha\n\nbeta', [
    { type: 'paragraph', raw: 'alpha\n\n' },
    { type: 'paragraph', raw: 'missing' }
  ]);
  assert.equal(anchors.length, 1);
  assert.equal(children[0].dataset.sourceStartIndex, '0');
  assert.equal(children[1].dataset.sourceStartIndex, undefined);
  mapper.destroy();
});

test('R9-12 editor-to-preview uses frozen mapping across multiple source anchors and publishes multi-Range highlight', () => {
  const anchorA = makeAnchor(0, 7, 1);
  const anchorB = makeAnchor(7, 11, 3);
  const calls = [];
  const { controller, previewMapper, highlightCalls } = createController({
    selectionMapping: {
      createPreviewRangesForSourceSelection(anchor, source, absoluteStart) {
        calls.push({ anchor, source, absoluteStart });
        const range = { startContainer: { inside: true }, endContainer: { inside: true }, getClientRects: () => [{ top: absoluteStart, bottom: absoluteStart + 5, left: 0, right: 10, width: 10, height: 5 }] };
        return { ranges: [range], atomicElements: [], sourceCharacters: source.length, mappedCharacters: source.length, projectionCoverage: 1 };
      },
      mapPreviewDomPointToSource() { return null; }
    }
  });
  previewMapper.anchors = [anchorA, anchorB];
  const result = controller.syncEditorToPreview(false, 'test', { from: 1, to: 10, isCollapsed: false });
  assert.equal(result.status, 'exact');
  assert.equal(result.exactMapping, true);
  assert.equal(result.mappingMode, 'source-dom');
  assert.equal(calls.length, 2);
  assert.equal(highlightCalls[0].plan.ranges.length, 2);
  controller.destroy();
});

test('R9-12 editor-to-preview rejects incomplete frozen projection instead of text-search fallback', () => {
  const anchor = makeAnchor(0, 7, 1);
  const { controller, previewMapper, highlightCalls } = createController({
    selectionMapping: {
      createPreviewRangesForSourceSelection() { return { ranges: [], atomicElements: [], sourceCharacters: 5, mappedCharacters: 2, projectionCoverage: 0.4 }; },
      mapPreviewDomPointToSource() { return null; }
    }
  });
  previewMapper.anchors = [anchor];
  const result = controller.syncEditorToPreview(false, 'test', { from: 0, to: 5, isCollapsed: false });
  assert.equal(result.status, 'mapping-failed');
  assert.equal(highlightCalls.length, 0);
  controller.destroy();
});

test('R9-12 preview-to-editor maps both DOM boundaries only through frozen mapping and applies the exact source range', () => {
  const anchor = makeAnchor(0, 7, 1);
  const startNode = { inside: true, nodeType: 3, parentElement: { closest: () => anchor } };
  const endNode = { inside: true, nodeType: 3, parentElement: { closest: () => anchor } };
  let call = 0;
  const { controller, editorApi } = createController({
    selectionMapping: {
      createPreviewRangesForSourceSelection() { return { ranges: [], atomicElements: [], sourceCharacters: 0, mappedCharacters: 0, projectionCoverage: 1 }; },
      mapPreviewDomPointToSource(_anchor, _source, _start, _node, _offset, affinity) {
        call += 1;
        return { position: affinity === 'start' ? 1 : 5, projectionCoverage: 1 };
      }
    }
  });
  const range = {
    startContainer: startNode,
    endContainer: endNode,
    startOffset: 0,
    endOffset: 2,
    getClientRects: () => [{ top: 20, bottom: 40, left: 0, right: 20, width: 20, height: 20 }]
  };
  const result = controller.syncPreviewToEditor('selectionchange', { text: 'lpha', range, anchorOffset: 0, focusOffset: 2 });
  assert.equal(call, 2);
  assert.equal(result.status, 'mapped');
  assert.equal(result.exactMapping, true);
  assert.deepEqual(editorApi.selection, { start: 1, end: 5 });
  controller.destroy();
});

test('R9-12 preview-to-editor refuses low-coverage mapping without normalized/raw/nearby text-search recovery', () => {
  const anchor = makeAnchor(0, 7, 1);
  const node = { inside: true, nodeType: 3, parentElement: { closest: () => anchor } };
  const { controller, editorApi } = createController({
    selectionMapping: {
      createPreviewRangesForSourceSelection() { return { ranges: [], atomicElements: [], sourceCharacters: 0, mappedCharacters: 0, projectionCoverage: 1 }; },
      mapPreviewDomPointToSource(_anchor, _source, _start, _node, _offset, affinity) {
        return { position: affinity === 'start' ? 1 : 5, projectionCoverage: 0.5 };
      }
    }
  });
  const result = controller.syncPreviewToEditor('selectionchange', {
    text: 'alpha',
    range: { startContainer: node, endContainer: node, startOffset: 0, endOffset: 5, getClientRects: () => [] }
  });
  assert.equal(result.status, 'mapping-failed');
  assert.deepEqual(editorApi.selection, { start: 0, end: 0 });
  controller.destroy();
});

test('R9-12 SelectionSyncController destroy is terminal and cancels owned scheduling without destroying injected specialist owners', () => {
  let retryCancels = 0;
  let guardResets = 0;
  const { controller } = createController({
    feedbackGuard: { ...createGuard(), reset() { guardResets += 1; } },
    retryScheduler: { cancel() { retryCancels += 1; }, schedule() { return false; } }
  });
  controller.start();
  controller.scheduleEditor(false, 'test');
  controller.destroy();
  controller.destroy();
  assert.equal(controller.getState().destroyed, true);
  assert.ok(retryCancels >= 2);
  assert.ok(guardResets >= 1);
  assert.throws(() => controller.start(), /destroyed/);
});
