/**
 * Responsibility: Final Stage 9 bidirectional selection orchestration. It coordinates Readers, frozen model-kernel mapping, Highlight Session, Feedback Guard and Retry Scheduler without owning any of those specialist responsibilities.
 * Imports: No production imports; every editor/model/preview/scroll/mapping/runtime capability is injected by the composition root.
 * State/side effects: Owns selection listeners, two cancellable frames, one document-scoped Editor reveal intent, dedupe state and statistics. Chapter work stays with Preview.
 * Lifecycle: start()/stop() are idempotent; destroy() is terminal and removes every owned listener/frame/subscription while leaving injected dependencies to their owners.
 */

const REQUIRED_FEEDBACK_METHODS = ['begin', 'shouldIgnore', 'advanceRevision', 'release', 'reset', 'getRevision', 'getState'];
const REQUIRED_HIGHLIGHT_METHODS = ['canPresent', 'show', 'restore', 'clear'];
const REQUIRED_RETRY_METHODS = ['schedule', 'cancel'];
const REQUIRED_MAPPING_METHODS = ['createPreviewRangesForSourceSelection', 'mapPreviewDomPointToSource'];
const REQUIRED_EDITOR_MAPPER_METHODS = ['getLineNumberAtPosition', 'getContentYForPosition'];
const REQUIRED_PREVIEW_MAPPER_METHODS = ['getAnchors', 'getMetrics', 'getContentYForLine'];
const SYNC_VIEWPORT_RATIO = 0.38;
const SELECTION_VIEWPORT_RATIO = 0.5;
const SAFE_EDGE_MIN_PX = 32;
const SAFE_EDGE_MAX_PX = 96;
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function assertMethods(value, methods, label) {
  if (!value || methods.some(name => typeof value[name] !== 'function')) {
    throw new TypeError(`SelectionSyncController requires ${label}`);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function viewportRatioForRect(container, rect, fallback = SELECTION_VIEWPORT_RATIO) {
  const height = Math.max(1, Number(container?.clientHeight) || 1);
  const containerRect = container?.getBoundingClientRect?.();
  if (!containerRect || !rect) return fallback;
  const center = (Number(rect.top) + Number(rect.bottom)) / 2;
  if (!Number.isFinite(center)) return fallback;
  const safeMargin = Math.min(SAFE_EDGE_MAX_PX, Math.max(SAFE_EDGE_MIN_PX, height * 0.14));
  const minRatio = Math.min(0.45, safeMargin / height);
  const maxRatio = Math.max(0.55, 1 - safeMargin / height);
  return clamp((center - containerRect.top) / height, minRatio, maxRatio);
}

function rangeViewportRect(range) {
  if (!range) return null;
  const rects = Array.from(range.getClientRects?.() || []).filter(rect => Number(rect.width) > 0 || Number(rect.height) > 0);
  const values = rects.length ? rects : [range.getBoundingClientRect?.()].filter(Boolean);
  if (!values.length) return null;
  const top = Math.min(...values.map(rect => Number(rect.top) || 0));
  const bottom = Math.max(...values.map(rect => Number(rect.bottom) || top));
  const left = Math.min(...values.map(rect => Number(rect.left) || 0));
  const right = Math.max(...values.map(rect => Number(rect.right) || left));
  return { top, bottom, left, right, width: Math.max(0, right - left), height: Math.max(1, bottom - top) };
}

function combinedViewportRect(ranges) {
  const rects = Array.from(ranges || [], rangeViewportRect).filter(Boolean);
  if (!rects.length) return null;
  const top = Math.min(...rects.map(rect => rect.top));
  const bottom = Math.max(...rects.map(rect => rect.bottom));
  const left = Math.min(...rects.map(rect => rect.left));
  const right = Math.max(...rects.map(rect => rect.right));
  return { top, bottom, left, right, width: Math.max(0, right - left), height: Math.max(1, bottom - top) };
}

function anchorSourceRange(anchor) {
  const sourceStart = Number(anchor?.dataset?.sourceStartIndex);
  const sourceEnd = Number(anchor?.dataset?.sourceEndIndex);
  if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) return null;
  return { sourceStart, sourceEnd };
}

function closestSourceAnchor(preview, node) {
  const element = node?.nodeType === ELEMENT_NODE ? node : node?.parentElement;
  const anchor = element?.closest?.('[data-source-line]') || null;
  return anchor && preview.contains?.(anchor) ? anchor : null;
}

export class SelectionSyncController {
  constructor(editor, preview, options = {}) {
    if (!editor || typeof editor.addEventListener !== 'function' || typeof editor.removeEventListener !== 'function') {
      throw new TypeError('SelectionSyncController requires editor event target');
    }
    if (!preview || typeof preview.addEventListener !== 'function' || typeof preview.removeEventListener !== 'function') {
      throw new TypeError('SelectionSyncController requires preview event target');
    }
    const {
      editorApi,
      documentModel,
      editorMapper,
      getPreviewMapper,
      getPreviewVirtual = () => null,
      focusPreviewLine = () => false,
      editorSelectionReader,
      previewSelectionReader,
      feedbackGuard,
      highlightSession,
      retryScheduler,
      selectionMapping,
      componentMapping = null,
      scrollController,
      documentRef = editor.ownerDocument,
      requestFrame,
      cancelFrame,
      now = () => 0,
      isHybridLayout = () => false,
      isGeometryChanging = () => false,
      updateActiveLine = () => {},
      record = () => {},
      diagnostic = () => {}
    } = options;

    assertMethods(editorApi, ['getSelection', 'setSelection', 'focus', 'subscribe', 'getScrollMetrics'], 'editorApi');
    assertMethods(documentModel, ['getTextLength', 'sliceText', 'getDocumentVersion'], 'DocumentModel');
    assertMethods(editorMapper, REQUIRED_EDITOR_MAPPER_METHODS, 'EditorScrollMapper');
    if (typeof getPreviewMapper !== 'function') throw new TypeError('SelectionSyncController requires getPreviewMapper capability');
    if (typeof getPreviewVirtual !== 'function' || typeof focusPreviewLine !== 'function') {
      throw new TypeError('SelectionSyncController requires Preview runtime capabilities');
    }
    assertMethods(editorSelectionReader, ['read'], 'EditorSelectionReader');
    assertMethods(previewSelectionReader, ['read', 'subscribe', 'start', 'stop'], 'PreviewSelectionReader');
    assertMethods(feedbackGuard, REQUIRED_FEEDBACK_METHODS, 'SelectionFeedbackGuard');
    assertMethods(highlightSession, REQUIRED_HIGHLIGHT_METHODS, 'SelectionHighlightSession');
    assertMethods(retryScheduler, REQUIRED_RETRY_METHODS, 'SelectionRetryScheduler');
    assertMethods(selectionMapping, REQUIRED_MAPPING_METHODS, 'frozen selectionMappingApi');
    if (componentMapping) assertMethods(componentMapping, REQUIRED_MAPPING_METHODS, 'rendered component mapping');
    assertMethods(scrollController, ['scrollTo', 'getState'], 'ScrollSyncController');
    if (!documentRef || typeof documentRef.addEventListener !== 'function' || typeof documentRef.removeEventListener !== 'function') {
      throw new TypeError('SelectionSyncController requires documentRef event target');
    }
    if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
      throw new TypeError('SelectionSyncController requires requestFrame/cancelFrame capabilities');
    }
    for (const [name, value] of Object.entries({ now, isHybridLayout, isGeometryChanging, updateActiveLine, record, diagnostic })) {
      if (typeof value !== 'function') throw new TypeError(`SelectionSyncController requires ${name} capability`);
    }

    this.editor = editor;
    this.preview = preview;
    this.editorApi = editorApi;
    this.documentModel = documentModel;
    this.editorMapper = editorMapper;
    this.getPreviewMapper = getPreviewMapper;
    this.getPreviewVirtual = getPreviewVirtual;
    this.focusPreviewLine = focusPreviewLine;
    this.editorSelectionReader = editorSelectionReader;
    this.previewSelectionReader = previewSelectionReader;
    this.feedbackGuard = feedbackGuard;
    this.highlightSession = highlightSession;
    this.retryScheduler = retryScheduler;
    this.selectionMapping = selectionMapping;
    this.componentMapping = componentMapping;
    this.scrollController = scrollController;
    this.documentRef = documentRef;
    this.requestFrame = requestFrame;
    this.cancelScheduledFrameRequest = cancelFrame;
    this.now = now;
    this.isHybridLayout = isHybridLayout;
    this.isGeometryChanging = isGeometryChanging;
    this.layoutRevision = 0;
    this.layoutSize = this.readLayoutSize();
    this.updateActiveLine = updateActiveLine;
    this.record = record;
    this.diagnostic = diagnostic;
    this.previewSelectionDisposer = null;
    this.started = false;
    this.destroyed = false;
    this.editorPointerActive = false;
    this.editorFrame = 0;
    this.previewFrame = 0;
    this.editorFrameVersion = 0;
    this.previewFrameVersion = 0;
    this.lastEditorKey = '';
    this.lastPreviewKey = '';
    this.editorIntent = null;
    this.editorRevealStartedAt = null;
    this.editorGestureId = 0;
    this.finalFeedbackState = null;
    this.stats = {
      editorRequests: 0,
      previewRequests: 0,
      previewRefreshes: 0,
      editorGeometryRefreshes: 0,
      pendingRetries: 0,
      mappingFailures: 0,
      ignoredFeedbackEvents: 0,
      revealsCompleted: 0,
      lastRevealDurationMs: null
    };

    this.onEditorSelect = () => this.scheduleEditor(false, 'editor-select');
    this.onEditorKeyUp = event => {
      const selection = this.editorSelectionReader.read();
      if (event?.shiftKey || (selection && !selection.isCollapsed)) {
        if (event?.shiftKey) { this.editorRevealStartedAt = this.now(); this.editorGestureId += 1; }
        this.scheduleEditor(Boolean(event?.shiftKey), 'editor-keyup');
      }
    };
    this.onEditorPointerDown = () => {
      this.editorPointerActive = true;
      this.editorRevealStartedAt = null;
      this.editorIntent = null;
      this.highlightSession.clear();
      this.retryScheduler.cancel();
      this.cancelScheduledFrame('editor');
    };
    this.onDocumentPointerUp = () => {
      if (!this.editorPointerActive) return;
      this.editorPointerActive = false;
      this.editorRevealStartedAt = this.now();
      this.editorGestureId += 1;
      this.scheduleEditor(true, 'editor-pointerup', { force: true, frames: 1 });
    };
    this.onStablePreviewSelection = ({ reason = 'preview-selection', force = false, snapshot = null } = {}) => {
      if (!snapshot) return;
      if (this.feedbackGuard.shouldIgnore('preview')) {
        this.stats.ignoredFeedbackEvents += 1;
        return;
      }
      this.stats.previewRequests += 1;
      this.runPreview(reason, Boolean(force), snapshot, true);
    };
    this.onPreviewKeyUp = () => this.schedulePreview('preview-keyup', { force: true, frames: 1 });
  }

  assertActive() {
    if (this.destroyed) throw new Error('SelectionSyncController is destroyed');
  }

  requirePreviewMapper() {
    const mapper = this.getPreviewMapper();
    assertMethods(mapper, REQUIRED_PREVIEW_MAPPER_METHODS, 'PreviewScrollMapper');
    return mapper;
  }

  start() {
    this.assertActive();
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
    this.unsubscribeEditorSelection = this.editorApi.subscribe(update => { if (update.selectionSet) this.onEditorSelect(update); });
    this.editor.addEventListener('keyup', this.onEditorKeyUp);
    this.editor.addEventListener('pointerdown', this.onEditorPointerDown, true);
    this.preview.addEventListener('keyup', this.onPreviewKeyUp);
    this.documentRef.addEventListener('pointerup', this.onDocumentPointerUp, true);
    this.documentRef.addEventListener('pointercancel', this.onDocumentPointerUp, true);
    return this;
  }

  stop() {
    if (this.destroyed) return;
    this.editorIntent = null;
    this.editorRevealStartedAt = null;
    this.retryScheduler.cancel();
    this.cancelScheduledFrame('editor');
    this.cancelScheduledFrame('preview');
    this.feedbackGuard.reset();
    if (!this.started) return;
    this.started = false;
    this.editorPointerActive = false;
    this.unsubscribeEditorSelection?.();
    this.unsubscribeEditorSelection = null;
    this.editor.removeEventListener('keyup', this.onEditorKeyUp);
    this.editor.removeEventListener('pointerdown', this.onEditorPointerDown, true);
    this.preview.removeEventListener('keyup', this.onPreviewKeyUp);
    this.documentRef.removeEventListener('pointerup', this.onDocumentPointerUp, true);
    this.documentRef.removeEventListener('pointercancel', this.onDocumentPointerUp, true);
    this.previewSelectionReader.stop();
    this.previewSelectionDisposer?.();
    this.previewSelectionDisposer = null;
  }

  cancelScheduledFrame(side) {
    const property = side === 'editor' ? 'editorFrame' : 'previewFrame';
    const versionProperty = side === 'editor' ? 'editorFrameVersion' : 'previewFrameVersion';
    this[versionProperty] += 1;
    const id = this[property];
    this[property] = 0;
    if (id) this.cancelScheduledFrameRequest(id);
  }

  scheduleFrameChain(side, frames, publish) {
    const property = side === 'editor' ? 'editorFrame' : 'previewFrame';
    const versionProperty = side === 'editor' ? 'editorFrameVersion' : 'previewFrameVersion';
    this.cancelScheduledFrame(side);
    const version = ++this[versionProperty];
    let remaining = Math.max(1, Number(frames) || 1);
    const run = () => {
      if (this.destroyed || version !== this[versionProperty]) return;
      if (--remaining > 0) {
        this[property] = this.requestFrame(run);
        return;
      }
      this[property] = 0;
      publish();
    };
    this[property] = this.requestFrame(run);
  }

  makeEditorKey(selection = this.editorSelectionReader.read()) {
    const from = Number(selection?.from) || 0;
    const to = Math.max(from, Number(selection?.to) || 0);
    return `${this.documentModel.getDocumentVersion()}:${from}:${to}:${this.feedbackGuard.getRevision()}`;
  }

  selectionIdentity(selection = this.editorSelectionReader.read()) {
    return `${this.documentModel.documentId || ''}:${this.documentModel.generation || 0}:${this.documentModel.getDocumentVersion()}:${selection?.from}:${selection?.to}:${this.layoutRevision}`;
  }

  readLayoutSize() {
    return [this.editor, this.preview].map(element => {
      const rect = element.getBoundingClientRect?.();
      const width = Number.isFinite(rect?.width) ? Number(rect.width.toFixed(2)) : element.clientWidth || 0;
      const height = Number.isFinite(rect?.height) ? Number(rect.height.toFixed(2)) : element.clientHeight || 0;
      return `${width}:${height}`;
    }).join('|');
  }

  notifyLayoutGeometry(reason = 'layout-resize-settled') {
    if (this.destroyed || this.isGeometryChanging()) return false;
    const size = this.readLayoutSize();
    if (size === this.layoutSize) return false;
    this.layoutSize = size;
    this.layoutRevision += 1;
    this.editorIntent = null;
    this.lastEditorKey = '';
    this.retryScheduler.cancel();
    this.cancelScheduledFrame('editor');
    if (this.previewSelectionReader.read()) {
      this.schedulePreview(reason, { force: true, frames: 2 });
      return true;
    }
    const selection = this.editorSelectionReader.read();
    const scroll = this.scrollController.getState();
    if (selection && !selection.isCollapsed && scroll.sourceSide !== 'preview'
      && !['wheel', 'touch'].includes(scroll.sourceReason)) {
      this.scheduleEditor(true, reason, { force: true, frames: 2 });
    }
    return true;
  }

  isEditorIntentCurrent(intent = this.editorIntent) {
    if (this.destroyed || !intent || intent !== this.editorIntent || this.isHybridLayout()) return false;
    const scroll = this.scrollController.getState();
    return intent.identity === this.selectionIdentity()
      && scroll.sourceSide !== 'preview'
      && !['wheel', 'touch'].includes(scroll.sourceReason);
  }

  prepareEditorIntent(selection) {
    if (!this.isEditorIntentCurrent()) {
      this.editorIntent = {
        identity: this.selectionIdentity(selection),
        startedAt: this.editorRevealStartedAt,
        gestureId: this.editorGestureId,
        scopeWaitMs: 0,
        scopePending: false,
        revealed: false
      };
      this.editorRevealStartedAt = null;
    }
    return this.editorIntent;
  }

  requestPreviewScope(line) {
    const intent = this.prepareEditorIntent(this.editorSelectionReader.read());
    if (intent.scopePending) return;
    intent.scopePending = true;
    const scopeStartedAt = this.now();
    // Keep this exact selection alive across asynchronous chapter work. A new
    // gesture/document/selection invalidates it, independently of DOM revisions.
    Promise.resolve().then(() => {
      if (!this.isEditorIntentCurrent(intent)) return false;
      return this.focusPreviewLine(line, { behavior: 'auto', scroll: false,
        isCurrent: () => this.isEditorIntentCurrent(intent) });
    }).then(ready => {
      if (!this.isEditorIntentCurrent(intent)) return;
      intent.scopePending = false;
      intent.scopeWaitMs += Math.max(0, this.now() - scopeStartedAt);
      if (ready === false) { this.editorIntent = null; return; }
      this.scheduleEditor(true, 'editor-scope-ready', { force: true, frames: 1, extendAlignment: false });
    }, error => {
      if (!this.isEditorIntentCurrent(intent)) return;
      this.editorIntent = null;
      this.diagnostic('selection.sync-anomaly', { category: 'sync.selection', status: 'error',
        details: { direction: 'editor-to-preview', reason: 'preview-focus-failed', message: error?.message || String(error) } });
    });
  }

  scheduleEditor(shouldScroll = false, reason = 'editor-selection', options = {}) {
    if (this.destroyed) return false;
    if (this.feedbackGuard.shouldIgnore('editor', { allowSource: true })) {
      this.stats.ignoredFeedbackEvents += 1;
      return false;
    }
    this.stats.editorRequests += 1;
    this.retryScheduler.cancel();
    this.scheduleFrameChain('editor', options.frames, () => {
      this.runEditor(shouldScroll, reason, Boolean(options.force), 0);
    });
    return true;
  }

  runEditor(shouldScroll, reason, force, attempt) {
    if (this.destroyed || this.isGeometryChanging() || this.feedbackGuard.shouldIgnore('editor', { allowSource: true })) return null;
    if (['wheel', 'touch'].includes(this.scrollController.getState().sourceReason)) shouldScroll = false;
    const selection = this.editorSelectionReader.read();
    if (!this.isEditorIntentCurrent()) this.editorIntent = null;
    if (shouldScroll && selection && !selection.isCollapsed) this.prepareEditorIntent(selection);
    const key = this.makeEditorKey(selection);
    if (!force && key === this.lastEditorKey) return null;
    const token = this.feedbackGuard.begin('editor');
    let result;
    try {
      result = this.syncEditorToPreview(Boolean(shouldScroll), reason, selection);
      this.lastEditorKey = key;
    } finally {
      this.feedbackGuard.release(token, 32);
    }
    this.recordResult('editor-to-preview', reason, result);
    if (result?.status === 'pending' && !this.editorIntent?.scopePending) {
      const scheduled = this.retryScheduler.schedule({
        version: key,
        getVersion: () => this.makeEditorKey(),
        run: ({ attempt: retryAttempt }) => this.runEditor(shouldScroll, `${reason}-retry`, true, retryAttempt)
      });
      if (scheduled) this.stats.pendingRetries += 1;
    }
    return result;
  }

  schedulePreview(reason = 'preview-selection', options = {}) {
    if (this.destroyed) return false;
    if (this.feedbackGuard.shouldIgnore('preview', { allowSource: true })) {
      this.stats.ignoredFeedbackEvents += 1;
      return false;
    }
    this.stats.previewRequests += 1;
    this.scheduleFrameChain('preview', options.frames, () => this.runPreview(reason, Boolean(options.force)));
    return true;
  }

  runPreview(reason, force, snapshot = null, snapshotProvided = false) {
    if (this.destroyed || this.isGeometryChanging() || this.feedbackGuard.shouldIgnore('preview', { allowSource: true })) return null;
    const selection = snapshotProvided ? snapshot : this.previewSelectionReader.read();
    if (!selection) return null;
    this.editorIntent = null;
    const key = `${selection.text || ''}:${selection.anchorOffset || 0}:${selection.focusOffset || 0}:${this.feedbackGuard.getRevision()}`;
    if (!force && key === this.lastPreviewKey) return null;
    const token = this.feedbackGuard.begin('preview');
    let result;
    try {
      result = this.syncPreviewToEditor(reason, selection);
      if (result?.status === 'mapped') this.lastPreviewKey = key;
    } finally {
      this.feedbackGuard.release(token, 96);
    }
    if (result?.status === 'mapping-failed') this.stats.mappingFailures += 1;
    this.recordResult('preview-to-editor', reason, result);
    return result;
  }

  buildPreviewHighlightPlan(from, to) {
    const previewMapper = this.requirePreviewMapper();
    const candidates = previewMapper.getAnchors().filter(anchor => {
      const range = anchorSourceRange(anchor);
      return range && range.sourceEnd > from && range.sourceStart < to;
    });
    if (!candidates.length) return null;

    const ranges = [];
    const atomicElements = new Set();
    let sourceCharacters = 0;
    let mappedCharacters = 0;
    let projectionCoverage = 1;
    let matchedAnchors = 0;
    let componentMappings = 0;
    for (const anchor of candidates) {
      const sourceRange = anchorSourceRange(anchor);
      if (!sourceRange) continue;
      const source = this.documentModel.sliceText(sourceRange.sourceStart, sourceRange.sourceEnd);
      const component = this.componentMapping?.createPreviewRangesForSourceSelection(anchor, source, sourceRange.sourceStart, from, to);
      const mapped = component || this.selectionMapping.createPreviewRangesForSourceSelection(
        anchor,
        source,
        sourceRange.sourceStart,
        from,
        to
      );
      const mappedSourceCharacters = Number(mapped?.sourceCharacters) || 0;
      sourceCharacters += mappedSourceCharacters;
      mappedCharacters += Number(mapped?.mappedCharacters) || 0;
      projectionCoverage = Math.min(
        projectionCoverage,
        Number.isFinite(mapped?.projectionCoverage) ? mapped.projectionCoverage : 0
      );
      if (mapped?.ranges?.length || mapped?.atomicElements?.length) {
        ranges.push(...mapped.ranges);
        matchedAnchors += 1;
      }
      if (mapped?.componentMapping) componentMappings += 1;
      for (const element of mapped?.atomicElements || []) atomicElements.add(element);
    }
    const visibleCoverage = sourceCharacters ? mappedCharacters / sourceCharacters : 1;
    if (projectionCoverage < 0.96 || visibleCoverage < 0.96) return null;
    const plan = {
      ranges,
      atomicElements: [...atomicElements],
      rect: combinedViewportRect([...ranges, ...atomicElements]),
      matchedAnchors,
      sourceCharacters,
      mappedCharacters,
      visibleCoverage,
      projectionCoverage,
      componentMappings
    };
    return this.highlightSession.canPresent(plan) ? plan : null;
  }

  ensurePreviewRangeReady(fromLine, toLine, shouldScroll) {
    const virtual = this.getPreviewVirtual();
    if (!virtual?.active) return true;
    if (virtual.containsLineRange?.(fromLine, toLine) === false) {
      if (shouldScroll) this.requestPreviewScope(fromLine);
      return false;
    }
    if (!shouldScroll && virtual.hasLineRangeMounted?.(fromLine, toLine) === false) return false;
    if (shouldScroll) {
      virtual.ensureLineRangeVisible?.(fromLine, toLine) || virtual.ensureLineVisible?.(fromLine);
      this.requirePreviewMapper().invalidateStructure?.();
    }
    return virtual.hasLineRangeMounted?.(fromLine, toLine) !== false;
  }

  scrollPreviewPlanIntoView(plan, fromLine) {
    const height = Math.max(1, this.preview.clientHeight);
    const viewportTop = (this.preview.getBoundingClientRect?.().top || 0) + (this.preview.clientTop || 0);
    const top = plan?.rect ? plan.rect.top - viewportTop
      : this.requirePreviewMapper().getContentYForLine(fromLine) - this.preview.scrollTop;
    const bottom = plan?.rect ? plan.rect.bottom - viewportTop : top + 1;
    // A visible target is already located. Do not align it to the source pane.
    if (top >= -1 && bottom <= height + 1) return false;
    const margin = Math.min(8, height / 4);
    if (bottom - top > height - margin * 2 && top < height && bottom > 0) return false;
    const delta = top < 0 || bottom - top > height - margin * 2 ? top - margin : bottom - height + margin;
    return this.scrollController.scrollTo('preview', this.preview.scrollTop + delta, {
      behavior: 'auto',
      reason: 'selection-editor-to-preview',
      suspendMs: 180,
      settleMs: 700
    });
  }

  revealPreviewSelection(plan, fromLine) {
    // A collapsed pane has zero-size Range rects. They cannot establish that a
    // target is visible or complete a reveal before the user opens that pane.
    if (this.preview.clientHeight <= 0 || this.preview.clientWidth <= 0) return;
    const moved = this.scrollPreviewPlanIntoView(plan, fromLine);
    const intent = this.editorIntent;
    if (!intent) return;
    if (!moved && !intent.scrollStarted && intent.startedAt === null) { intent.revealed = true; return; }
    intent.scrollStarted ||= moved;
    const rect = combinedViewportRect(plan.ranges) || plan.rect;
    const position = rect ? [rect.top, rect.bottom, this.preview.scrollTop] : [this.preview.scrollTop];
    const stable = !moved && intent.lastRevealPosition?.length === position.length
      && position.every((value, i) => Math.abs(value - intent.lastRevealPosition[i]) <= 1);
    intent.visibleSamples = stable ? (intent.visibleSamples || 0) + 1 : 0;
    intent.lastRevealPosition = position;
    if (intent.visibleSamples >= 3) {
      intent.revealed = true;
      if (intent.startedAt !== null) {
        const durationMs = Math.max(0, this.now() - intent.startedAt);
        this.stats.revealsCompleted += 1;
        this.stats.lastRevealDurationMs = durationMs;
        this.record('selection.reveal-latency', { category: 'sync.selection', durationMs,
          details: { gestureId: intent.gestureId, layoutRevision: this.layoutRevision,
            scopeWaitMs: intent.scopeWaitMs, stableFrames: intent.visibleSamples } });
      }
      return;
    }
    intent.revealChecks = (intent.revealChecks || 0) + 1;
    if (intent.revealChecks <= 30) {
      this.scheduleEditor(true, 'editor-reveal-settle', { force: true, frames: 1 });
    } else {
      this.editorIntent = null;
      this.diagnostic('selection.sync-anomaly', { category: 'sync.selection', status: 'warning',
        details: { direction: 'editor-to-preview', reason: 'preview-reveal-unsettled' } });
    }
  }

  getEditorContentYForPosition(position) {
    const rect = this.editorApi.getPositionCoordinates?.(position);
    const viewport = this.editorApi.getScrollViewportRect?.();
    if (rect && viewport && Number.isFinite(rect.top) && Number.isFinite(rect.bottom)) {
      return this.editorApi.getScrollMetrics().top + (rect.top + rect.bottom) / 2 - viewport.top;
    }
    // Unmounted positions use the frozen mapper's estimate. Visible words need
    // their actual wrapped row rather than the midpoint of the whole paragraph.
    return this.editorMapper.getContentYForPosition(position);
  }

  syncEditorToPreview(shouldScroll = false, reason = 'editor-selection', selectionSnapshot = null) {
    if (this.destroyed) return { status: 'destroyed', selectionLength: 0, matchedAnchors: 0 };
    if (this.feedbackGuard.shouldIgnore('editor', { allowSource: true })) {
      return { status: 'locked', selectionLength: 0, matchedAnchors: 0 };
    }
    const selection = selectionSnapshot || this.editorSelectionReader.read();
    const from = Math.max(0, Number(selection?.from) || 0);
    const to = Math.max(from, Number(selection?.to) || 0);
    const cursorLine = this.editorMapper.getLineNumberAtPosition(from);
    this.updateActiveLine(cursorLine);
    if (this.isHybridLayout()) {
      this.highlightSession.clear();
      return { status: 'hybrid', selectionLength: to - from, matchedAnchors: 0 };
    }
    if (!selection || selection.isCollapsed || from === to) {
      this.highlightSession.clear();
      return { status: 'cleared', selectionLength: 0, matchedAnchors: 0 };
    }
    if (to - from <= 2 && /^[\r\n]+$/.test(this.documentModel.sliceText(from, to))) {
      this.highlightSession.clear();
      return { status: 'cleared', selectionLength: to - from, matchedAnchors: 0 };
    }

    const endPosition = Math.max(from, to - 1);
    const fromLine = this.editorMapper.getLineNumberAtPosition(from);
    const toLine = this.editorMapper.getLineNumberAtPosition(endPosition);
    if (!this.ensurePreviewRangeReady(fromLine, toLine, shouldScroll)) {
      this.highlightSession.clear();
      return { status: shouldScroll ? 'pending' : 'offscreen', selectionLength: to - from, matchedAnchors: 0, sourceStart: from, sourceEnd: to };
    }
    const createPlan = () => this.buildPreviewHighlightPlan(from, to);
    const plan = createPlan();
    if (!plan) {
      return { status: this.getPreviewVirtual()?.active ? 'pending' : 'mapping-failed', selectionLength: to - from, matchedAnchors: 0, sourceStart: from, sourceEnd: to };
    }
    this.highlightSession.show(plan, { restore: createPlan });
    const editorY = this.getEditorContentYForPosition(from + Math.floor((to - from) / 2));
    const sourceViewportRatio = clamp(
      (editorY - this.editorApi.getScrollMetrics().top) / Math.max(1, this.editorApi.getScrollMetrics().clientHeight),
      0.05,
      0.95
    );
    if (shouldScroll && !this.editorIntent?.revealed) {
      this.revealPreviewSelection(plan, fromLine);
    }
    const targetViewportRatio = viewportRatioForRect(this.preview, combinedViewportRect([...plan.ranges, ...plan.atomicElements]) || plan.rect);
    return {
      status: plan.componentMappings ? 'mapped' : 'exact',
      selectionLength: to - from,
      matchedAnchors: plan.matchedAnchors,
      mappedCharacters: plan.mappedCharacters,
      mappingCoverage: Math.min(plan.visibleCoverage, plan.projectionCoverage),
      mappingMode: plan.componentMappings ? 'source-component' : 'source-dom',
      exactMapping: !plan.componentMappings,
      sourceStart: from,
      sourceEnd: to,
      sourceViewportRatio,
      targetViewportRatio
    };
  }

  mapPreviewPoint(anchor, node, offset, affinity) {
    const sourceRange = anchorSourceRange(anchor);
    if (!sourceRange) return null;
    const source = this.documentModel.sliceText(sourceRange.sourceStart, sourceRange.sourceEnd);
    return this.componentMapping?.mapPreviewDomPointToSource(anchor, source, sourceRange.sourceStart, node, offset, affinity)
      || this.selectionMapping.mapPreviewDomPointToSource(
      anchor,
      source,
      sourceRange.sourceStart,
      node,
      offset,
      affinity
    );
  }

  syncPreviewToEditor(reason = 'preview-selection', selectionSnapshot = null) {
    if (this.destroyed) return { status: 'destroyed', selectionLength: 0, matchedAnchors: 0 };
    if (this.feedbackGuard.shouldIgnore('preview', { allowSource: true })) {
      return { status: 'locked', selectionLength: 0, matchedAnchors: 0 };
    }
    const selection = selectionSnapshot || this.previewSelectionReader.read();
    const range = selection?.range;
    if (!selection || !range) return { status: 'no-selection', selectionLength: 0, matchedAnchors: 0 };
    const startAnchor = closestSourceAnchor(this.preview, range.startContainer);
    const endAnchor = closestSourceAnchor(this.preview, range.endContainer);
    if (!startAnchor || !endAnchor) {
      return { status: 'mapping-failed', selectionLength: selection.text?.length || 0, matchedAnchors: 0 };
    }
    const exactStart = this.mapPreviewPoint(startAnchor, range.startContainer, range.startOffset, 'start');
    const exactEnd = this.mapPreviewPoint(endAnchor, range.endContainer, range.endOffset, 'end');
    const coverage = Math.min(
      Number.isFinite(exactStart?.projectionCoverage) ? exactStart.projectionCoverage : 0,
      Number.isFinite(exactEnd?.projectionCoverage) ? exactEnd.projectionCoverage : 0
    );
    if (!Number.isFinite(exactStart?.position) || !Number.isFinite(exactEnd?.position) || coverage < 0.96) {
      return {
        status: 'mapping-failed',
        selectionLength: selection.text?.length || 0,
        matchedAnchors: 2,
        mappingCoverage: coverage
      };
    }

    const textLength = this.documentModel.getTextLength();
    const start = clamp(Math.min(exactStart.position, exactEnd.position), 0, textLength);
    const end = clamp(Math.max(exactStart.position, exactEnd.position), start, textLength);
    if (end <= start) {
      return { status: 'mapping-failed', selectionLength: selection.text?.length || 0, matchedAnchors: 2, mappingCoverage: coverage };
    }
    this.editorApi.setSelection(start, end);
    const selectionRect = rangeViewportRect(range);
    const sourceViewportRatio = viewportRatioForRect(this.preview, selectionRect);
    const targetIndex = start + Math.floor((end - start) / 2);
    const editorY = this.getEditorContentYForPosition(targetIndex);
    const behavior = /pointerup|keyup|selectionchange/.test(reason) ? 'smooth' : 'auto';
    this.scrollController.scrollTo('editor', editorY - this.editorApi.getScrollMetrics().clientHeight * sourceViewportRatio, {
      behavior,
      reason: 'selection-preview-to-editor',
      suspendMs: behavior === 'smooth' ? 520 : 180,
      settleMs: behavior === 'smooth' ? 1000 : 700
    });
    this.updateActiveLine(this.editorMapper.getLineNumberAtPosition(start));
    // This is still the Preview-owned operation. Re-entering editor-to-preview
    // synchronization is correctly blocked by the feedback guard and loses its highlight.
    const createPlan = () => this.buildPreviewHighlightPlan(start, end);
    const highlight = createPlan();
    if (highlight) this.highlightSession.show(highlight, { restore: createPlan });
    return {
      status: 'mapped',
      selectionLength: selection.text?.length || end - start,
      matchedAnchors: highlight?.matchedAnchors || 2,
      sourceStart: start,
      sourceEnd: end,
      exactMapping: !exactStart.componentMapping && !exactEnd.componentMapping,
      mappingMode: exactStart.componentMapping || exactEnd.componentMapping ? 'component-source' : 'dom-source',
      mappingCoverage: coverage,
      sourceViewportRatio,
      targetViewportRatio: sourceViewportRatio
    };
  }

  notifyPreviewMounted(reason = 'preview-mounted') {
    if (this.destroyed || this.isGeometryChanging()) return;
    this.feedbackGuard.advanceRevision();
    // A mount notification is an internal continuation of the Editor request,
    // not a new Preview selection competing with it.
    if (this.feedbackGuard.shouldIgnore('editor', { allowSource: true }) || this.editorIntent?.scopePending || this.editorPointerActive) return;
    const editorSelection = this.editorSelectionReader.read();
    const shouldRealign = this.shouldRealignEditorSelection();
    if (!shouldRealign && this.highlightSession.getState?.().hasRestore) {
      this.highlightSession.restore();
      return;
    }
    if (!editorSelection || editorSelection.isCollapsed) { this.highlightSession.restore(); return; }
    this.stats.previewRefreshes += 1;
    this.scheduleEditor(shouldRealign, reason, { force: true, frames: 1, extendAlignment: false });
  }

  notifyPreviewMeasured(reason = 'virtual-preview-measured') {
    // Size measurements do not replace DOM nodes. Live ranges remain valid;
    // only an unfinished reveal needs another geometry check.
    if (this.destroyed || this.isGeometryChanging() || this.editorPointerActive || this.editorIntent?.scopePending
      || !this.shouldRealignEditorSelection()) return;
    this.scheduleEditor(true, reason, { force: true, frames: 1, extendAlignment: false });
  }

  notifyPreviewReplaced(reason = 'preview-replaced') {
    this.notifyPreviewMounted(reason);
  }

  shouldRealignEditorSelection() {
    const source = this.scrollController.getState();
    return this.isEditorIntentCurrent() && !this.editorIntent.revealed && source.sourceSide !== 'preview'
      && !['wheel', 'touch', 'keyboard'].includes(source.sourceReason);
  }

  notifyEditorGeometry(reason = 'editor-geometry') {
    if (this.destroyed || this.isGeometryChanging() || this.feedbackGuard.shouldIgnore('editor', { allowSource: true }) || this.editorIntent?.scopePending || this.editorPointerActive) return;
    this.stats.editorGeometryRefreshes += 1;
    // Geometry measurements follow the current scroll gesture; they must not
    // pull a virtual window back to an old selection that the user scrolled away from.
    if (this.scrollController.getState().sourceSide === 'preview') return;
    const previewSelection = this.previewSelectionReader.read();
    if (previewSelection) {
      this.schedulePreview(reason, { force: true, frames: 2 });
      return;
    }
    const editorSelection = this.editorSelectionReader.read();
    if (editorSelection && !editorSelection.isCollapsed) {
      this.scheduleEditor(this.shouldRealignEditorSelection(), reason, { force: true, frames: 2, extendAlignment: false });
    }
  }

  clear() {
    if (this.destroyed) return;
    this.editorIntent = null;
    this.editorRevealStartedAt = null;
    this.lastEditorKey = '';
    this.lastPreviewKey = '';
    this.retryScheduler.cancel();
    this.highlightSession.clear();
  }

  recordResult(direction, reason, result = {}) {
    const status = result?.status || 'unknown';
    if (status === 'hybrid' || status === 'cleared' || status === 'locked' || status === 'destroyed' || status === 'offscreen') return;
    const details = {
      direction,
      reason,
      result: status,
      selectionLength: Number(result?.selectionLength) || 0,
      matchedAnchors: Number(result?.matchedAnchors) || 0,
      virtualized: Boolean(this.getPreviewVirtual()?.active),
      previewRevision: this.feedbackGuard.getRevision(),
      layoutRevision: this.layoutRevision,
      sourceViewportRatio: Number.isFinite(result?.sourceViewportRatio) ? Number(result.sourceViewportRatio.toFixed(3)) : null,
      targetViewportRatio: Number.isFinite(result?.targetViewportRatio) ? Number(result.targetViewportRatio.toFixed(3)) : null,
      mappingMode: result?.mappingMode || null,
      mappingCoverage: Number.isFinite(result?.mappingCoverage) ? Number(result.mappingCoverage.toFixed(3)) : null,
      mappedCharacters: Number(result?.mappedCharacters) || 0,
      exactMapping: Boolean(result?.exactMapping),
      sourceStart: Number.isFinite(result?.sourceStart) ? result.sourceStart : null,
      sourceEnd: Number.isFinite(result?.sourceEnd) ? result.sourceEnd : null
    };
    if (status === 'mapping-failed' || status === 'pending') {
      this.diagnostic('selection.sync-anomaly', {
        category: 'sync.selection',
        status: 'warning',
        dedupeKey: `selection:${direction}:${status}`,
        fingerprint: `${direction}:${status}:${this.documentModel.getDocumentVersion()}:${details.previewRevision}:${reason}`,
        minIntervalMs: 4000,
        details
      });
      return;
    }
    this.record('selection.sync-result', {
      category: 'sync.selection',
      status: 'ok',
      aggregate: true,
      details
    });
  }

  getState() {
    const feedback = this.feedbackGuard?.getState?.() || this.finalFeedbackState || { source: '', revision: 0 };
    return {
      started: this.started,
      destroyed: this.destroyed,
      applyingSide: feedback.source,
      previewRevision: feedback.revision,
      ...this.stats
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.stop();
    this.finalFeedbackState = this.feedbackGuard.getState();
    this.destroyed = true;
    this.retryScheduler.cancel();
    this.highlightSession.clear();
    this.editor = null;
    this.preview = null;
    this.editorApi = null;
    this.documentModel = null;
    this.editorMapper = null;
    this.getPreviewMapper = null;
    this.getPreviewVirtual = null;
    this.focusPreviewLine = null;
    this.editorSelectionReader = null;
    this.previewSelectionReader = null;
    this.feedbackGuard = null;
    this.highlightSession = null;
    this.retryScheduler = null;
    this.selectionMapping = null;
    this.scrollController = null;
    this.documentRef = null;
    this.requestFrame = null;
    this.cancelScheduledFrameRequest = null;
    this.now = null;
    this.isHybridLayout = null;
    this.updateActiveLine = null;
    this.record = null;
    this.diagnostic = null;
  }
}

export function createSelectionSyncController(editor, preview, options = {}) {
  return new SelectionSyncController(editor, preview, options);
}
