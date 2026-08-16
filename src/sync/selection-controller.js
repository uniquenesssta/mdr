const DEFAULT_MAX_RETRIES = 3;

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
