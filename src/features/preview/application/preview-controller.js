import { PREVIEW_BEHAVIOR_THRESHOLDS } from '../pipeline/preview-thresholds.js';

/**
 * Responsibility: Own Preview application lifecycle and user-facing commands while delegating render execution to PreviewRenderEngine.
 * State/side effects: Owns only right-pane view mode and count timer; PreviewState/render/virtual state stay in their dedicated owners.
 * Lifecycle: start() is idempotent; destroy() cancels controller work and destroys its render engine.
 */
export function createPreviewController(options = {}) {
  const {
    root,
    editor,
    documentModel,
    layoutState,
    state,
    scheduler,
    layoutStability,
    focusController,
    enhancementCoordinator,
    renderer,
    recoveryView,
    renderEngine,
    presentation,
    shell,
    scrollController,
    storage,
    thresholds = PREVIEW_BEHAVIOR_THRESHOLDS
  } = options;
  if (!root || !editor || !documentModel || !layoutState || !state || !scheduler || !layoutStability || !focusController || !enhancementCoordinator || !renderer || !recoveryView || !renderEngine || !presentation) {
    throw new TypeError('Preview Controller requires canonical Preview dependencies.');
  }
  let started = false;
  let destroyed = false;
  let countTimer = 0;
  let viewMode = 'preview';
  const runtime = root.ownerDocument?.defaultView || globalThis;
  const assertActive = () => {
    if (destroyed) throw new Error('Preview Controller is destroyed.');
  };
  const isHybrid = () => layoutState.snapshot.mode === 'hybrid';

  const update = () => {
    assertActive();
    return renderEngine.update();
  };

  layoutStability.connect({
    isSuspended: isHybrid,
    hasStablePreview: () => Boolean(state.snapshot.lastStableResult),
    inspectRenderTarget() {
      const target = recoveryView.inspect();
      return { present: target.present, loading: target.recovery, empty: target.empty };
    },
    render: update,
    refreshViewport: () => renderEngine.refreshVirtualViewport({ forceWindow: true }),
    invalidateGeometry: () => shell.invalidatePreviewAnchorMetrics?.(),
    notifyGeometryChanged: reason => scrollController?.notifyGeometryChanged?.(reason),
    getStats() {
      const virtual = renderEngine.getVirtualStats();
      return {
        previewBlocks: virtual?.blocks || root.querySelector('.markdown-body')?.children.length || 0,
        mountedBlocks: virtual?.mountedBlocks || 0
      };
    }
  });

  focusController.connect({
    isSuspended: isHybrid,
    isCursorTrackingEligible: () => Boolean(
      editor.virtualEditor
      && (editor.textLength >= thresholds.mode.workerChars || shell.getPreviewPerformanceMode?.() === 'chapter')
    ),
    getFocusSection: () => state.snapshot.focusSection,
    getMode: () => state.snapshot.mode,
    isVirtualWindowActive: () => renderEngine.isVirtualActive(),
    virtualWindowContainsLine: line => renderEngine.containsVirtualLine(line),
    refreshPreview: update,
    ensureLineVisible: line => renderEngine.ensureVirtualLineVisible(line),
    invalidateAnchors: () => shell.invalidatePreviewAnchorStructure?.(),
    scrollToLine: (line, behavior, viewportRatio) => shell.scrollPreviewToLine?.(line, behavior, viewportRatio)
  });

  enhancementCoordinator.connect({
    getLineRange(node) {
      const anchor = node?.closest?.('[data-source-line]') || node;
      const start = Number(anchor?.dataset?.sourceLine);
      const end = Number(anchor?.dataset?.sourceEndLine);
      return { start: Number.isFinite(start) ? start : 1, end: Number.isFinite(end) ? end : (Number.isFinite(start) ? start : 1) };
    },
    getPriority(node, lineRange) {
      const anchor = node?.closest?.('.preview-virtual-block') || node;
      if (anchor?.isConnected) {
        const top = anchor.offsetTop;
        const bottom = top + Math.max(1, anchor.offsetHeight);
        const viewportTop = root.scrollTop;
        const viewportBottom = viewportTop + root.clientHeight;
        if (bottom >= viewportTop && top <= viewportBottom) return 0;
      }
      const chapter = state.snapshot.focusSection;
      if (chapter && lineRange.end >= chapter.startLine && lineRange.start <= chapter.endLine) return 1;
      return 2;
    },
    hasMath: node => presentation.math.containsMath(node?.textContent || ''),
    hasMermaid: node => Boolean(
      (node?.matches?.('pre') && node.querySelector?.('code.language-mermaid'))
      || node?.querySelector?.('pre code.language-mermaid')
    ),
    isConnected: node => Boolean(node?.isConnected),
    styleRoots(roots) {
      renderer.renderTaskLists(roots);
      renderer.renderCode(roots);
    },
    renderMath: roots => renderer.renderMath(roots),
    renderMermaid: (roots, isCancelled) => renderer.renderMermaid(roots, isCancelled),
    animate: roots => renderEngine.animateChanges(roots),
    onBatchComplete() {
      shell.invalidatePreviewAnchorMetrics?.();
      renderEngine.scheduleVirtualMeasure();
    },
    isVersionCurrent: version => state.isCurrentVersion(version)
  });

  function start() {
    assertActive();
    if (started) return false;
    started = true;
    layoutStability.start();
    return true;
  }

  function scheduleUpdate() {
    assertActive();
    const length = editor.textLength;
    const input = thresholds.scheduling.input;
    const delay = length >= thresholds.mode.virtualChars
      ? input.virtualMs
      : length >= thresholds.mode.workerChars
        ? input.workerMs
        : length >= input.mediumChars
          ? input.mediumMs
          : input.defaultMs;
    return scheduler.schedule('input', update, { kind: 'timeout', delay });
  }

  function scheduleFocusUpdate() {
    assertActive();
    if (!editor.virtualEditor) return false;
    const line = editor.virtualEditor.getLineNumberAtPosition?.(editor.selectionStart || 0) || 1;
    return focusController.scheduleCursorFocus(line);
  }

  function suspendForHybridMode() {
    assertActive();
    scheduler.cancel('input');
    focusController.cancel();
    layoutStability.cancel();
    const version = state.invalidate({ mode: 'hybrid', status: 'suspended', clearStable: false, clearError: false });
    enhancementCoordinator.begin(version);
    if (!renderEngine.isVirtualActive()) root.replaceChildren();
    shell.invalidatePreviewAnchorStructure?.();
    const badge = root.ownerDocument?.getElementById('preview-strategy-badge');
    if (badge) badge.hidden = true;
    root.ownerDocument.body.dataset.previewPerformanceMode = 'hybrid';
    return true;
  }

  function updateCount() {
    assertActive();
    if (countTimer) runtime.clearTimeout(countTimer);
    countTimer = 0;
    const count = documentModel.getNonWhitespaceCount?.()
      ?? editor.virtualEditor?.getNonWhitespaceCount?.()
      ?? String(editor.value || '').replace(/\s/g, '').length;
    const wordCount = root.ownerDocument?.getElementById('word-count');
    if (wordCount) wordCount.textContent = shell.translate?.('wordCount', count) || `字数: ${count}`;
    return count;
  }

  function scheduleCountUpdate() {
    assertActive();
    if (countTimer) runtime.clearTimeout(countTimer);
    countTimer = runtime.setTimeout(updateCount, editor.textLength >= 50000 ? 140 : 40);
    return countTimer;
  }

  function setViewMode(_mode, skipRefresh = false) {
    assertActive();
    viewMode = 'preview';
    storage?.setItem?.('md_editor_preview_mode', viewMode);
    root.hidden = false;
    if (!skipRefresh) {
      void update();
      updateCount();
      shell.requestAutoSave?.();
    }
    return viewMode;
  }

  return Object.freeze({
    start,
    update,
    scheduleUpdate,
    scheduleFocusUpdate,
    reset: () => { assertActive(); return renderEngine.reset(); },
    updateCount,
    scheduleCountUpdate,
    setViewMode,
    getViewMode: () => { assertActive(); return viewMode; },
    getStateSnapshot: () => { assertActive(); return state.snapshot; },
    suspendForHybridMode,
    deactivateVirtual: () => { assertActive(); return renderEngine.deactivateVirtual(); },
    getVirtualStats: () => { assertActive(); return renderEngine.getVirtualStats(); },
    isVirtualActive: () => { assertActive(); return renderEngine.isVirtualActive(); },
    containsVirtualLine: line => { assertActive(); return renderEngine.containsVirtualLine(line); },
    containsVirtualLineRange: (from, to) => { assertActive(); return renderEngine.containsVirtualLineRange(from, to); },
    hasVirtualLineRangeMounted: (from, to) => { assertActive(); return renderEngine.hasVirtualLineRangeMounted(from, to); },
    ensureVirtualLineVisible: line => { assertActive(); return renderEngine.ensureVirtualLineVisible(line); },
    ensureVirtualLineRangeVisible: (from, to) => { assertActive(); return renderEngine.ensureVirtualLineRangeVisible(from, to); },
    getVirtualMountedAnchors: () => { assertActive(); return renderEngine.getVirtualMountedAnchors(); },
    getVirtualMetrics: () => { assertActive(); return renderEngine.getVirtualMetrics(); },
    getVirtualContentYForLine: line => { assertActive(); return renderEngine.getVirtualContentYForLine(line); },
    getVirtualLineForContentY: y => { assertActive(); return renderEngine.getVirtualLineForContentY(y); },
    requestLayoutRefresh: optionsValue => { assertActive(); return layoutStability.requestRefresh(optionsValue); },
    focusLine: (line, optionsValue) => { assertActive(); return focusController.focusLine(line, optionsValue); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (countTimer) runtime.clearTimeout(countTimer);
      countTimer = 0;
      renderEngine.destroy();
    }
  });
}
