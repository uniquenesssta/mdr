from __future__ import annotations

import json
from pathlib import Path

BASELINE = 'ff66d2eaa4cd030977cc3c4e57bc886e95d4110a'


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one replacement marker, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


def replace_all_existing(path: str, old: str, new: str) -> int:
    text = read(path)
    count = text.count(old)
    if count:
        write(path, text.replace(old, new))
    return count


feedback_guard = r'''/**
 * Responsibility: Authoritative R9-08 bidirectional selection feedback transaction state.
 * Imports: Injected timer capabilities only.
 * Exports: SelectionFeedbackGuard and factory.
 * State/side effects: Owns monotonic sequence, current source, preview revision and one cancellable release timer.
 * Lifecycle: Explicit reset/destroy; stale release callbacks cannot clear a newer transaction.
 */

const VALID_SOURCES = new Set(['editor', 'preview']);

function normalizeRevision(value, fallback = 0) {
  const revision = Number(value);
  return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : fallback;
}

function assertSource(source) {
  if (!VALID_SOURCES.has(source)) {
    throw new TypeError(`SelectionFeedbackGuard source must be editor or preview, received: ${String(source)}`);
  }
}

export class SelectionFeedbackGuard {
  constructor({
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timerId => clearTimeout(timerId)
  } = {}) {
    if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
      throw new TypeError('SelectionFeedbackGuard requires timer capabilities');
    }
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.sequence = 0;
    this.source = '';
    this.revision = 0;
    this.activeRevision = 0;
    this.releaseTimer = 0;
    this.destroyed = false;
  }

  begin(source, { revision = this.revision } = {}) {
    this.assertUsable();
    assertSource(source);
    this.cancelRelease();
    const requestedRevision = normalizeRevision(revision, this.revision);
    if (requestedRevision > this.revision) this.revision = requestedRevision;
    this.sequence += 1;
    this.source = source;
    this.activeRevision = this.revision;
    return Object.freeze({
      sequence: this.sequence,
      source: this.source,
      revision: this.activeRevision
    });
  }

  shouldIgnore(source, { revision = this.revision, allowSource = false } = {}) {
    if (this.destroyed) return true;
    assertSource(source);
    const incomingRevision = normalizeRevision(revision, this.revision);
    if (incomingRevision < this.revision) return true;
    if (incomingRevision > this.revision || !this.source) return false;
    if (this.activeRevision !== incomingRevision) return false;
    return allowSource ? this.source !== source : true;
  }

  advanceRevision() {
    this.assertUsable();
    this.revision += 1;
    if (this.source) this.activeRevision = this.revision;
    return this.revision;
  }

  release(token, delay = 0) {
    if (this.destroyed || !token || typeof token !== 'object') return false;
    if (token.sequence !== this.sequence || token.source !== this.source || !this.source) return false;
    this.cancelRelease();
    const sequence = token.sequence;
    const source = token.source;
    const clearCurrent = () => {
      this.releaseTimer = 0;
      if (this.destroyed) return;
      if (this.sequence !== sequence || this.source !== source) return;
      this.source = '';
      this.activeRevision = this.revision;
    };
    const settleDelay = Math.max(0, Number(delay) || 0);
    if (settleDelay > 0) {
      this.releaseTimer = this.setTimer(clearCurrent, settleDelay);
      return true;
    }
    clearCurrent();
    return true;
  }

  reset() {
    if (this.destroyed) return;
    this.cancelRelease();
    this.sequence += 1;
    this.source = '';
    this.activeRevision = this.revision;
  }

  getRevision() {
    return this.revision;
  }

  getState() {
    return Object.freeze({
      sequence: this.sequence,
      source: this.source,
      revision: this.revision,
      active: Boolean(this.source),
      destroyed: this.destroyed
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.reset();
    this.destroyed = true;
    this.setTimer = null;
    this.clearTimer = null;
  }

  cancelRelease() {
    if (!this.releaseTimer) return;
    this.clearTimer(this.releaseTimer);
    this.releaseTimer = 0;
  }

  assertUsable() {
    if (this.destroyed) throw new Error('SelectionFeedbackGuard is destroyed');
  }
}

export function createSelectionFeedbackGuard(options = {}) {
  return new SelectionFeedbackGuard(options);
}
'''
write('src/features/sync/selection/selection-feedback-guard.js', feedback_guard)

selection_controller = r'''const DEFAULT_MAX_RETRIES = 3;

function nextFrame(callback) {
  return requestAnimationFrame(() => callback());
}

const REQUIRED_FEEDBACK_METHODS = [
  'begin',
  'shouldIgnore',
  'advanceRevision',
  'release',
  'reset',
  'getRevision',
  'getState'
];

export class SelectionSyncController {
  constructor(editor, preview, { editorSelectionReader, previewSelectionReader, feedbackGuard } = {}) {
    if (!editorSelectionReader || typeof editorSelectionReader.read !== 'function') {
      throw new TypeError('SelectionSyncController requires EditorSelectionReader');
    }
    if (!previewSelectionReader
      || typeof previewSelectionReader.read !== 'function'
      || typeof previewSelectionReader.subscribe !== 'function'
      || typeof previewSelectionReader.start !== 'function'
      || typeof previewSelectionReader.stop !== 'function') {
      throw new TypeError('SelectionSyncController requires PreviewSelectionReader');
    }
    if (!feedbackGuard || REQUIRED_FEEDBACK_METHODS.some(method => typeof feedbackGuard[method] !== 'function')) {
      throw new TypeError('SelectionSyncController requires SelectionFeedbackGuard');
    }
    this.editor = editor;
    this.preview = preview;
    this.editorSelectionReader = editorSelectionReader;
    this.previewSelectionReader = previewSelectionReader;
    this.feedbackGuard = feedbackGuard;
    this.previewSelectionDisposer = null;
    this.callbacks = {};
    this.started = false;
    this.editorPointerActive = false;
    this.editorFrame = 0;
    this.previewFrame = 0;
    this.lastEditorKey = '';
    this.lastPreviewKey = '';
    this.editorAlignmentUntil = 0;
    this.stats = {
      editorRequests: 0,
      previewRequests: 0,
      previewRefreshes: 0,
      editorGeometryRefreshes: 0,
      pendingRetries: 0,
      mappingFailures: 0,
      ignoredFeedbackEvents: 0
    };

    this.onEditorSelect = () => this.scheduleEditor(false, 'editor-select');
    this.onEditorKeyUp = event => {
      const selection = this.editorSelectionReader.read();
      const hasSelection = Boolean(selection && !selection.isCollapsed);
      if (event.shiftKey || hasSelection) this.scheduleEditor(Boolean(event.shiftKey), 'editor-keyup');
    };
    this.onEditorPointerDown = () => {
      this.editorPointerActive = true;
    };
    this.onDocumentPointerUp = () => {
      if (this.editorPointerActive) {
        this.editorPointerActive = false;
        this.scheduleEditor(true, 'editor-pointerup', { force: true, frames: 1 });
      }
    };
    this.onStablePreviewSelection = ({ reason = 'preview-selection', force = false, snapshot = null } = {}) => {
      if (this.feedbackGuard.shouldIgnore('preview')) {
        this.stats.ignoredFeedbackEvents += 1;
        return;
      }
      this.stats.previewRequests += 1;
      this.runPreview(reason, Boolean(force), snapshot, true);
    };
    this.onPreviewKeyUp = () => this.schedulePreview('preview-keyup', { force: true, frames: 1 });
  }

  configure(callbacks = {}) {
    this.callbacks = { ...this.callbacks, ...callbacks };
    return this;
  }

  start() {
    if (this.started) return this;
    const disposePreviewSelection = this.previewSelectionReader.subscribe(this.onStablePreviewSelection);
    try {
      this.previewSelectionReader.start();
    } catch (error) {
      disposePreviewSelection();
      throw error;
    }
    this.previewSelectionDisposer = disposePreviewSelection;
    this.started = true;
    this.editor.addEventListener('select', this.onEditorSelect);
    this.editor.addEventListener('keyup', this.onEditorKeyUp);
    this.editor.addEventListener('pointerdown', this.onEditorPointerDown, true);
    this.preview.addEventListener('keyup', this.onPreviewKeyUp);
    document.addEventListener('pointerup', this.onDocumentPointerUp, true);
    document.addEventListener('pointercancel', this.onDocumentPointerUp, true);
    return this;
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    cancelAnimationFrame(this.editorFrame);
    cancelAnimationFrame(this.previewFrame);
    this.feedbackGuard.reset();
    this.editor.removeEventListener('select', this.onEditorSelect);
    this.editor.removeEventListener('keyup', this.onEditorKeyUp);
    this.editor.removeEventListener('pointerdown', this.onEditorPointerDown, true);
    this.preview.removeEventListener('keyup', this.onPreviewKeyUp);
    document.removeEventListener('pointerup', this.onDocumentPointerUp, true);
    document.removeEventListener('pointercancel', this.onDocumentPointerUp, true);
    this.previewSelectionReader.stop();
    this.previewSelectionDisposer?.();
    this.previewSelectionDisposer = null;
  }

  makeEditorKey(selection = this.editorSelectionReader.read()) {
    const from = Number(selection?.from) || 0;
    const to = Math.max(from, Number(selection?.to) || 0);
    const documentVersion = window.markdownEditorDocumentModel?.getState?.().version || 0;
    return `${documentVersion}:${from}:${to}:${this.feedbackGuard.getRevision()}`;
  }

  scheduleEditor(shouldScroll = false, reason = 'editor-selection', options = {}) {
    if (this.feedbackGuard.shouldIgnore('editor', { allowSource: true })) {
      this.stats.ignoredFeedbackEvents += 1;
      return;
    }
    this.stats.editorRequests += 1;
    if (shouldScroll && options.extendAlignment !== false) this.editorAlignmentUntil = performance.now() + 1400;
    const force = Boolean(options.force);
    const frames = Math.max(1, Number(options.frames) || 1);
    cancelAnimationFrame(this.editorFrame);
    let remaining = frames;
    const run = () => {
      if (--remaining > 0) {
        this.editorFrame = nextFrame(run);
        return;
      }
      this.editorFrame = 0;
      this.runEditor(shouldScroll, reason, force, 0);
    };
    this.editorFrame = nextFrame(run);
  }

  runEditor(shouldScroll, reason, force, attempt) {
    if (this.feedbackGuard.shouldIgnore('editor', { allowSource: true })) return;
    const selection = this.editorSelectionReader.read();
    const key = this.makeEditorKey(selection);
    if (!force && key === this.lastEditorKey) return;
    const feedbackToken = this.feedbackGuard.begin('editor');
    let result = null;
    try {
      result = this.callbacks.syncEditorToPreview?.({ shouldScroll, reason, attempt, selection }) || { status: 'unconfigured' };
      this.lastEditorKey = key;
    } finally {
      this.feedbackGuard.release(feedbackToken, 32);
    }
    this.recordResult('editor-to-preview', reason, result);
    if (result?.status === 'pending' && attempt < (result.maxRetries ?? DEFAULT_MAX_RETRIES)) {
      this.stats.pendingRetries += 1;
      this.editorFrame = nextFrame(() => {
        this.editorFrame = 0;
        this.runEditor(shouldScroll, `${reason}-retry`, true, attempt + 1);
      });
    }
  }

  schedulePreview(reason = 'preview-selection', options = {}) {
    if (this.feedbackGuard.shouldIgnore('preview', { allowSource: true })) {
      this.stats.ignoredFeedbackEvents += 1;
      return;
    }
    this.stats.previewRequests += 1;
    const force = Boolean(options.force);
    const frames = Math.max(1, Number(options.frames) || 1);
    cancelAnimationFrame(this.previewFrame);
    let remaining = frames;
    const run = () => {
      if (--remaining > 0) {
        this.previewFrame = nextFrame(run);
        return;
      }
      this.previewFrame = 0;
      this.runPreview(reason, force);
    };
    this.previewFrame = nextFrame(run);
  }

  runPreview(reason, force, snapshot = null, snapshotProvided = false) {
    if (this.feedbackGuard.shouldIgnore('preview', { allowSource: true })) return;
    const selection = snapshotProvided ? snapshot : this.previewSelectionReader.read();
    if (!selection) return;
    const key = `${selection.text || ''}:${selection.anchorOffset || 0}:${selection.focusOffset || 0}`;
    if (!force && key === this.lastPreviewKey) return;
    const feedbackToken = this.feedbackGuard.begin('preview');
    let result = null;
    try {
      result = this.callbacks.syncPreviewToEditor?.({ reason, selection }) || { status: 'unconfigured' };
      if (result?.status === 'mapped') this.lastPreviewKey = key;
    } finally {
      this.feedbackGuard.release(feedbackToken, 96);
    }
    if (result?.status === 'mapping-failed') this.stats.mappingFailures += 1;
    this.recordResult('preview-to-editor', reason, result);
  }

  notifyPreviewMounted(reason = 'preview-mounted') {
    this.feedbackGuard.advanceRevision();
    if (this.feedbackGuard.shouldIgnore('preview', { allowSource: true })) return;
    const editorSelection = this.editorSelectionReader.read();
    if (!editorSelection || editorSelection.isCollapsed) return;
    this.stats.previewRefreshes += 1;
    const shouldRealign = performance.now() < this.editorAlignmentUntil;
    this.scheduleEditor(shouldRealign, reason, { force: true, frames: 1, extendAlignment: false });
  }

  notifyPreviewReplaced(reason = 'preview-replaced') {
    this.notifyPreviewMounted(reason);
  }

  notifyEditorGeometry(reason = 'editor-geometry') {
    if (this.feedbackGuard.shouldIgnore('editor')) return;
    this.stats.editorGeometryRefreshes += 1;
    const previewSelection = this.previewSelectionReader.read();
    if (previewSelection) {
      this.schedulePreview(reason, { force: true, frames: 2 });
      return;
    }
    const editorSelection = this.editorSelectionReader.read();
    if (editorSelection && !editorSelection.isCollapsed) {
      this.scheduleEditor(true, reason, { force: true, frames: 2, extendAlignment: false });
    }
  }

  clear() {
    this.lastEditorKey = '';
    this.lastPreviewKey = '';
    this.callbacks.clearPreview?.();
  }

  recordResult(direction, reason, result = {}) {
    const status = result?.status || 'unknown';
    if (status === 'hybrid' || status === 'cleared' || status === 'locked') return;
    const details = {
      direction,
      reason,
      result: status,
      selectionLength: Number(result?.selectionLength) || 0,
      matchedAnchors: Number(result?.matchedAnchors) || 0,
      virtualized: Boolean(this.callbacks.isPreviewVirtualized?.()),
      previewRevision: this.feedbackGuard.getRevision(),
      sourceViewportRatio: Number.isFinite(result?.sourceViewportRatio)
        ? Number(result.sourceViewportRatio.toFixed(3))
        : null,
      targetViewportRatio: Number.isFinite(result?.targetViewportRatio)
        ? Number(result.targetViewportRatio.toFixed(3))
        : null,
      mappingMode: result?.mappingMode || null,
      mappingCoverage: Number.isFinite(result?.mappingCoverage)
        ? Number(result.mappingCoverage.toFixed(3))
        : null,
      mappedCharacters: Number(result?.mappedCharacters) || 0,
      exactMapping: Boolean(result?.exactMapping),
      sourceStart: Number.isFinite(result?.sourceStart) ? result.sourceStart : null,
      sourceEnd: Number.isFinite(result?.sourceEnd) ? result.sourceEnd : null
    };
    const noteworthy = status === 'mapping-failed'
      || status === 'pending'
      || status === 'unconfigured'
      || status === 'blocks-clipped';
    if (noteworthy) {
      window.markdownEditorPerf?.diagnostic?.('selection.sync-anomaly', {
        category: 'sync.selection',
        status: 'warning',
        dedupeKey: `selection:${direction}:${status}`,
        minIntervalMs: 4000,
        details
      });
      return;
    }
    window.markdownEditorPerf?.record('selection.sync-result', {
      category: 'sync.selection',
      status: 'ok',
      aggregate: true,
      details
    });
  }

  getState() {
    const feedback = this.feedbackGuard.getState();
    return {
      started: this.started,
      applyingSide: feedback.source,
      previewRevision: feedback.revision,
      ...this.stats
    };
  }
}

export function createSelectionSyncController(editor, preview, options = {}) {
  return new SelectionSyncController(editor, preview, options);
}
'''
write('src/sync/selection-controller.js', selection_controller)

replace_once(
    'src/features/sync/index.js',
    ' * Responsibility: Public Stage 9 synchronization contract. R9-04 EditorScrollMapper, R9-05 PreviewScrollMapper and R9-06 ScrollGeometrySession remain frozen while R9-07 adds EditorSelectionReader and PreviewSelectionReader; later selection policy remains unmigrated.\n * Imports: Public synchronization modules only.\n * Exports: Scroll controller, source ownership, editor/preview mappers, geometry session and R9-07 selection reader classes/factories.\n',
    ' * Responsibility: Public Stage 9 synchronization contract. R9-04 through R9-07 remain frozen while R9-08 adds the canonical SelectionFeedbackGuard; later selection policy remains unmigrated.\n * Imports: Public synchronization modules only.\n * Exports: Scroll owners/mappers/geometry, Selection Readers and the R9-08 Feedback Guard classes/factories.\n'
)
replace_once(
    'src/features/sync/index.js',
    "export {\n  PreviewSelectionReader,\n  createPreviewSelectionReader\n} from './selection/preview-selection-reader.js';\n",
    "export {\n  PreviewSelectionReader,\n  createPreviewSelectionReader\n} from './selection/preview-selection-reader.js';\nexport {\n  SelectionFeedbackGuard,\n  createSelectionFeedbackGuard\n} from './selection/selection-feedback-guard.js';\n"
)

replace_once(
    'src/main.js',
    "import { createEditorSelectionReader, createPreviewSelectionReader } from './features/sync/index.js';",
    "import { createEditorSelectionReader, createPreviewSelectionReader, createSelectionFeedbackGuard } from './features/sync/index.js';"
)
replace_once(
    'src/main.js',
    "  const previewSelectionReader = createPreviewSelectionReader({\n    previewElement: previewHost,\n    documentRef: previewSelectionDocument,\n    getSelection: () => previewSelectionView?.getSelection?.() || null,\n    requestFrame: callback => window.requestAnimationFrame(callback),\n    cancelFrame: frameId => window.cancelAnimationFrame(frameId)\n  });\n  if (compatibilityPlatformHost) {\n    compatibilityPlatformHost.markdownEditorEditorSelectionReader = editorSelectionReader;\n    compatibilityPlatformHost.markdownEditorPreviewSelectionReader = previewSelectionReader;\n  }\n  const selectionController = createSelectionSyncController(editorHost, previewHost, {\n    editorSelectionReader,\n    previewSelectionReader\n  });",
    "  const previewSelectionReader = createPreviewSelectionReader({\n    previewElement: previewHost,\n    documentRef: previewSelectionDocument,\n    getSelection: () => previewSelectionView?.getSelection?.() || null,\n    requestFrame: callback => window.requestAnimationFrame(callback),\n    cancelFrame: frameId => window.cancelAnimationFrame(frameId)\n  });\n  const selectionFeedbackGuard = createSelectionFeedbackGuard({\n    setTimer: (callback, delay) => window.setTimeout(callback, delay),\n    clearTimer: timerId => window.clearTimeout(timerId)\n  });\n  if (compatibilityPlatformHost) {\n    compatibilityPlatformHost.markdownEditorEditorSelectionReader = editorSelectionReader;\n    compatibilityPlatformHost.markdownEditorPreviewSelectionReader = previewSelectionReader;\n    compatibilityPlatformHost.markdownEditorSelectionFeedbackGuard = selectionFeedbackGuard;\n  }\n  const selectionController = createSelectionSyncController(editorHost, previewHost, {\n    editorSelectionReader,\n    previewSelectionReader,\n    feedbackGuard: selectionFeedbackGuard\n  });"
)
replace_once(
    'src/main.js',
    "    if (compatibilityPlatformHost?.markdownEditorPreviewSelectionReader === previewSelectionReader) {\n      delete compatibilityPlatformHost.markdownEditorPreviewSelectionReader;\n    }\n    previewSelectionReader.destroy();\n    editorSelectionReader.destroy();",
    "    if (compatibilityPlatformHost?.markdownEditorPreviewSelectionReader === previewSelectionReader) {\n      delete compatibilityPlatformHost.markdownEditorPreviewSelectionReader;\n    }\n    if (compatibilityPlatformHost?.markdownEditorSelectionFeedbackGuard === selectionFeedbackGuard) {\n      delete compatibilityPlatformHost.markdownEditorSelectionFeedbackGuard;\n    }\n    selectionFeedbackGuard.destroy();\n    previewSelectionReader.destroy();\n    editorSelectionReader.destroy();"
)

replace_once('public/app/core.js', '    let selectionSyncLock = false;\n', '')
replace_once(
    'public/app/scroll-sync.js',
    "    const previewSelectionReader = scrollSyncCompatibilityHost?.markdownEditorPreviewSelectionReader;\n",
    "    const previewSelectionReader = scrollSyncCompatibilityHost?.markdownEditorPreviewSelectionReader;\n    const selectionFeedbackGuard = scrollSyncCompatibilityHost?.markdownEditorSelectionFeedbackGuard;\n"
)
replace_once(
    'public/app/scroll-sync.js',
    "    if (!previewSelectionReader) throw new Error('Preview Selection Reader compatibility capability is unavailable.');\n",
    "    if (!previewSelectionReader) throw new Error('Preview Selection Reader compatibility capability is unavailable.');\n    if (!selectionFeedbackGuard) throw new Error('Selection Feedback Guard compatibility capability is unavailable.');\n"
)
replace_once(
    'public/app/scroll-sync.js',
    "      if (selectionSyncLock) return { status: 'locked', selectionLength: 0, matchedAnchors: 0 };",
    "      if (selectionFeedbackGuard.shouldIgnore('editor', { allowSource: true })) {\n        return { status: 'locked', selectionLength: 0, matchedAnchors: 0 };\n      }"
)
replace_once(
    'public/app/scroll-sync.js',
    "    function syncPreviewSelectionToEditor(reason = 'preview-selection', selectionSnapshot = null) {\n      const context = getPreviewSelectionContext(selectionSnapshot || previewSelectionReader.read());",
    "    function syncPreviewSelectionToEditor(reason = 'preview-selection', selectionSnapshot = null) {\n      if (selectionFeedbackGuard.shouldIgnore('preview', { allowSource: true })) {\n        return { status: 'locked', selectionLength: 0, matchedAnchors: 0 };\n      }\n      const context = getPreviewSelectionContext(selectionSnapshot || previewSelectionReader.read());"
)
replace_once('public/app/scroll-sync.js', '      selectionSyncLock = true;\n', '')
replace_once('public/app/scroll-sync.js', '      setTimeout(() => { selectionSyncLock = false; }, 96);\n', '')

behavior_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionFeedbackGuard } from '../src/features/sync/index.js';
import { createSelectionSyncController } from '../src/sync/selection-controller.js';

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

function createFrames() {
  let nextId = 1;
  const callbacks = new Map();
  const active = new Set();
  return {
    request(callback) { const id = nextId++; callbacks.set(id, callback); active.add(id); return id; },
    cancel(id) { active.delete(id); },
    activeCount() { return active.size; },
    flushAll(limit = 20) {
      while (active.size && limit-- > 0) {
        const [id] = active;
        active.delete(id);
        callbacks.get(id)?.();
      }
    }
  };
}

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, event = {}) { for (const listener of [...(this.listeners.get(type) || [])]) listener(event); }
}

function createPreviewReader(snapshot) {
  let subscriber = null;
  return {
    read: () => snapshot,
    subscribe(callback) { subscriber = callback; return () => { if (subscriber === callback) subscriber = null; }; },
    start() {},
    stop() {},
    emit(event) { subscriber?.(event); }
  };
}

function installControllerGlobals(frames, documentRef) {
  const previous = new Map();
  const values = {
    requestAnimationFrame: callback => frames.request(callback),
    cancelAnimationFrame: frameId => frames.cancel(frameId),
    document: documentRef,
    performance: { now: () => 100 },
    window: {
      markdownEditorDocumentModel: { getState: () => ({ version: 7 }) },
      markdownEditorPerf: { record() {}, diagnostic() {} }
    }
  };
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(globalThis, key) ? globalThis[key] : undefined);
    globalThis[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
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

test('R9-08 SelectionSyncController uses the shared Guard to reject editor feedback during preview-to-editor settlement', () => {
  const timers = createTimers();
  const frames = createFrames();
  const editor = new FakeTarget();
  const preview = new FakeTarget();
  const documentRef = new FakeTarget();
  const restore = installControllerGlobals(frames, documentRef);
  const guard = createSelectionFeedbackGuard({ setTimer: callback => timers.set(callback), clearTimer: id => timers.clear(id) });
  const editorReader = { read: () => ({ from: 2, to: 6, isCollapsed: false }) };
  const previewSnapshot = Object.freeze({ text: 'abcd', anchorOffset: 0, focusOffset: 4 });
  const previewReader = createPreviewReader(previewSnapshot);
  const controller = createSelectionSyncController(editor, preview, {
    editorSelectionReader: editorReader,
    previewSelectionReader: previewReader,
    feedbackGuard: guard
  }).configure({ syncPreviewToEditor: () => ({ status: 'mapped', selectionLength: 4 }) });
  try {
    controller.start();
    controller.runPreview('test-preview', true, previewSnapshot, true);
    assert.equal(guard.getState().source, 'preview');
    editor.emit('select');
    assert.equal(frames.activeCount(), 0);
    assert.equal(controller.getState().ignoredFeedbackEvents, 1);
    timers.flushAll();
    editor.emit('select');
    assert.equal(frames.activeCount(), 1);
  } finally {
    controller.stop();
    guard.destroy();
    restore();
  }
});

test('R9-08 SelectionSyncController exposes compatibility applyingSide/previewRevision from Guard state instead of owning duplicates', () => {
  const guard = createSelectionFeedbackGuard();
  const editor = new FakeTarget();
  const preview = new FakeTarget();
  const editorReader = { read: () => ({ from: 1, to: 2, isCollapsed: false }) };
  const previewReader = createPreviewReader(null);
  const controller = createSelectionSyncController(editor, preview, {
    editorSelectionReader: editorReader,
    previewSelectionReader: previewReader,
    feedbackGuard: guard
  });
  const token = guard.begin('editor');
  controller.notifyPreviewMounted();
  assert.equal(controller.getState().applyingSide, 'editor');
  assert.equal(controller.getState().previewRevision, 1);
  guard.release(token, 0);
  assert.equal(controller.getState().applyingSide, '');
  guard.destroy();
});
'''
write('tests/stage-09-selection-feedback-guard.test.mjs', behavior_test)

architecture_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');
const LATER_SELECTION_FILES = [
  'src/features/sync/selection/selection-sync-controller.js',
  'src/features/sync/selection/selection-highlight-session.js',
  'src/features/sync/selection/selection-retry-scheduler.js'
];

test('R9-08 creates the canonical SelectionFeedbackGuard and exports it only through the Sync public entry', async () => {
  const index = await read('src/features/sync/index.js');
  const guard = await read('src/features/sync/selection/selection-feedback-guard.js');
  assert.match(index, /R9-08/);
  assert.match(guard, /export class SelectionFeedbackGuard/);
  assert.match(guard, /export function createSelectionFeedbackGuard/);
  assert.match(index, /\.\/selection\/selection-feedback-guard\.js/);
});

test('R9-08 Feedback Guard owns sequence source revision and release lifecycle without DOM mapping highlight retry or scroll policy', async () => {
  const source = await read('src/features/sync/selection/selection-feedback-guard.js');
  assert.match(source, /this\.sequence/);
  assert.match(source, /this\.source/);
  assert.match(source, /this\.revision/);
  assert.match(source, /token\.sequence !== this\.sequence/);
  assert.match(source, /incomingRevision < this\.revision/);
  assert.doesNotMatch(source, /document\.|window\.|globalThis\.|addEventListener|removeEventListener|selectionMapping|CSS\.highlights|Range\(|scrollTo|scheduleTarget/);
  assert.doesNotMatch(source, /selectionSyncLock|applyingSide|feedbackLocked|isFeedbackLocked/);
});

test('R9-08 legacy SelectionSyncController consumes the Guard and no longer owns applying-side release or preview revision duplicates', async () => {
  const controller = await read('src/sync/selection-controller.js');
  assert.match(controller, /feedbackGuard\.begin\('editor'\)/);
  assert.match(controller, /feedbackGuard\.begin\('preview'\)/);
  assert.match(controller, /feedbackGuard\.shouldIgnore/);
  assert.match(controller, /feedbackGuard\.advanceRevision\(\)/);
  assert.match(controller, /feedbackGuard\.release/);
  assert.match(controller, /feedbackGuard\.reset\(\)/);
  assert.doesNotMatch(controller, /this\.applyingSide\s*=|this\.releaseTimer\s*=|this\.previewRevision\s*=/);
});

test('R9-08 classic selection compatibility consumes the scoped Guard and deletes the cross-file selectionSyncLock authority', async () => {
  const core = await read('public/app/core.js');
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(legacy, /markdownEditorSelectionFeedbackGuard/);
  assert.match(legacy, /selectionFeedbackGuard\.shouldIgnore\('editor'/);
  assert.match(legacy, /selectionFeedbackGuard\.shouldIgnore\('preview'/);
  assert.doesNotMatch(core, /selectionSyncLock/);
  assert.doesNotMatch(legacy, /selectionSyncLock/);
});

test('R9-08 composition creates exactly one Guard injects it into Controller and scoped compatibility then destroys it', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createSelectionFeedbackGuard/);
  assert.match(main, /const selectionFeedbackGuard = createSelectionFeedbackGuard\(\{/);
  assert.match(main, /markdownEditorSelectionFeedbackGuard = selectionFeedbackGuard/);
  assert.match(main, /feedbackGuard: selectionFeedbackGuard/);
  assert.match(main, /selectionFeedbackGuard\.destroy\(\)/);
  assert.doesNotMatch(main, /window\.markdownEditorSelectionFeedbackGuard/);
  assert.doesNotMatch(main, /\.\/features\/sync\/selection\/selection-feedback-guard\.js/);
});

test('R9-08 keeps frozen mapping and prior Stage 9 scroll/read owners untouched and does not advance R9-09+', async () => {
  await access(file('src/features/sync/scroll/scroll-source-ownership.js'));
  await access(file('src/features/sync/scroll/scroll-sync-controller.js'));
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/preview-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));
  await access(file('src/features/sync/selection/editor-selection-reader.js'));
  await access(file('src/features/sync/selection/preview-selection-reader.js'));
  await access(file('src/sync/selection-mapping.js'));
  for (const path of LATER_SELECTION_FILES) await assert.rejects(access(file(path)), path);
  const mapping = await read('src/sync/selection-mapping.js');
  assert.doesNotMatch(mapping, /R9-08/);
});

test('R9-08 production inventory records one Feedback Guard responsibility and cardinality 379', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 379);
  assert.equal(records.get('src/features/sync/selection/selection-feedback-guard.js')?.[4], 'selection-feedback-guard-lifecycle');
});

test('R9-08 keeps Reader ownership separate from feedback policy and leaves later Selection modules absent', async () => {
  const editorReader = await read('src/features/sync/selection/editor-selection-reader.js');
  const previewReader = await read('src/features/sync/selection/preview-selection-reader.js');
  assert.doesNotMatch(editorReader, /SelectionFeedbackGuard|feedbackGuard/);
  assert.doesNotMatch(previewReader, /SelectionFeedbackGuard|feedbackGuard/);
  for (const path of LATER_SELECTION_FILES) await assert.rejects(access(file(path)), path);
});
'''
write('tests/architecture/stage-09-selection-feedback-guard.test.mjs', architecture_test)

# Historical Stage 9 architecture gates must stop treating the now-current R9-08 module as a future file.
for path in Path('tests/architecture').glob('stage-09-*.test.mjs'):
    if path.name == 'stage-09-selection-feedback-guard.test.mjs':
        continue
    replace_all_existing(str(path), "  'src/features/sync/selection/selection-feedback-guard.js',\n", '')

# Production module cardinality increases by exactly one. Keep old architecture gates precise.
for root in (Path('tests'),):
    for path in root.rglob('*.test.mjs'):
        text = path.read_text(encoding='utf-8')
        updated = text.replace('inventory.modules.length, 378', 'inventory.modules.length, 379')
        updated = updated.replace('modules.length, 378', 'modules.length, 379')
        if updated != text:
            path.write_text(updated, encoding='utf-8')

inventory_path = Path('tests/architecture/fixtures/production-modules.json')
inventory = json.loads(inventory_path.read_text(encoding='utf-8'))
if len(inventory['modules']) != 378:
    raise RuntimeError(f"expected R9-07 production inventory cardinality 378, got {len(inventory['modules'])}")
records = {record[0]: record for record in inventory['modules']}
if 'src/features/sync/selection/selection-feedback-guard.js' in records:
    raise RuntimeError('feedback guard already exists in R9-07 inventory')
records['src/features/sync/index.js'][3] = 'Public Stage 9 Sync contract exposing scroll owners/mappers/geometry, R9-07 Selection Readers and the R9-08 Feedback Guard while later Selection orchestration remains unmigrated.'
records['public/app/scroll-sync.js'][3] = 'Legacy bidirectional selection mapping/highlight compatibility and geometry-change producers; R9-08 feedback state is delegated to the canonical SelectionFeedbackGuard.'
records['src/sync/selection-controller.js'][3] = 'Legacy selection synchronization orchestration consuming canonical Selection Readers and R9-08 Feedback Guard while later highlight/retry/mapping migration remains pending.'
inventory['modules'].append([
    'src/features/sync/selection/selection-feedback-guard.js',
    'esm-module',
    'sync-selection',
    'R9-08 sequence/source/revision feedback guard suppressing stale and opposite-side selection propagation without DOM, mapping, highlight, retry or scroll ownership.',
    'selection-feedback-guard-lifecycle',
    'explicit-instance',
    'retain',
    False
])
inventory_path.write_text(json.dumps(inventory, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
