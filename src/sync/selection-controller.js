const DEFAULT_MAX_RETRIES = 3;

function nextFrame(callback) {
  return requestAnimationFrame(() => callback());
}

function selectionInside(preview) {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return false;
  return Boolean(preview.contains(selection.anchorNode) && preview.contains(selection.focusNode));
}

export class SelectionSyncController {
  constructor(editor, preview) {
    this.editor = editor;
    this.preview = preview;
    this.callbacks = {};
    this.started = false;
    this.applyingSide = '';
    this.editorPointerActive = false;
    this.previewPointerActive = false;
    this.previewSelectionDirty = false;
    this.editorFrame = 0;
    this.previewFrame = 0;
    this.releaseTimer = 0;
    this.previewRevision = 0;
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
      const hasSelection = (this.editor.selectionStart || 0) !== (this.editor.selectionEnd || 0);
      if (event.shiftKey || hasSelection) this.scheduleEditor(Boolean(event.shiftKey), 'editor-keyup');
    };
    this.onEditorPointerDown = () => {
      this.editorPointerActive = true;
    };
    this.onPreviewPointerDown = () => {
      this.previewPointerActive = true;
      this.previewSelectionDirty = false;
    };
    this.onDocumentPointerUp = () => {
      if (this.editorPointerActive) {
        this.editorPointerActive = false;
        this.scheduleEditor(true, 'editor-pointerup', { force: true, frames: 1 });
      }
      if (this.previewPointerActive) {
        this.previewPointerActive = false;
        this.schedulePreview('preview-pointerup', { force: true, frames: 2 });
      }
    };
    this.onDocumentSelectionChange = () => {
      if (this.applyingSide) {
        this.stats.ignoredFeedbackEvents += 1;
        return;
      }
      if (!selectionInside(this.preview)) return;
      if (this.previewPointerActive) {
        this.previewSelectionDirty = true;
        return;
      }
      this.schedulePreview('document-selectionchange', { frames: 1 });
    };
    this.onPreviewKeyUp = () => this.schedulePreview('preview-keyup', { force: true, frames: 1 });
  }

  configure(callbacks = {}) {
    this.callbacks = { ...this.callbacks, ...callbacks };
    return this;
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.editor.addEventListener('select', this.onEditorSelect);
    this.editor.addEventListener('keyup', this.onEditorKeyUp);
    this.editor.addEventListener('pointerdown', this.onEditorPointerDown, true);
    this.preview.addEventListener('pointerdown', this.onPreviewPointerDown, true);
    this.preview.addEventListener('keyup', this.onPreviewKeyUp);
    document.addEventListener('pointerup', this.onDocumentPointerUp, true);
    document.addEventListener('pointercancel', this.onDocumentPointerUp, true);
    document.addEventListener('selectionchange', this.onDocumentSelectionChange);
    return this;
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    cancelAnimationFrame(this.editorFrame);
    cancelAnimationFrame(this.previewFrame);
    clearTimeout(this.releaseTimer);
    this.applyingSide = '';
    this.editor.removeEventListener('select', this.onEditorSelect);
    this.editor.removeEventListener('keyup', this.onEditorKeyUp);
    this.editor.removeEventListener('pointerdown', this.onEditorPointerDown, true);
    this.preview.removeEventListener('pointerdown', this.onPreviewPointerDown, true);
    this.preview.removeEventListener('keyup', this.onPreviewKeyUp);
    document.removeEventListener('pointerup', this.onDocumentPointerUp, true);
    document.removeEventListener('pointercancel', this.onDocumentPointerUp, true);
    document.removeEventListener('selectionchange', this.onDocumentSelectionChange);
  }

  makeEditorKey() {
    const from = Math.min(this.editor.selectionStart || 0, this.editor.selectionEnd || 0);
    const to = Math.max(this.editor.selectionStart || 0, this.editor.selectionEnd || 0);
    const documentVersion = window.markdownEditorDocumentModel?.getState?.().version || 0;
    return `${documentVersion}:${from}:${to}:${this.previewRevision}`;
  }

  scheduleEditor(shouldScroll = false, reason = 'editor-selection', options = {}) {
    if (this.applyingSide === 'preview') {
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
    if (this.applyingSide === 'preview') return;
    const key = this.makeEditorKey();
    if (!force && key === this.lastEditorKey) return;
    this.applyingSide = 'editor';
    let result = null;
    try {
      result = this.callbacks.syncEditorToPreview?.({ shouldScroll, reason, attempt }) || { status: 'unconfigured' };
      this.lastEditorKey = key;
    } finally {
      this.releaseApplyingSide();
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
    if (this.applyingSide === 'editor') {
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

  runPreview(reason, force) {
    if (this.applyingSide === 'editor' || !selectionInside(this.preview)) return;
    const selection = window.getSelection();
    const key = `${selection?.toString() || ''}:${selection?.anchorOffset || 0}:${selection?.focusOffset || 0}`;
    if (!force && key === this.lastPreviewKey) return;
    this.applyingSide = 'preview';
    let result = null;
    try {
      result = this.callbacks.syncPreviewToEditor?.({ reason }) || { status: 'unconfigured' };
      if (result?.status === 'mapped') this.lastPreviewKey = key;
    } finally {
      this.releaseApplyingSide(96);
    }
    if (result?.status === 'mapping-failed') this.stats.mappingFailures += 1;
    this.recordResult('preview-to-editor', reason, result);
  }

  releaseApplyingSide(delay = 32) {
    clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => {
      this.applyingSide = '';
    }, delay);
  }

  notifyPreviewMounted(reason = 'preview-mounted') {
    this.previewRevision += 1;
    if (this.applyingSide === 'editor') return;
    const from = Math.min(this.editor.selectionStart || 0, this.editor.selectionEnd || 0);
    const to = Math.max(this.editor.selectionStart || 0, this.editor.selectionEnd || 0);
    if (from === to) return;
    this.stats.previewRefreshes += 1;
    const shouldRealign = performance.now() < this.editorAlignmentUntil;
    this.scheduleEditor(shouldRealign, reason, { force: true, frames: 1, extendAlignment: false });
  }

  notifyPreviewReplaced(reason = 'preview-replaced') {
    this.notifyPreviewMounted(reason);
  }

  notifyEditorGeometry(reason = 'editor-geometry') {
    if (this.applyingSide) return;
    this.stats.editorGeometryRefreshes += 1;
    const previewSelection = window.getSelection?.();
    const previewSelectionActive = Boolean(
      previewSelection
      && !previewSelection.isCollapsed
      && this.preview.contains(previewSelection.anchorNode)
      && this.preview.contains(previewSelection.focusNode)
    );
    if (previewSelectionActive) {
      this.schedulePreview(reason, { force: true, frames: 2 });
      return;
    }
    const from = Math.min(this.editor.selectionStart || 0, this.editor.selectionEnd || 0);
    const to = Math.max(this.editor.selectionStart || 0, this.editor.selectionEnd || 0);
    if (from !== to) {
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
      previewRevision: this.previewRevision,
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
    return {
      started: this.started,
      applyingSide: this.applyingSide,
      previewRevision: this.previewRevision,
      ...this.stats
    };
  }
}

export function createSelectionSyncController(editor, preview) {
  return new SelectionSyncController(editor, preview);
}
