/**
 * Responsibility: Final Stage 9 bidirectional selection orchestration. It coordinates Readers, frozen model-kernel mapping, Highlight Session, Feedback Guard and Retry Scheduler without owning any of those specialist responsibilities.
 * Imports: No production imports; every editor/model/preview/scroll/mapping/runtime capability is injected by the composition root.
 * State/side effects: Owns only selection orchestration listener lifecycle, two cancellable scheduling frames, dedupe/alignment state and orchestration statistics.
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
      scrollController,
      documentRef = editor.ownerDocument,
      requestFrame,
      cancelFrame,
      now = () => 0,
      isHybridLayout = () => false,
      updateActiveLine = () => {},
      record = () => {},
      diagnostic = () => {}
    } = options;

    assertMethods(editorApi, ['getSelection', 'setSelection', 'focus'], 'editorApi');
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
    assertMethods(scrollController, ['scrollTo'], 'ScrollSyncController');
    if (!documentRef || typeof documentRef.addEventListener !== 'function' || typeof documentRef.removeEventListener !== 'function') {
      throw new TypeError('SelectionSyncController requires documentRef event target');
    }
    if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
      throw new TypeError('SelectionSyncController requires requestFrame/cancelFrame capabilities');
    }
    for (const [name, value] of Object.entries({ now, isHybridLayout, updateActiveLine, record, diagnostic })) {
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
    this.scrollController = scrollController;
    this.documentRef = documentRef;
    this.requestFrame = requestFrame;
    this.cancelScheduledFrameRequest = cancelFrame;
    this.now = now;
    this.isHybridLayout = isHybridLayout;
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
    this.editorAlignmentUntil = 0;
    this.finalFeedbackState = null;
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
      if (event?.shiftKey || (selection && !selection.isCollapsed)) {
        this.scheduleEditor(Boolean(event?.shiftKey), 'editor-keyup');
      }
    };
    this.onEditorPointerDown = () => { this.editorPointerActive = true; };
    this.onDocumentPointerUp = () => {
      if (!this.editorPointerActive) return;
      this.editorPointerActive = false;
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
    this.editor.addEventListener('select', this.onEditorSelect);
    this.editor.addEventListener('keyup', this.onEditorKeyUp);
    this.editor.addEventListener('pointerdown', this.onEditorPointerDown, true);
    this.preview.addEventListener('keyup', this.onPreviewKeyUp);
    this.documentRef.addEventListener('pointerup', this.onDocumentPointerUp, true);
    this.documentRef.addEventListener('pointercancel', this.onDocumentPointerUp, true);
    return this;
  }

  stop() {
    if (this.destroyed) return;
    this.retryScheduler.cancel();
    this.cancelScheduledFrame('editor');
    this.cancelScheduledFrame('preview');
    this.feedbackGuard.reset();
    if (!this.started) return;
    this.started = false;
    this.editorPointerActive = false;
    this.editor.removeEventListener('select', this.onEditorSelect);
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

  scheduleEditor(shouldScroll = false, reason = 'editor-selection', options = {}) {
    if (this.destroyed) return false;
    if (this.feedbackGuard.shouldIgnore('editor', { allowSource: true })) {
      this.stats.ignoredFeedbackEvents += 1;
      return false;
    }
    this.stats.editorRequests += 1;
    if (shouldScroll && options.extendAlignment !== false) this.editorAlignmentUntil = this.now() + 1400;
    this.retryScheduler.cancel();
    this.scheduleFrameChain('editor', options.frames, () => {
      this.runEditor(shouldScroll, reason, Boolean(options.force), 0);
    });
    return true;
  }

  runEditor(shouldScroll, reason, force, attempt) {
    if (this.destroyed || this.feedbackGuard.shouldIgnore('editor', { allowSource: true })) return null;
    const selection = this.editorSelectionReader.read();
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
    if (result?.status === 'pending') {
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
    if (this.destroyed || this.feedbackGuard.shouldIgnore('preview', { allowSource: true })) return null;
    const selection = snapshotProvided ? snapshot : this.previewSelectionReader.read();
    if (!selection) return null;
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
    for (const anchor of candidates) {
      const sourceRange = anchorSourceRange(anchor);
      if (!sourceRange) continue;
      const source = this.documentModel.sliceText(sourceRange.sourceStart, sourceRange.sourceEnd);
      const mapped = this.selectionMapping.createPreviewRangesForSourceSelection(
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
      if (mapped?.ranges?.length) {
        ranges.push(...mapped.ranges);
        matchedAnchors += 1;
      }
      for (const element of mapped?.atomicElements || []) atomicElements.add(element);
    }
    const visibleCoverage = sourceCharacters ? mappedCharacters / sourceCharacters : 1;
    if (projectionCoverage < 0.96 || visibleCoverage < 0.96) return null;
    const plan = {
      ranges,
      atomicElements: [...atomicElements],
      rect: combinedViewportRect(ranges),
      matchedAnchors,
      sourceCharacters,
      mappedCharacters,
      visibleCoverage,
      projectionCoverage
    };
    return this.highlightSession.canPresent(plan) ? plan : null;
  }

  ensurePreviewRangeReady(fromLine, toLine, shouldScroll) {
    const virtual = this.getPreviewVirtual();
    if (!virtual?.active) return true;
    if (virtual.containsLineRange?.(fromLine, toLine) === false) {
      void this.focusPreviewLine(fromLine, { behavior: 'auto', scroll: Boolean(shouldScroll) });
      return false;
    }
    if (shouldScroll || virtual.hasLineRangeMounted?.(fromLine, toLine) === false) {
      virtual.ensureLineRangeVisible?.(fromLine, toLine) || virtual.ensureLineVisible?.(fromLine);
      this.requirePreviewMapper().invalidateStructure?.();
    }
    return virtual.hasLineRangeMounted?.(fromLine, toLine) !== false;
  }

  scrollPreviewPlanIntoView(plan, fromLine, behavior, viewportRatio) {
    const ratio = clamp(viewportRatio, 0.05, 0.95);
    let contentY = null;
    if (plan?.rect) {
      const previewRect = this.preview.getBoundingClientRect?.();
      if (previewRect) {
        contentY = this.preview.scrollTop + plan.rect.top - previewRect.top + Math.max(1, plan.rect.height) / 2;
      }
    }
    if (!Number.isFinite(contentY)) contentY = this.requirePreviewMapper().getContentYForLine(fromLine);
    const targetTop = contentY - this.preview.clientHeight * ratio;
    this.scrollController.scrollTo('preview', targetTop, {
      behavior,
      reason: 'selection-editor-to-preview',
      suspendMs: behavior === 'smooth' ? 520 : 180,
      settleMs: behavior === 'smooth' ? 1000 : 700
    });
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

    const endPosition = Math.max(from, to - 1);
    const fromLine = this.editorMapper.getLineNumberAtPosition(from);
    const toLine = this.editorMapper.getLineNumberAtPosition(endPosition);
    if (!this.ensurePreviewRangeReady(fromLine, toLine, shouldScroll)) {
      return { status: 'pending', selectionLength: to - from, matchedAnchors: 0 };
    }
    const createPlan = () => this.buildPreviewHighlightPlan(from, to);
    const plan = createPlan();
    if (!plan) {
      return { status: this.getPreviewVirtual()?.active ? 'pending' : 'mapping-failed', selectionLength: to - from, matchedAnchors: 0 };
    }
    this.highlightSession.show(plan, { restore: createPlan });
    const editorY = this.editorMapper.getContentYForPosition(from + Math.floor((to - from) / 2));
    const sourceViewportRatio = clamp(
      (editorY - this.editor.scrollTop) / Math.max(1, this.editor.clientHeight),
      0.05,
      0.95
    );
    const behavior = /pointerup|keyup|editor-select/.test(reason) ? 'smooth' : 'auto';
    if (shouldScroll) this.scrollPreviewPlanIntoView(plan, fromLine, behavior, sourceViewportRatio);
    return {
      status: 'exact',
      selectionLength: to - from,
      matchedAnchors: plan.matchedAnchors,
      mappedCharacters: plan.mappedCharacters,
      mappingCoverage: Math.min(plan.visibleCoverage, plan.projectionCoverage),
      mappingMode: 'source-dom',
      exactMapping: true,
      sourceViewportRatio,
      targetViewportRatio: sourceViewportRatio
    };
  }

  mapPreviewPoint(anchor, node, offset, affinity) {
    const sourceRange = anchorSourceRange(anchor);
    if (!sourceRange) return null;
    const source = this.documentModel.sliceText(sourceRange.sourceStart, sourceRange.sourceEnd);
    return this.selectionMapping.mapPreviewDomPointToSource(
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
    this.editorApi.focus({ preventScroll: true });
    this.editorApi.setSelection(start, end);
    const selectionRect = rangeViewportRect(range);
    const sourceViewportRatio = viewportRatioForRect(this.preview, selectionRect);
    const targetIndex = start + Math.floor((end - start) / 2);
    const editorY = this.editorMapper.getContentYForPosition(targetIndex);
    const behavior = /pointerup|keyup|selectionchange/.test(reason) ? 'smooth' : 'auto';
    this.scrollController.scrollTo('editor', editorY - this.editor.clientHeight * sourceViewportRatio, {
      behavior,
      reason: 'selection-preview-to-editor',
      suspendMs: behavior === 'smooth' ? 520 : 180,
      settleMs: behavior === 'smooth' ? 1000 : 700
    });
    this.updateActiveLine(this.editorMapper.getLineNumberAtPosition(start));
    const highlight = this.syncEditorToPreview(false, 'preview-selection-confirm', {
      from: start,
      to: end,
      isCollapsed: false
    });
    return {
      status: 'mapped',
      selectionLength: selection.text?.length || end - start,
      matchedAnchors: highlight?.matchedAnchors || 2,
      sourceStart: start,
      sourceEnd: end,
      exactMapping: true,
      mappingMode: 'dom-source',
      mappingCoverage: coverage,
      sourceViewportRatio,
      targetViewportRatio: sourceViewportRatio
    };
  }

  notifyPreviewMounted(reason = 'preview-mounted') {
    if (this.destroyed) return;
    this.feedbackGuard.advanceRevision();
    this.highlightSession.restore();
    if (this.feedbackGuard.shouldIgnore('preview', { allowSource: true })) return;
    const editorSelection = this.editorSelectionReader.read();
    if (!editorSelection || editorSelection.isCollapsed) return;
    this.stats.previewRefreshes += 1;
    const shouldRealign = this.now() < this.editorAlignmentUntil;
    this.scheduleEditor(shouldRealign, reason, { force: true, frames: 1, extendAlignment: false });
  }

  notifyPreviewReplaced(reason = 'preview-replaced') {
    this.notifyPreviewMounted(reason);
  }

  notifyEditorGeometry(reason = 'editor-geometry') {
    if (this.destroyed || this.feedbackGuard.shouldIgnore('editor')) return;
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
    if (this.destroyed) return;
    this.lastEditorKey = '';
    this.lastPreviewKey = '';
    this.retryScheduler.cancel();
    this.highlightSession.clear();
  }

  recordResult(direction, reason, result = {}) {
    const status = result?.status || 'unknown';
    if (status === 'hybrid' || status === 'cleared' || status === 'locked' || status === 'destroyed') return;
    const details = {
      direction,
      reason,
      result: status,
      selectionLength: Number(result?.selectionLength) || 0,
      matchedAnchors: Number(result?.matchedAnchors) || 0,
      virtualized: Boolean(this.getPreviewVirtual()?.active),
      previewRevision: this.feedbackGuard.getRevision(),
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
