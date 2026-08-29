import { createSelectionSyncController } from '../../src/features/sync/index.js';

export function createFrames() {
  let nextId = 1;
  const callbacks = new Map();
  const active = new Set();
  return {
    request(callback) { const id = nextId++; callbacks.set(id, callback); active.add(id); return id; },
    cancel(id) { active.delete(id); },
    activeIds() { return [...active]; },
    activeCount() { return active.size; },
    flush(id = this.activeIds()[0]) {
      if (!id || !active.has(id)) return;
      active.delete(id);
      callbacks.get(id)?.();
    },
    flushAll(limit = 20) { while (active.size && limit-- > 0) this.flush(); },
    force(id) { callbacks.get(id)?.(); }
  };
}

export class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.clientHeight = 200;
    this.scrollTop = 0;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, event = {}) { for (const listener of [...(this.listeners.get(type) || [])]) listener(event); }
  getBoundingClientRect() { return { top: 0, bottom: 200, left: 0, right: 300 }; }
  contains(node) { return Boolean(node?.inside); }
}

export function createPreviewReader(snapshot = null) {
  let subscriber = null;
  return {
    read: () => snapshot,
    subscribe(callback) { subscriber = callback; return () => { if (subscriber === callback) subscriber = null; }; },
    start() {},
    stop() {},
    emit(event) { subscriber?.(event); }
  };
}

export function createGuardStub() {
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

export function createFinalSelectionController({
  frames = createFrames(),
  editor = new FakeTarget(),
  preview = new FakeTarget(),
  documentRef = new FakeTarget(),
  editorSelection = { from: 2, to: 6, isCollapsed: false },
  editorSelectionReader = null,
  previewSelectionReader = createPreviewReader(),
  feedbackGuard = createGuardStub(),
  highlightSession = { canPresent() { return false; }, show() { return false; }, restore() { return false; }, clear() {} },
  retryScheduler = { schedule() { return false; }, cancel() {} },
  selectionMapping = {
    createPreviewRangesForSourceSelection() { return { ranges: [], atomicElements: [], sourceCharacters: 0, mappedCharacters: 0, projectionCoverage: 1 }; },
    mapPreviewDomPointToSource() { return null; }
  },
  getPreviewVirtual = () => null,
  focusPreviewLine = () => false,
  documentVersion = 7,
  source = '0123456789\n',
  now = () => 100
} = {}) {
  const editorApi = {
    selection: { start: editorSelection.from, end: editorSelection.to },
    getSelection() { return this.selection; },
    setSelection(start, end) { this.selection = { start, end }; },
    focus() {}
  };
  const documentModel = {
    getTextLength: () => source.length,
    sliceText: (from, to) => source.slice(from, to),
    getDocumentVersion: () => documentVersion
  };
  const editorMapper = {
    getLineNumberAtPosition: () => 1,
    getContentYForPosition: () => 20,
    getContentYForLine: () => 20
  };
  const previewMapper = {
    getAnchors: () => [],
    getMetrics: () => [],
    getContentYForLine: () => 20,
    getLineForContentY: () => 1,
    invalidateStructure() {}
  };
  const scrollController = { scrollTo() { return true; } };
  const controller = createSelectionSyncController(editor, preview, {
    editorApi,
    documentModel,
    editorMapper,
    getPreviewMapper: () => previewMapper,
    getPreviewVirtual,
    focusPreviewLine,
    editorSelectionReader: editorSelectionReader || { read: () => editorSelection },
    previewSelectionReader,
    feedbackGuard,
    highlightSession,
    retryScheduler,
    selectionMapping,
    scrollController,
    documentRef,
    requestFrame: callback => frames.request(callback),
    cancelFrame: id => frames.cancel(id),
    now,
    isHybridLayout: () => false,
    updateActiveLine() {},
    record() {},
    diagnostic() {}
  });
  return { controller, frames, editor, preview, documentRef, editorApi, documentModel, editorMapper, previewMapper };
}
