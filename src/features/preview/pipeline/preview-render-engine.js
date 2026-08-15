import { normalizePreviewModeSetting, resolvePreviewMode } from './preview-mode-resolver.js';
import { PREVIEW_BEHAVIOR_THRESHOLDS } from './preview-thresholds.js';

function safeError(error, source) {
  return Object.freeze({
    name: error?.name || 'Error',
    message: error?.message || String(error),
    source
  });
}

function collectPendingMermaidRoots(body) {
  if (!(body instanceof Element)) return [];
  const roots = [];
  const seen = new Set();
  body.querySelectorAll('pre > code.language-mermaid').forEach(code => {
    const pre = code.closest('pre');
    if (!(pre instanceof HTMLPreElement) || pre.dataset.mermaidRendering === 'true' || seen.has(pre)) return;
    seen.add(pre);
    roots.push(pre);
  });
  return roots;
}

/**
 * Responsibility: Execute one canonical Preview render cycle across model/Worker, render coordinator, DOM renderer and virtual window.
 * State/side effects: Owns only Worker client, virtual controller, render theme and prewarm generation. PreviewState remains authoritative.
 * Lifecycle: reset() invalidates transient pipeline state; destroy() tears down every owned runtime resource.
 */
export function createPreviewRenderEngine(options = {}) {
  const {
    root,
    editor,
    documentModel,
    documentSession,
    outline,
    state,
    scheduler,
    renderCoordinator,
    renderer,
    enhancementCoordinator,
    recoveryView,
    markdownRenderer,
    createWorkerClient,
    createVirtualController,
    backgroundScheduler,
    shell,
    layoutState,
    selectionController,
    scrollController,
    notify,
    record,
    diagnostic,
    now
  } = options;
  if (!root || !editor || !documentModel || !state || !scheduler || !renderCoordinator || !renderer || !enhancementCoordinator || !recoveryView || !markdownRenderer) {
    throw new TypeError('Preview Render Engine requires canonical Preview dependencies.');
  }
  if (typeof createWorkerClient !== 'function' || typeof createVirtualController !== 'function') {
    throw new TypeError('Preview Render Engine requires Worker and virtual controller factories.');
  }
  const clock = typeof now === 'function' ? now : () => performance.now();
  const emit = typeof record === 'function' ? record : () => {};
  const diagnose = typeof diagnostic === 'function' ? diagnostic : () => {};
  const show = typeof notify === 'function' ? notify : () => {};
  const thresholds = PREVIEW_BEHAVIOR_THRESHOLDS;
  let workerClient = null;
  let virtualController = null;
  let renderTheme = '';
  let prewarmVersion = 0;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Preview Render Engine is destroyed.');
  };
  const performanceMode = () => shell.getPreviewPerformanceMode?.() || 'auto';
  const hybridMode = () => layoutState?.snapshot?.mode === 'hybrid';

  function getWorkerClient() {
    if (!workerClient) workerClient = createWorkerClient();
    return workerClient;
  }

  function getHeightCacheVisualKey() {
    const theme = root.ownerDocument?.body?.getAttribute('data-theme') || 'light';
    const widthBucket = Math.max(1, Math.round((root.clientWidth || 800) / 80));
    return `${theme}:${shell.getEditorFontSize?.() || 16}:${widthBucket}`;
  }

  function getVirtualController() {
    if (!virtualController) {
      virtualController = createVirtualController(root, {
        scheduler: backgroundScheduler,
        selectionController,
        scrollController,
        storage: root.ownerDocument?.defaultView?.localStorage,
        invalidateAnchorMetrics: () => shell.invalidatePreviewAnchorMetrics?.(),
        reportError: (message, error) => console.debug(message, error?.message || error)
      });
      virtualController.setCacheContext?.(documentSession?.activeId, getHeightCacheVisualKey());
    }
    return virtualController;
  }

  function prewarmBlocks(ids) {
    const client = workerClient;
    const controller = virtualController;
    if (!client || !controller?.active || !Array.isArray(ids) || !ids.length) return;
    const requestVersion = ++prewarmVersion;
    const started = clock();
    const run = async ({ signal } = {}) => {
      if (signal?.aborted || requestVersion !== prewarmVersion || !controller.active) return;
      try {
        const result = await client.prewarmBlocks(ids);
        if (signal?.aborted || result?.cancelled || requestVersion !== prewarmVersion || !controller.active) return;
        controller.applyRenderedBlocks(result.renderedBlocks || []);
        emit('render.preview-prewarm', {
          category: 'render.pipeline',
          durationMs: clock() - started,
          aggregate: true,
          details: {
            requestedBlocks: ids.length,
            renderedBlocks: result.renderedBlocks?.length || 0,
            workerDurationMs: result.workerDurationMs || 0,
            schedulerPending: backgroundScheduler?.getStats?.().pending || 0
          }
        });
      } catch (error) {
        if (!signal?.aborted) console.debug('Preview prewarm skipped:', error?.message || error);
      }
    };
    if (backgroundScheduler?.schedule) {
      backgroundScheduler.schedule('preview-prewarm', run, {
        priority: 'idle',
        timeout: thresholds.scheduling.prewarmTimeoutMs
      });
    } else {
      void run();
    }
  }

  function deactivateVirtual({ clear = true } = {}) {
    if (!virtualController?.active) return false;
    virtualController.deactivate();
    if (clear) root.replaceChildren();
    shell.invalidatePreviewAnchorStructure?.();
    return true;
  }

  function commitDomPatch(result) {
    shell.invalidatePreviewAnchorStructure?.();
    return result;
  }

  function enhanceNodes(nodes, changedNodes = nodes) {
    if (!nodes?.length) return;
    enhancementCoordinator.enqueue(nodes, changedNodes || []);
  }

  function animateChanges(nodes) {
    const body = root.ownerDocument?.body;
    const maxAnimatedNodes = body?.classList.contains('ultra-large-document') ? 8 : 32;
    if (!nodes?.length || nodes.length > maxAnimatedNodes) return;
    nodes.forEach(node => {
      node.classList.add('preview-block-enter');
      node.addEventListener('animationend', () => node.classList.remove('preview-block-enter'), { once: true });
    });
  }

  function scheduleEnhancements(sourceText, blockTokens, renderVersion, sourceAlreadyAnnotated, sourceLength) {
    enhancementCoordinator.schedulePostprocess({
      renderVersion,
      run() {
        if (!state.isCurrentVersion(renderVersion)) return;
        const started = clock();
        if (!sourceAlreadyAnnotated) shell.annotatePreviewSourceLines?.(sourceText, blockTokens);
        else shell.refreshPreviewAnchorStructure?.();
        emit('render.preview-annotation', {
          category: 'render.pipeline',
          durationMs: clock() - started,
          aggregate: true,
          details: {
            sourceChars: sourceLength,
            previewBlocks: root.querySelector('.markdown-body')?.children.length || 0,
            anchors: shell.getPreviewAnchorCount?.() || 0
          }
        });
      },
      finish() {
        if (!state.isCurrentVersion(renderVersion)) return;
        const started = clock();
        selectionController?.notifyPreviewMounted?.('preview-enhancements');
        shell.getPreviewAnchorMetrics?.();
        emit('render.preview-enhancements', {
          category: 'render.pipeline',
          durationMs: clock() - started,
          aggregate: true,
          details: {
            sourceChars: sourceLength,
            previewBlocks: root.querySelector('.markdown-body')?.children.length || 0,
            anchors: shell.getPreviewAnchorCount?.() || 0
          }
        });
      },
      deferFinish: sourceLength >= thresholds.scheduling.postprocess.deferChars
    });
  }

  async function update() {
    assertActive();
    scheduler.cancel('input');
    const renderVersion = state.beginRender();
    enhancementCoordinator.begin(renderVersion);
    let resolvedMode = state.snapshot.mode;
    let resolvedScopeKey = state.snapshot.lastStableResult?.scopeKey || resolvedMode;
    let previewFailure = null;
    const sourceLength = Math.max(
      Number(documentModel.getTextLength?.()) || 0,
      Number(editor.virtualEditor?.getTextLength?.()) || 0,
      Number(editor.textLength) || 0
    );
    let sourceText = null;
    const getSourceText = () => {
      if (sourceText === null) sourceText = documentModel.createSnapshot?.('preview-full-source') ?? editor.value;
      return sourceText;
    };
    shell.preparePreviewEditorMetrics?.();

    const currentTheme = root.ownerDocument?.body?.getAttribute('data-theme') || 'light';
    const forceFullRebuild = renderTheme !== '' && renderTheme !== currentTheme;
    renderTheme = currentTheme;
    const renderStarted = clock();
    let patchResult = null;
    let blockTokens = [];
    let sourceAlreadyAnnotated = false;
    let skipEnhancements = false;
    let workerDurationMs = 0;
    let modelResult = null;
    let workerFailed = false;
    const requestedMode = normalizePreviewModeSetting(performanceMode());
    const hybrid = hybridMode();
    const useWorker = hybrid
      || sourceLength >= thresholds.mode.workerChars
      || requestedMode === 'virtual'
      || requestedMode === 'chapter';

    try {
      if (useWorker) {
        modelResult = await getWorkerClient().update(documentModel || editor, getSourceText, forceFullRebuild, { indexOnly: hybrid });
        if (modelResult?.cancelled || !state.isCurrentVersion(renderVersion)) return;
        workerDurationMs = modelResult.workerDurationMs || 0;
        blockTokens = modelResult.tokens || [];
        markdownRenderer.resetIncremental();
      } else {
        modelResult = markdownRenderer.updateIncremental(getSourceText(), { forceFull: forceFullRebuild });
        blockTokens = modelResult.tokens || [];
      }

      if (modelResult) {
        markdownRenderer.setReferenceDefinitions(modelResult.referenceDefinitions);
        const focusSection = modelResult.focusChapter || null;
        state.setFocusSection(renderVersion, focusSection);
        enhancementCoordinator.setPriorityRange(focusSection);
        shell.updateDocumentStatistics?.(modelResult.statistics);
        const headingVersion = modelResult.documentVersion ?? documentModel.getDocumentVersion?.() ?? editor.virtualEditor?.getDocumentVersion?.();
        const outlineDocumentKey = documentSession?.activeId || '';
        if (Array.isArray(modelResult.headings)) {
          const outlineUpdate = outline?.replaceIndex?.(modelResult.headings, {
            version: headingVersion,
            documentKey: outlineDocumentKey,
            changedHint: modelResult.headingIndexChanged,
            reason: 'preview-worker-index'
          });
          if (outlineUpdate?.accepted && outlineUpdate.changed) shell.persistCurrentDocumentIndex?.(modelResult.headings, modelResult.statistics);
        } else if (Array.isArray(modelResult.blocks)) {
          outline?.replacePreviewBlocks?.(modelResult.blocks, {
            version: headingVersion,
            documentKey: outlineDocumentKey,
            reason: 'preview-model-index'
          });
        }

        const indexedSourceLength = Number(modelResult.statistics?.characters) || 0;
        const previousState = state.snapshot;
        const previousScopeKey = previousState.lastStableResult?.scopeKey || previousState.mode;
        const renderPlan = renderCoordinator.createPlan({
          modelResult,
          sourceLength: Math.max(sourceLength, indexedSourceLength),
          previewPerformanceMode: performanceMode(),
          previousMode: previousState.mode,
          previousScopeKey,
          forceFullRebuild
        });
        resolvedMode = renderPlan.mode;
        resolvedScopeKey = renderPlan.scopeKey;
        if (renderPlan.scopeChanged && resolvedMode === 'chapter' && previousScopeKey && previousScopeKey !== resolvedScopeKey) {
          scrollController?.markProgrammaticScroll?.('preview', 420);
          scrollController?.suspend?.(320);
          root.scrollTop = 0;
        }

        const mountVirtual = (result, scope, forceRender) => {
          const controller = getVirtualController();
          controller.setCacheContext?.(documentSession?.activeId, getHeightCacheVisualKey());
          const mounted = controller.update(result, {
            forceAll: forceRender,
            scope,
            createNodes: block => renderer.createBlockNodes(block, source => markdownRenderer.renderFragment(source)),
            applySourceRange: (nodes, block) => renderer.applyBlockSourceRange(nodes, block),
            onNodesMounted(nodes, mountInfo) {
              enhanceNodes(nodes, mountInfo.changedNodes);
              shell.invalidatePreviewAnchorMetrics?.();
            },
            onPrewarmNeeded: prewarmBlocks
          });
          sourceAlreadyAnnotated = true;
          return mounted;
        };

        patchResult = renderCoordinator.execute(renderPlan, {
          reuseStable({ renderResult }) {
            virtualController?.refreshRenderData?.(renderResult);
            const body = root.querySelector('.markdown-body');
            const target = recoveryView.inspect();
            if (!state.snapshot.lastStableResult || !body || target.recovery) return null;
            const pending = collectPendingMermaidRoots(body);
            sourceAlreadyAnnotated = true;
            skipEnhancements = pending.length === 0;
            return {
              body,
              changedNodes: pending,
              reused: virtualController?.active ? virtualController.getStats().mountedBlocks : body.children.length,
              parsedChars: 0,
              mode: pending.length ? 'unchanged-enhancement-retry' : 'unchanged',
              virtualized: Boolean(virtualController?.active),
              blockCount: renderResult.blocks?.length || 0
            };
          },
          renderWholeDocument({ renderResult, forceRender }) {
            deactivateVirtual();
            const rendered = commitDomPatch(renderer.patchHtml(renderResult.wholeHtml, { forceFullRebuild: forceRender }));
            rendered.parsedChars = renderResult.parsedChars;
            rendered.mode = 'worker-whole-document';
            rendered.blockCount = renderResult.blocks?.length || rendered.body.children.length;
            return rendered;
          },
          mountVirtual({ renderResult, forceRender }) {
            return mountVirtual(renderResult, 'virtual', forceRender);
          },
          mountChapter({ renderResult, forceRender }) {
            const rendered = mountVirtual(renderResult, 'chapter', forceRender);
            rendered.mode = 'worker-chapter-preview';
            return rendered;
          },
          renderIncremental({ renderResult, forceRender }) {
            deactivateVirtual();
            const rendered = commitDomPatch(renderer.patchBlocks(renderResult, {
              forceAll: forceRender,
              renderFallback: source => markdownRenderer.renderFragment(source)
            }));
            rendered.blockCount = renderResult.blocks?.length || 0;
            sourceAlreadyAnnotated = true;
            return rendered;
          }
        });
      }
    } catch (error) {
      console.warn('Incremental preview fallback:', error);
      diagnose(hybrid ? 'hybrid.preview-index-failure' : 'preview.pipeline-failure', {
        category: hybrid ? 'editor.hybrid' : 'render.pipeline',
        status: 'error',
        dedupeKey: `${hybrid ? 'hybrid.preview-index-failure' : 'preview.pipeline-failure'}:${error?.name || 'Error'}`,
        minIntervalMs: 5000,
        details: { message: error?.message || String(error), sourceChars: sourceLength, requestedPreviewMode: requestedMode, useWorker, renderVersion }
      });
      markdownRenderer.resetIncremental();
      workerClient?.destroy?.();
      workerClient = null;
      workerFailed = useWorker;
      previewFailure = safeError(error, workerFailed ? 'worker' : 'pipeline');
      if (workerFailed && state.snapshot.error?.source !== 'worker') show('后台预览暂时不可用，已启用安全降级');
    }

    if (!state.isCurrentVersion(renderVersion)) return;

    if (hybrid) {
      enhancementCoordinator.cancel();
      root.ownerDocument.body.dataset.previewPerformanceMode = 'hybrid';
      if (workerFailed) {
        state.commitDegraded(renderVersion, { mode: 'hybrid', error: previewFailure });
        state.invalidate({ mode: 'hybrid', status: 'suspended', clearStable: false, clearError: false });
      } else {
        state.invalidate({ mode: 'hybrid', status: 'suspended', clearStable: false, clearError: true });
      }
      emit('render.preview-index-only', {
        category: 'render.pipeline',
        durationMs: clock() - renderStarted,
        aggregate: true,
        details: { sourceChars: sourceLength, blocks: modelResult?.blocks?.length || 0, workerDurationMs, mode: 'hybrid-index-only' }
      });
      return;
    }

    if (!patchResult && workerFailed) {
      const lastStable = state.snapshot.lastStableResult;
      const target = recoveryView.inspect();
      const preserveStable = Boolean(lastStable && target.present && !target.recovery);
      if (!preserveStable) deactivateVirtual();
      const recovery = recoveryView.recover({ preserveStable });
      const body = recovery.body;
      patchResult = {
        body,
        changedNodes: [],
        reused: recovery.preserved ? (virtualController?.active ? virtualController.getStats().mountedBlocks : body.children.length) : 0,
        parsedChars: 0,
        mode: recovery.preserved ? 'worker-safe-fallback-stale' : 'worker-safe-fallback-paused',
        virtualized: recovery.preserved && Boolean(virtualController?.active),
        blockCount: recovery.preserved ? (virtualController?.getStats?.().blocks || body.children.length) : 0
      };
      resolvedMode = resolvePreviewMode({ previewPerformanceMode: performanceMode() }, sourceLength, patchResult.blockCount);
      resolvedScopeKey = lastStable?.scopeKey || resolvedMode;
      sourceAlreadyAnnotated = true;
      skipEnhancements = true;
    }

    if (!patchResult && !workerFailed) {
      const lastStable = state.snapshot.lastStableResult;
      const before = recoveryView.inspect();
      const hadStable = Boolean(lastStable && before.present && !before.recovery);
      try {
        deactivateVirtual();
        resolvedMode = 'full';
        resolvedScopeKey = 'full';
        const fallback = markdownRenderer.renderWhole(getSourceText());
        blockTokens = fallback.tokens;
        patchResult = commitDomPatch(renderer.patchHtml(fallback.html, { forceFullRebuild }));
        patchResult.parsedChars = sourceLength;
        patchResult.mode = 'whole-document';
        patchResult.blockCount = patchResult.body.children.length;
        previewFailure = null;
      } catch (error) {
        previewFailure = safeError(error, 'render');
        const target = recoveryView.inspect();
        const preserveStable = Boolean(hadStable && target.present && !target.recovery);
        const recovery = recoveryView.recover({ preserveStable });
        patchResult = {
          body: recovery.body,
          changedNodes: [],
          reused: recovery.preserved ? recovery.body.children.length : 0,
          parsedChars: 0,
          mode: recovery.preserved ? 'render-safe-fallback-stale' : 'render-safe-fallback-paused',
          virtualized: false,
          blockCount: recovery.preserved ? recovery.body.children.length : 0
        };
        resolvedMode = state.snapshot.mode || 'full';
        resolvedScopeKey = lastStable?.scopeKey || resolvedMode;
        sourceAlreadyAnnotated = true;
        skipEnhancements = true;
      }
    }

    const retryEnhancements = patchResult.mode === 'unchanged-enhancement-retry';
    if (!patchResult.virtualized || retryEnhancements) {
      enhanceNodes(patchResult.changedNodes, patchResult.changedNodes);
      if (!patchResult.virtualized) selectionController?.notifyPreviewReplaced?.('preview-dom-patch');
    }
    if (!skipEnhancements) {
      shell.invalidatePreviewAnchorStructure?.();
      shell.refreshPreviewAnchorStructure?.();
      scheduleEnhancements(sourceText || '', blockTokens, renderVersion, sourceAlreadyAnnotated, sourceLength);
    }

    const virtualStats = virtualController?.active ? virtualController.getStats() : null;
    const stableBlockCount = patchResult.blockCount ?? patchResult.body.children.length;
    const stableMountedBlocks = virtualStats?.mountedBlocks ?? patchResult.body.children.length;
    const stableMetadata = {
      scopeKey: resolvedScopeKey || resolvedMode,
      renderMode: patchResult.mode || 'dom-keyed',
      sourceLength,
      blockCount: stableBlockCount,
      mountedBlocks: stableMountedBlocks,
      documentVersion: documentModel.getDocumentVersion?.() ?? editor.virtualEditor?.getDocumentVersion?.() ?? 0
    };
    if (workerFailed) {
      state.commitDegraded(renderVersion, { mode: resolvedMode, error: previewFailure });
    } else if (previewFailure) {
      if (patchResult.mode === 'render-safe-fallback-stale') state.commitDegraded(renderVersion, { mode: resolvedMode, error: previewFailure });
      else state.failRender(renderVersion, { mode: resolvedMode, error: previewFailure });
    } else {
      state.commitStable(renderVersion, {
        mode: resolvedMode,
        result: stableMetadata,
        clearError: useWorker || state.snapshot.error?.source !== 'worker'
      });
    }
    shell.updatePreviewStrategyBadge?.(resolvedMode, { blockCount: stableBlockCount, mountedBlocks: stableMountedBlocks });
    emit('render.preview-patch', {
      category: 'render.pipeline',
      durationMs: clock() - renderStarted,
      aggregate: true,
      details: {
        blocks: stableBlockCount,
        mountedBlocks: stableMountedBlocks,
        changed: patchResult.changedNodes.length,
        reused: patchResult.reused,
        parsedChars: patchResult.parsedChars ?? sourceLength,
        workerDurationMs,
        enhancementJobs: enhancementCoordinator.getStats().pending || 0,
        virtualized: Boolean(patchResult.virtualized),
        mode: patchResult.mode || 'dom-keyed',
        requestedPreviewMode: requestedMode,
        resolvedPreviewMode: resolvedMode
      }
    });
    return patchResult;
  }

  async function reset() {
    assertActive();
    scheduler.cancelAll();
    state.invalidate({ mode: 'full', status: 'idle', clearStable: true, clearError: true, focusSection: null });
    prewarmVersion += 1;
    backgroundScheduler?.cancelPrefix?.('preview-');
    markdownRenderer.resetIncremental();
    workerClient?.destroy?.();
    workerClient = null;
    virtualController?.deactivate?.();
    enhancementCoordinator.cancel();
    root.replaceChildren();
    shell.invalidatePreviewAnchorStructure?.();
    return update();
  }

  return Object.freeze({
    update,
    reset,
    deactivateVirtual,
    getVirtualStats: () => virtualController?.getStats?.() || null,
    isVirtualActive: () => Boolean(virtualController?.active),
    containsVirtualLine: line => Boolean(virtualController?.containsLineRange?.(line, line)),
    containsVirtualLineRange: (from, to) => Boolean(virtualController?.containsLineRange?.(from, to)),
    hasVirtualLineRangeMounted: (from, to) => Boolean(virtualController?.hasLineRangeMounted?.(from, to)),
    ensureVirtualLineVisible: line => virtualController?.ensureLineVisible?.(line) || null,
    ensureVirtualLineRangeVisible: (from, to) => virtualController?.ensureLineRangeVisible?.(from, to) || null,
    getVirtualMountedAnchors: () => virtualController?.getMountedAnchors?.() || [],
    getVirtualMetrics: () => virtualController?.getMetrics?.() || [],
    getVirtualContentYForLine: line => virtualController?.getContentYForLine?.(line) ?? null,
    getVirtualLineForContentY: y => virtualController?.getLineForContentY?.(y) ?? null,
    refreshVirtualViewport: optionsValue => virtualController?.refreshViewport?.(optionsValue),
    scheduleVirtualMeasure: () => virtualController?.scheduleMeasure?.(),
    animateChanges,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      prewarmVersion += 1;
      backgroundScheduler?.cancelPrefix?.('preview-');
      workerClient?.destroy?.();
      workerClient = null;
      virtualController?.destroy?.();
      virtualController = null;
      markdownRenderer.destroy();
    }
  });
}
