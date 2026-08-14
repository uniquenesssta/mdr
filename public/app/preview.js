    const previewCompatibilityHost = document.getElementById('compatibility-business-ports');
    const previewDocumentSessionPort = previewCompatibilityHost?.markdownEditorDocumentSessionPort;
    const previewLayoutStatePort = previewCompatibilityHost?.markdownEditorLayoutStatePort;
    const previewSidebarControllerPort = previewCompatibilityHost?.markdownEditorSidebarControllerPort;
    const previewOutlineControllerPort = previewCompatibilityHost?.markdownEditorOutlineControllerPort;
    const previewEditorUiCommandPort = previewCompatibilityHost?.markdownEditorEditorUiCommandPort;
    const previewModeResolverPort = previewCompatibilityHost?.markdownEditorPreviewModeResolverPort;
    const previewThresholdsPort = previewCompatibilityHost?.markdownEditorPreviewThresholdsPort;
    const previewSchedulerPort = previewCompatibilityHost?.markdownEditorPreviewSchedulerPort;
    const previewRenderCoordinatorPort = previewCompatibilityHost?.markdownEditorPreviewRenderCoordinatorPort;
    const previewRendererPort = previewCompatibilityHost?.markdownEditorPreviewRendererPort;
    const previewLayoutStabilityPort = previewCompatibilityHost?.markdownEditorPreviewLayoutStabilityPort;
    const previewFocusControllerPort = previewCompatibilityHost?.markdownEditorPreviewFocusControllerPort;
    const previewEnhancementCoordinatorPort = previewCompatibilityHost?.markdownEditorPreviewEnhancementCoordinatorPort;
    const previewRecoveryViewPort = previewCompatibilityHost?.markdownEditorPreviewRecoveryViewPort;
    const classicPreviewStatePort = previewCompatibilityHost?.markdownEditorPreviewStatePort;
    if (!previewDocumentSessionPort) throw new Error('Document session compatibility port is unavailable.');
    if (!previewLayoutStatePort) throw new Error('Layout State compatibility port is unavailable.');
    if (!previewSidebarControllerPort) throw new Error('Sidebar controller compatibility port is unavailable.');
    if (!previewOutlineControllerPort) throw new Error('Outline controller compatibility port is unavailable.');
    if (!previewEditorUiCommandPort) throw new Error('Editor UI command compatibility port is unavailable.');
    if (!previewModeResolverPort) throw new Error('Preview Mode Resolver compatibility port is unavailable.');
    if (!previewThresholdsPort) throw new Error('Preview Thresholds compatibility port is unavailable.');
    if (!previewSchedulerPort) throw new Error('Preview Scheduler compatibility port is unavailable.');
    if (!previewRenderCoordinatorPort) throw new Error('Preview Render Coordinator compatibility port is unavailable.');
    if (!previewRendererPort) throw new Error('Preview Renderer compatibility port is unavailable.');
    if (!previewLayoutStabilityPort) throw new Error('Preview Layout Stability compatibility port is unavailable.');
    if (!previewFocusControllerPort) throw new Error('Preview Focus Controller compatibility port is unavailable.');
    if (!previewEnhancementCoordinatorPort) throw new Error('Preview Enhancement Coordinator compatibility port is unavailable.');
    if (!previewRecoveryViewPort) throw new Error('Preview Recovery View compatibility port is unavailable.');
    if (!classicPreviewStatePort) throw new Error('Preview State compatibility port is unavailable.');
    const classicPreviewBehaviorThresholds = previewThresholdsPort.snapshot;
    previewEditorUiCommandPort.register({
      focusPreviewLineForOutline: (line, options) => previewFocusControllerPort.focusLine(line, options)
    });
    function schedulePreviewUpdate() {
      const length = editor.textLength;
      const inputThresholds = classicPreviewBehaviorThresholds.scheduling.input;
      const delay = length >= classicPreviewBehaviorThresholds.mode.virtualChars
        ? inputThresholds.virtualMs
        : length >= classicPreviewBehaviorThresholds.mode.workerChars
          ? inputThresholds.workerMs
          : length >= inputThresholds.mediumChars
            ? inputThresholds.mediumMs
            : inputThresholds.defaultMs;
      previewSchedulerPort.schedule('input', () => updatePreview(), { kind: 'timeout', delay });
    }


    previewLayoutStabilityPort.connect({
      isSuspended: () => typeof isHybridLayoutMode === 'function' && isHybridLayoutMode(),
      hasStablePreview: () => Boolean(classicPreviewStatePort.snapshot.lastStableResult),
      inspectRenderTarget() {
        const target = previewRecoveryViewPort.inspect();
        return {
          present: target.present,
          loading: target.recovery,
          empty: target.empty
        };
      },
      render: () => updatePreview(),
      refreshViewport: () => virtualPreviewController?.refreshViewport?.({ forceWindow: true }),
      invalidateGeometry: () => invalidatePreviewAnchorMetrics(),
      notifyGeometryChanged: reason => window.markdownEditorScrollController?.notifyGeometryChanged?.(reason),
      getStats() {
        const virtualStats = virtualPreviewController?.getStats?.();
        return {
          previewBlocks: virtualStats?.blocks || preview.querySelector('.markdown-body')?.children.length || 0,
          mountedBlocks: virtualStats?.mountedBlocks || 0
        };
      }
    });


    previewFocusControllerPort.connect({
      isSuspended: () => typeof isHybridLayoutMode === 'function' && isHybridLayoutMode(),
      isCursorTrackingEligible: () => Boolean(
        editor.virtualEditor
        && (editor.textLength >= classicPreviewBehaviorThresholds.mode.workerChars || previewPerformanceMode === 'chapter')
      ),
      getFocusSection: () => classicPreviewStatePort.snapshot.focusSection,
      getMode: () => classicPreviewStatePort.snapshot.mode,
      isVirtualWindowActive: () => Boolean(window.markdownEditorVirtualPreview?.active),
      virtualWindowContainsLine: line => Boolean(
        window.markdownEditorVirtualPreview?.containsLineRange?.(line, line)
      ),
      refreshPreview: () => updatePreview(),
      ensureLineVisible: line => window.markdownEditorVirtualPreview?.ensureLineVisible?.(line) || null,
      invalidateAnchors: () => invalidatePreviewAnchorStructure(),
      scrollToLine: (line, behavior, viewportRatio) => scrollPreviewToLine(line, behavior, viewportRatio)
    });

    previewEnhancementCoordinatorPort.connect({
      getLineRange(root) {
        const anchor = root?.closest?.('[data-source-line]') || root;
        const start = Number(anchor?.dataset?.sourceLine);
        const end = Number(anchor?.dataset?.sourceEndLine);
        return {
          start: Number.isFinite(start) ? start : 1,
          end: Number.isFinite(end) ? end : (Number.isFinite(start) ? start : 1)
        };
      },
      getPriority(root, lineRange) {
        const anchor = root?.closest?.('.preview-virtual-block') || root;
        if (anchor?.isConnected) {
          const top = anchor.offsetTop;
          const bottom = top + Math.max(1, anchor.offsetHeight);
          const viewportTop = preview.scrollTop;
          const viewportBottom = viewportTop + preview.clientHeight;
          if (bottom >= viewportTop && top <= viewportBottom) return 0;
        }
        const chapter = classicPreviewStatePort.snapshot.focusSection;
        if (chapter && lineRange.end >= chapter.startLine && lineRange.start <= chapter.endLine) return 1;
        return 2;
      },
      hasMath: root => sourceContainsMath(root?.textContent || ''),
      hasMermaid: root => Boolean(
        root?.matches?.('pre') && root.querySelector?.('code.language-mermaid')
        || root?.querySelector?.('pre code.language-mermaid')
      ),
      isConnected: root => Boolean(root?.isConnected),
      styleRoots(roots) {
        previewRendererPort.renderTaskLists(roots);
        previewRendererPort.renderCode(roots);
      },
      renderMath: roots => previewRendererPort.renderMath(roots),
      renderMermaid: (roots, isCancelled) => previewRendererPort.renderMermaid(roots, isCancelled),
      animate: roots => animatePreviewChanges(roots),
      onBatchComplete() {
        invalidatePreviewAnchorMetrics();
        virtualPreviewController?.scheduleMeasure?.();
      },
      isVersionCurrent: version => classicPreviewStatePort.isCurrentVersion(version)
    });

    function schedulePreviewFocusUpdate() {
      if (!editor.virtualEditor) return;
      const line = editor.virtualEditor.getLineNumberAtPosition?.(editor.selectionStart || 0) || 1;
      previewFocusControllerPort.scheduleCursorFocus(line);
    }



    function suspendPreviewForHybridMode() {
      previewSchedulerPort.cancel('input');
      previewFocusControllerPort.cancel();
      previewLayoutStabilityPort.cancel();
      const suspendedVersion = classicPreviewStatePort.invalidate({
        mode: 'hybrid',
        status: 'suspended',
        clearStable: false,
        clearError: false
      });
      previewEnhancementCoordinatorPort.begin(suspendedVersion);
      // 单视图期间保留已窗口化的预览 DOM 与高度索引。
      // 重新切回双栏时可增量复用，避免百万字文档重新挂载全部块。
      if (!virtualPreviewController?.active) {
        preview.replaceChildren();
        observedPreviewBody = null;
      }
      previewAnchorsCache = [];
      previewAnchorMetricsCache = null;
      const badge = document.getElementById('preview-strategy-badge');
      if (badge) badge.hidden = true;
      document.body.dataset.previewPerformanceMode = 'hybrid';
    }

    function schedulePreviewEnhancements(sourceText, blockTokens, renderVersion, sourceAlreadyAnnotated = false, sourceLength = sourceText.length) {
      previewEnhancementCoordinatorPort.schedulePostprocess({
        renderVersion,
        run() {
          if (!classicPreviewStatePort.isCurrentVersion(renderVersion)) return;
          const annotationStarted = performance.now();
          if (!sourceAlreadyAnnotated) annotatePreviewSourceLines(sourceText, blockTokens);
          else {
            previewAnchorsCache = virtualPreviewController?.active
              ? virtualPreviewController.getMountedAnchors()
              : Array.from(preview.querySelectorAll('[data-source-line]'));
            observePreviewBodySize();
          }
          window.markdownEditorPerf?.record('render.preview-annotation', {
            category: 'render.pipeline',
            durationMs: performance.now() - annotationStarted,
            aggregate: true,
            details: {
              sourceChars: sourceLength,
              previewBlocks: preview.querySelector('.markdown-body')?.children.length || 0,
              anchors: previewAnchorsCache?.length || 0
            }
          });
        },
        finish() {
          if (!classicPreviewStatePort.isCurrentVersion(renderVersion)) return;
          const started = performance.now();
          window.markdownEditorSelectionController?.notifyPreviewMounted?.('preview-enhancements');
          getPreviewAnchorMetrics();
          window.markdownEditorPerf?.record('render.preview-enhancements', {
            category: 'render.pipeline',
            durationMs: performance.now() - started,
            aggregate: true,
            details: {
              sourceChars: sourceLength,
              previewBlocks: preview.querySelector('.markdown-body')?.children.length || 0,
              anchors: previewAnchorsCache?.length || 0
            }
          });
        },
        deferFinish: sourceLength >= classicPreviewBehaviorThresholds.scheduling.postprocess.deferChars
      });
    }

    function sourceContainsMath(value) {
      return window.markdownEditorMath?.containsMath?.(value)
        ?? (String(value || '').includes('$') || String(value || '').includes('\\[') || String(value || '').includes('\\('));
    }

    function commitPreviewDomPatch(result) {
      if (result?.bodyReplaced) observedPreviewBody = null;
      invalidatePreviewAnchorStructure();
      if (Array.isArray(result?.anchors)) previewAnchorsCache = result.anchors;
      return result;
    }


    let incrementalPreviewModel = null;
    let previewWorkerClient = null;
    let virtualPreviewController = null;

    function getPreviewWorkerClient() {
      if (!previewWorkerClient && window.createPreviewWorkerClient) {
        previewWorkerClient = window.createPreviewWorkerClient();
      }
      return previewWorkerClient;
    }

    function getPreviewHeightCacheVisualKey() {
      const theme = document.body.getAttribute('data-theme') || 'light';
      const widthBucket = Math.max(1, Math.round((preview.clientWidth || 800) / 80));
      return `${theme}:${editorFontSize}:${widthBucket}`;
    }

    function getVirtualPreviewController() {
      if (!virtualPreviewController && window.createVirtualPreviewController) {
        virtualPreviewController = window.createVirtualPreviewController(preview);
        virtualPreviewController.setCacheContext?.(previewDocumentSessionPort.activeId, getPreviewHeightCacheVisualKey());
        window.markdownEditorVirtualPreview = virtualPreviewController;
      }
      return virtualPreviewController;
    }

    let previewPrewarmVersion = 0;

    function prewarmPreviewBlocks(ids) {
      const client = previewWorkerClient;
      const controller = virtualPreviewController;
      if (!client || !controller?.active || !Array.isArray(ids) || !ids.length) return;
      const requestVersion = ++previewPrewarmVersion;
      const started = performance.now();
      const run = async ({ signal } = {}) => {
        if (signal?.aborted || requestVersion !== previewPrewarmVersion || !controller.active) return;
        try {
          const result = await client.prewarmBlocks(ids);
          if (signal?.aborted || result?.cancelled || requestVersion !== previewPrewarmVersion || !controller.active) return;
          controller.applyRenderedBlocks(result.renderedBlocks || []);
          window.markdownEditorPerf?.record('render.preview-prewarm', {
            category: 'render.pipeline',
            durationMs: performance.now() - started,
            aggregate: true,
            details: {
              requestedBlocks: ids.length,
              renderedBlocks: result.renderedBlocks?.length || 0,
              workerDurationMs: result.workerDurationMs || 0,
              schedulerPending: window.markdownEditorTaskScheduler?.getStats?.().pending || 0
            }
          });
        } catch (error) {
          if (!signal?.aborted) console.debug('Preview prewarm skipped:', error?.message || error);
        }
      };
      const scheduler = window.markdownEditorTaskScheduler;
      if (scheduler?.schedule) scheduler.schedule('preview-prewarm', run, {
        priority: 'idle',
        timeout: classicPreviewBehaviorThresholds.scheduling.prewarmTimeoutMs
      });
      else run();
    }

    function disableVirtualPreview() {
      if (!virtualPreviewController?.active) return;
      virtualPreviewController.deactivate();
      preview.replaceChildren();
      observedPreviewBody = null;
      invalidatePreviewAnchorStructure();
    }


    function resetPreviewPipeline() {
      previewSchedulerPort.cancelAll();
      previewFocusControllerPort.cancel();
      classicPreviewStatePort.invalidate({
        mode: 'full',
        status: 'idle',
        clearStable: true,
        clearError: true,
        focusSection: null
      });
      previewReferenceDefinitions = '';
      previewPrewarmVersion += 1;
      window.markdownEditorTaskScheduler?.cancelPrefix?.('preview-');
      incrementalPreviewModel?.reset();
      previewWorkerClient?.destroy?.();
      previewWorkerClient = null;
      virtualPreviewController?.deactivate();
      previewEnhancementCoordinatorPort.cancel();
      preview.replaceChildren();
      observedPreviewBody = null;
      invalidatePreviewAnchorStructure();
      return updatePreview();
    }

    function enhancePreviewNodes(nodes, changedNodes = nodes) {
      if (!nodes?.length) return;
      previewEnhancementCoordinatorPort.enqueue(nodes, changedNodes || []);
    }

    function collectPendingMermaidRoots(body) {
      if (!(body instanceof Element)) return [];
      const roots = [];
      const seen = new Set();
      body.querySelectorAll('pre > code.language-mermaid').forEach(code => {
        const pre = code.closest('pre');
        if (!(pre instanceof HTMLPreElement)
          || pre.dataset.mermaidRendering === 'true'
          || seen.has(pre)) return;
        seen.add(pre);
        roots.push(pre);
      });
      return roots;
    }

    function renderMarkdownFragment(source) {
      let text = source;
      let placeholders = [];
      const hasMath = Boolean(window.markdownEditorPresentation?.math?.renderTree || typeof renderMathInElement !== 'undefined') && sourceContainsMath(source);
      if (hasMath) {
        const protectedMath = protectMath(text);
        text = protectedMath.text;
        placeholders = protectedMath.placeholders;
      }
      let html = '';
      const renderSource = previewReferenceDefinitions ? previewReferenceDefinitions + '\n' + text : text;
      try {
        html = typeof marked !== 'undefined' ? marked.parse(renderSource) : '<pre class="f-raw-fallback">' + escapeHtml(source) + '</pre>';
      } catch (error) {
        console.error('Markdown block render error:', error);
        html = '<pre class="f-raw-fallback">' + escapeHtml(source) + '</pre>';
      }
      if (placeholders.length) html = restoreMath(html, placeholders);
      return html;
    }

    function animatePreviewChanges(nodes) {
      const maxAnimatedNodes = document.body.classList.contains('ultra-large-document') ? 8 : 32;
      if (!nodes.length || nodes.length > maxAnimatedNodes) return;
      nodes.forEach(node => {
        node.classList.add('preview-block-enter');
        node.addEventListener('animationend', () => node.classList.remove('preview-block-enter'), { once: true });
      });
    }

    async function updatePreview() {
      previewSchedulerPort.cancel('input');
      const renderVersion = classicPreviewStatePort.beginRender();
      previewEnhancementCoordinatorPort.begin(renderVersion);
      let resolvedPreviewMode = classicPreviewStatePort.snapshot.mode;
      let resolvedPreviewScopeKey = classicPreviewStatePort.snapshot.lastStableResult?.scopeKey || resolvedPreviewMode;
      let previewFailure = null;
      const sourceLength = Math.max(
        Number(documentModel?.getTextLength?.()) || 0,
        Number(editor.virtualEditor?.getTextLength?.()) || 0,
        Number(editor.textLength) || 0
      );
      let sourceText = null;
      const getSourceText = () => {
        if (sourceText === null) sourceText = documentModel?.createSnapshot?.('preview-full-source') ?? editor.value;
        return sourceText;
      };
      if (editor.virtualEditor) {
        scheduleEditorMetricsRebuild(100);
      } else {
        const currentSource = getSourceText();
        if (editorMetricText !== currentSource) {
          editorLineIndexText = null;
          editorMetricText = null;
          scheduleEditorMetricsRebuild(100);
        }
      }

      const currentTheme = document.body.getAttribute('data-theme') || 'light';
      const forceFullRebuild = previewRenderTheme !== '' && previewRenderTheme !== currentTheme;
      previewRenderTheme = currentTheme;
      const renderStarted = performance.now();
      let patchResult;
      let blockTokens = [];
      let sourceAlreadyAnnotated = false;
      let skipEnhancements = false;
      let workerDurationMs = 0;
      let modelResult = null;
      let workerFailed = false;
      const requestedPreviewMode = previewModeResolverPort.normalizeSetting(previewPerformanceMode);
      const hybridMode = typeof isHybridLayoutMode === 'function' && isHybridLayoutMode();
      const useWorker = (hybridMode
        || sourceLength >= classicPreviewBehaviorThresholds.mode.workerChars
        || requestedPreviewMode === 'virtual'
        || requestedPreviewMode === 'chapter')
        && Boolean(window.createPreviewWorkerClient);

      try {
        if (useWorker) {
          const client = getPreviewWorkerClient();
          modelResult = await client.update(documentModel || editor, getSourceText, forceFullRebuild, {
            indexOnly: hybridMode
          });
          if (modelResult?.cancelled || !classicPreviewStatePort.isCurrentVersion(renderVersion)) return;
          workerDurationMs = modelResult.workerDurationMs || 0;
          blockTokens = modelResult.tokens || [];
          incrementalPreviewModel?.reset();
        } else if (typeof marked !== 'undefined' && typeof marked.lexer === 'function' && window.IncrementalPreviewModel) {
          if (!incrementalPreviewModel) incrementalPreviewModel = new window.IncrementalPreviewModel(marked.lexer.bind(marked));
          modelResult = incrementalPreviewModel.update(getSourceText(), { forceFull: forceFullRebuild });
          blockTokens = modelResult.tokens;
        }

        if (modelResult) {
          previewReferenceDefinitions = String(modelResult.referenceDefinitions || '');
          const focusSection = modelResult.focusChapter || null;
          classicPreviewStatePort.setFocusSection(renderVersion, focusSection);
          previewEnhancementCoordinatorPort.setPriorityRange(focusSection);
          updateDocumentStatistics(modelResult.statistics);
          const headingVersion = modelResult.documentVersion ?? documentModel?.getDocumentVersion?.() ?? editor.virtualEditor?.getDocumentVersion?.();
          const outlineDocumentKey = previewDocumentSessionPort.activeId || '';
          if (Array.isArray(modelResult.headings)) {
            const outlineUpdate = previewOutlineControllerPort.replaceIndex(modelResult.headings, {
              version: headingVersion,
              documentKey: outlineDocumentKey,
              changedHint: modelResult.headingIndexChanged,
              reason: 'preview-worker-index'
            });
            if (outlineUpdate.accepted && outlineUpdate.changed) {
              persistCurrentDocumentIndex(modelResult.headings, modelResult.statistics);
            }
          } else if (Array.isArray(modelResult.blocks)) {
            previewOutlineControllerPort.replacePreviewBlocks(modelResult.blocks, {
              version: headingVersion,
              documentKey: outlineDocumentKey,
              reason: 'preview-model-index'
            });
          }

          const indexedSourceLength = Number(modelResult.statistics?.characters) || 0;
          const previousPreviewState = classicPreviewStatePort.snapshot;
          const previousScopeKey = previousPreviewState.lastStableResult?.scopeKey || previousPreviewState.mode;
          const renderPlan = previewRenderCoordinatorPort.createPlan({
            modelResult,
            sourceLength: Math.max(sourceLength, indexedSourceLength),
            previewPerformanceMode,
            previousMode: previousPreviewState.mode,
            previousScopeKey,
            forceFullRebuild
          });
          const renderResult = renderPlan.renderResult;
          const previewScopeChanged = renderPlan.scopeChanged;
          resolvedPreviewMode = renderPlan.mode;
          resolvedPreviewScopeKey = renderPlan.scopeKey;
          if (previewScopeChanged && resolvedPreviewMode === 'chapter' && previousScopeKey && previousScopeKey !== resolvedPreviewScopeKey) {
            window.markdownEditorScrollSync?.markProgrammaticScroll?.('preview', 420);
            window.markdownEditorScrollSync?.suspend?.(320);
            preview.scrollTop = 0;
          }

          const mountCoordinatedVirtualResult = (result, scope, forceRender) => {
            const controller = getVirtualPreviewController();
            controller.setCacheContext?.(previewDocumentSessionPort.activeId, getPreviewHeightCacheVisualKey());
            const mounted = controller.update(result, {
              forceAll: forceRender,
              scope,
              createNodes: block => previewRendererPort.createBlockNodes(block, renderMarkdownFragment),
              applySourceRange: (nodes, block) => previewRendererPort.applyBlockSourceRange(nodes, block),
              onNodesMounted(nodes, mountInfo) {
                enhancePreviewNodes(nodes, mountInfo.changedNodes);
                previewAnchorsCache = controller.getMountedAnchors();
                invalidatePreviewAnchorMetrics();
              },
              onPrewarmNeeded: prewarmPreviewBlocks
            });
            sourceAlreadyAnnotated = true;
            return mounted;
          };

          patchResult = previewRenderCoordinatorPort.execute(renderPlan, {
            reuseStable({ renderResult: reusableResult }) {
              virtualPreviewController?.refreshRenderData?.(reusableResult);
              const body = preview.querySelector('.markdown-body');
              const hasStablePreview = Boolean(classicPreviewStatePort.snapshot.lastStableResult);
              const recoveryTarget = previewRecoveryViewPort.inspect();
              if (!hasStablePreview || !body || recoveryTarget.recovery) return null;
              const pendingMermaidRoots = collectPendingMermaidRoots(body);
              sourceAlreadyAnnotated = true;
              skipEnhancements = pendingMermaidRoots.length === 0;
              return {
                body,
                changedNodes: pendingMermaidRoots,
                reused: virtualPreviewController?.active
                  ? virtualPreviewController.getStats().mountedBlocks
                  : body.children.length,
                parsedChars: 0,
                mode: pendingMermaidRoots.length ? 'unchanged-enhancement-retry' : 'unchanged',
                virtualized: Boolean(virtualPreviewController?.active),
                blockCount: reusableResult.blocks?.length || 0
              };
            },
            renderWholeDocument({ renderResult: wholeResult, forceRender }) {
              disableVirtualPreview();
              const rendered = commitPreviewDomPatch(previewRendererPort.patchHtml(wholeResult.wholeHtml, { forceFullRebuild: forceRender }));
              rendered.parsedChars = wholeResult.parsedChars;
              rendered.mode = 'worker-whole-document';
              rendered.blockCount = wholeResult.blocks?.length || rendered.body.children.length;
              return rendered;
            },
            mountVirtual({ renderResult: virtualResult, forceRender }) {
              return mountCoordinatedVirtualResult(virtualResult, 'virtual', forceRender);
            },
            mountChapter({ renderResult: chapterResult, forceRender }) {
              const rendered = mountCoordinatedVirtualResult(chapterResult, 'chapter', forceRender);
              rendered.mode = 'worker-chapter-preview';
              return rendered;
            },
            renderIncremental({ renderResult: incrementalResult, forceRender }) {
              disableVirtualPreview();
              const rendered = commitPreviewDomPatch(previewRendererPort.patchBlocks(incrementalResult, { forceAll: forceRender, renderFallback: renderMarkdownFragment }));
              rendered.blockCount = incrementalResult.blocks?.length || 0;
              sourceAlreadyAnnotated = true;
              return rendered;
            }
          });
        }
      } catch (error) {
        console.warn('Incremental preview fallback:', error);
        window.markdownEditorPerf?.diagnostic?.(
          hybridMode ? 'hybrid.preview-index-failure' : 'preview.pipeline-failure',
          {
            category: hybridMode ? 'editor.hybrid' : 'render.pipeline',
            status: 'error',
            dedupeKey: `${hybridMode ? 'hybrid.preview-index-failure' : 'preview.pipeline-failure'}:${error?.name || 'Error'}`,
            minIntervalMs: 5000,
            details: {
              message: error?.message || String(error),
              sourceChars: sourceLength,
              documentVersion: documentModel?.getDocumentVersion?.() || 0,
              requestedPreviewMode,
              useWorker,
              renderVersion
            }
          }
        );
        incrementalPreviewModel?.reset();
        previewWorkerClient?.destroy?.();
        previewWorkerClient = null;
        workerFailed = useWorker;
        previewFailure = {
          name: error?.name || 'Error',
          message: error?.message || String(error),
          source: workerFailed ? 'worker' : 'pipeline'
        };
        if (workerFailed && classicPreviewStatePort.snapshot.error?.source !== 'worker') {
          showToast('后台预览暂时不可用，已启用安全降级');
        }
      }

      if (!classicPreviewStatePort.isCurrentVersion(renderVersion)) return;

      if (hybridMode) {
        previewEnhancementCoordinatorPort.cancel();
        resolvedPreviewMode = 'hybrid';
        resolvedPreviewScopeKey = 'hybrid';
        const badge = document.getElementById('preview-strategy-badge');
        if (badge) badge.hidden = true;
        document.body.dataset.previewPerformanceMode = 'hybrid';
        const presentationStats = editor.virtualEditor?.getPresentationStats?.() || {};
        const expectedDocumentVersion = documentModel?.getDocumentVersion?.() ?? editor.virtualEditor?.getDocumentVersion?.() ?? 0;
        const indexedDocumentVersion = Number(modelResult?.documentVersion);
        const indexedCharacters = Number(modelResult?.statistics?.characters);
        if (!modelResult && sourceLength > 0) {
          window.markdownEditorPerf?.diagnostic?.('hybrid.preview-index-missing', {
            category: 'editor.hybrid',
            status: 'warning',
            dedupeKey: 'hybrid.preview-index-missing',
            minIntervalMs: 5000,
            details: {
              sourceChars: sourceLength,
              documentVersion: expectedDocumentVersion,
              workerFailed
            }
          });
        } else if (Number.isFinite(indexedDocumentVersion) && indexedDocumentVersion !== expectedDocumentVersion) {
          window.markdownEditorPerf?.diagnostic?.('hybrid.preview-index-version-mismatch', {
            category: 'editor.hybrid',
            status: 'warning',
            dedupeKey: 'hybrid.preview-index-version-mismatch',
            minIntervalMs: 5000,
            details: {
              sourceChars: sourceLength,
              documentVersion: expectedDocumentVersion,
              indexedDocumentVersion
            }
          });
        } else if (Number.isFinite(indexedCharacters) && indexedCharacters !== sourceLength) {
          window.markdownEditorPerf?.diagnostic?.('hybrid.preview-index-length-mismatch', {
            category: 'editor.hybrid',
            status: 'warning',
            dedupeKey: 'hybrid.preview-index-length-mismatch',
            minIntervalMs: 5000,
            details: {
              sourceChars: sourceLength,
              indexedCharacters,
              documentVersion: expectedDocumentVersion
            }
          });
        }
        if (workerFailed) {
          classicPreviewStatePort.commitDegraded(renderVersion, {
            mode: 'hybrid',
            error: previewFailure
          });
          classicPreviewStatePort.invalidate({
            mode: 'hybrid',
            status: 'suspended',
            clearStable: false,
            clearError: false
          });
        } else {
          classicPreviewStatePort.invalidate({
            mode: 'hybrid',
            status: 'suspended',
            clearStable: false,
            clearError: true
          });
        }
        window.markdownEditorPerf?.record('render.preview-index-only', {
          category: 'render.pipeline',
          durationMs: performance.now() - renderStarted,
          aggregate: true,
          details: {
            sourceChars: sourceLength,
            blocks: modelResult?.blocks?.length || 0,
            workerDurationMs,
            visibleLines: presentationStats.visibleLines || 0,
            decoratedLines: presentationStats.decoratedLines || 0,
            headingLines: presentationStats.headingLines || 0,
            sourceActiveLines: presentationStats.sourceActiveLines || 0,
            hiddenMarkers: presentationStats.hiddenMarkers || 0,
            mode: 'hybrid-index-only'
          }
        });
        return;
      }

      if (!patchResult && workerFailed) {
        const lastStableResult = classicPreviewStatePort.snapshot.lastStableResult;
        const recoveryTarget = previewRecoveryViewPort.inspect();
        const preserveStable = Boolean(lastStableResult && recoveryTarget.present && !recoveryTarget.recovery);
        if (!preserveStable) disableVirtualPreview();
        const recovery = previewRecoveryViewPort.recover({ preserveStable });
        const body = recovery.body;
        patchResult = {
          body,
          changedNodes: [],
          reused: recovery.preserved
            ? (virtualPreviewController?.active ? virtualPreviewController.getStats().mountedBlocks : body.children.length)
            : 0,
          parsedChars: 0,
          mode: recovery.preserved ? 'worker-safe-fallback-stale' : 'worker-safe-fallback-paused',
          virtualized: recovery.preserved && Boolean(virtualPreviewController?.active),
          blockCount: recovery.preserved
            ? (virtualPreviewController?.getStats?.().blocks || body.children.length)
            : 0
        };
        resolvedPreviewMode = previewModeResolverPort.resolve({ previewPerformanceMode }, sourceLength, patchResult.blockCount);
        resolvedPreviewScopeKey = lastStableResult?.scopeKey || resolvedPreviewMode;
        sourceAlreadyAnnotated = true;
        skipEnhancements = true;
      }

      if (!patchResult && !workerFailed) {
        const lastStableResult = classicPreviewStatePort.snapshot.lastStableResult;
        const recoveryTargetBeforeRender = previewRecoveryViewPort.inspect();
        const hadStablePreview = Boolean(lastStableResult && recoveryTargetBeforeRender.present && !recoveryTargetBeforeRender.recovery);
        try {
          disableVirtualPreview();
          resolvedPreviewMode = 'full';
          resolvedPreviewScopeKey = 'full';
          const fallbackSource = getSourceText();
          let text = fallbackSource;
          let placeholders = [];
          const hasMath = Boolean(window.markdownEditorPresentation?.math?.renderTree || typeof renderMathInElement !== 'undefined') && sourceContainsMath(fallbackSource);
          if (hasMath) {
            const protectedMath = protectMath(text);
            text = protectedMath.text;
            placeholders = protectedMath.placeholders;
          }

          let html = '';
          if (typeof marked !== 'undefined') {
            try {
              const tokenTree = typeof marked.lexer === 'function' ? marked.lexer(text) : null;
              if (tokenTree && typeof marked.parser === 'function') {
                blockTokens = hasMath ? [] : collectMarkedBlockTokens(tokenTree);
                html = marked.parser(tokenTree);
              } else {
                html = marked.parse(text);
              }
            } catch (error) {
              console.error('Markdown render error:', error);
              html = '<pre class="f-raw-fallback">' + escapeHtml(fallbackSource) + '</pre>';
              blockTokens = [];
            }
          } else {
            html = '<pre class="f-raw-fallback">' + escapeHtml(fallbackSource) + '</pre>';
          }
          if (placeholders.length) html = restoreMath(html, placeholders);
          patchResult = commitPreviewDomPatch(previewRendererPort.patchHtml(html, { forceFullRebuild }));
          patchResult.parsedChars = sourceLength;
          patchResult.mode = 'whole-document';
          patchResult.blockCount = patchResult.body.children.length;
          previewFailure = null;
        } catch (error) {
          console.error('Preview safe render fallback failed:', error);
          previewFailure = {
            name: error?.name || 'Error',
            message: error?.message || String(error),
            source: 'render'
          };
          const recoveryTarget = previewRecoveryViewPort.inspect();
          const preserveStable = Boolean(hadStablePreview && recoveryTarget.present && !recoveryTarget.recovery);
          const recovery = previewRecoveryViewPort.recover({ preserveStable });
          patchResult = {
            body: recovery.body,
            changedNodes: [],
            reused: recovery.preserved ? recovery.body.children.length : 0,
            parsedChars: 0,
            mode: recovery.preserved ? 'render-safe-fallback-stale' : 'render-safe-fallback-paused',
            virtualized: false,
            blockCount: recovery.preserved ? recovery.body.children.length : 0
          };
          resolvedPreviewMode = classicPreviewStatePort.snapshot.mode || 'full';
          resolvedPreviewScopeKey = lastStableResult?.scopeKey || resolvedPreviewMode;
          sourceAlreadyAnnotated = true;
          skipEnhancements = true;
        }
      }

      const retryingPendingEnhancements = patchResult.mode === 'unchanged-enhancement-retry';
      if (!patchResult.virtualized || retryingPendingEnhancements) {
        enhancePreviewNodes(patchResult.changedNodes, patchResult.changedNodes);
        if (!patchResult.virtualized) {
          window.markdownEditorSelectionController?.notifyPreviewReplaced?.('preview-dom-patch');
        }
      }
      if (!skipEnhancements) {
        invalidatePreviewAnchorStructure();
        if (patchResult.virtualized) previewAnchorsCache = virtualPreviewController.getMountedAnchors();
        observePreviewBodySize();
        schedulePreviewEnhancements(sourceText || '', blockTokens, renderVersion, sourceAlreadyAnnotated, sourceLength);
      }
      const virtualStats = virtualPreviewController?.active ? virtualPreviewController.getStats() : null;
      const stableBlockCount = patchResult.blockCount ?? patchResult.body.children.length;
      const stableMountedBlocks = virtualStats?.mountedBlocks ?? patchResult.body.children.length;
      const stableMetadata = {
        scopeKey: resolvedPreviewScopeKey || resolvedPreviewMode,
        renderMode: patchResult.mode || 'dom-keyed',
        sourceLength,
        blockCount: stableBlockCount,
        mountedBlocks: stableMountedBlocks,
        documentVersion: documentModel?.getDocumentVersion?.() ?? editor.virtualEditor?.getDocumentVersion?.() ?? 0
      };
      if (workerFailed) {
        const preservePreviousStable = patchResult.mode === 'worker-safe-fallback-stale'
          || patchResult.mode === 'worker-safe-fallback-paused';
        classicPreviewStatePort.commitDegraded(renderVersion, {
          mode: resolvedPreviewMode,
          ...(preservePreviousStable ? {} : { result: stableMetadata }),
          error: previewFailure
        });
      } else if (previewFailure) {
        if (patchResult.mode === 'render-safe-fallback-stale') {
          classicPreviewStatePort.commitDegraded(renderVersion, {
            mode: resolvedPreviewMode,
            error: previewFailure
          });
        } else {
          classicPreviewStatePort.failRender(renderVersion, {
            mode: resolvedPreviewMode,
            error: previewFailure
          });
        }
      } else {
        classicPreviewStatePort.commitStable(renderVersion, {
          mode: resolvedPreviewMode,
          result: stableMetadata,
          clearError: useWorker || classicPreviewStatePort.snapshot.error?.source !== 'worker'
        });
      }
      updatePreviewStrategyBadge(resolvedPreviewMode, {
        blockCount: stableBlockCount,
        mountedBlocks: stableMountedBlocks
      });
      window.markdownEditorPerf?.record('render.preview-patch', {
        category: 'render.pipeline',
        durationMs: performance.now() - renderStarted,
        aggregate: true,
        details: {
          blocks: patchResult.blockCount ?? patchResult.body.children.length,
          mountedBlocks: virtualStats?.mountedBlocks ?? patchResult.body.children.length,
          changed: patchResult.changedNodes.length,
          reused: patchResult.reused,
          parsedChars: patchResult.parsedChars ?? sourceLength,
          workerDurationMs,
          priorityChapterStart: modelResult?.focusChapter?.startLine || 0,
          priorityChapterEnd: modelResult?.focusChapter?.endLine || 0,
          enhancementJobs: previewEnhancementCoordinatorPort.getStats().pending || 0,
          virtualized: Boolean(patchResult.virtualized),
          mode: patchResult.mode || 'dom-keyed',
          requestedPreviewMode,
          resolvedPreviewMode
        }
      });
    }

    function protectMath(text) {
      const api = window.markdownEditorMath;
      if (typeof api?.protectSource === 'function') {
        return api.protectSource(text, 'PREVIEW_MATH');
      }
      return { text: String(text || ''), placeholders: [] };
    }

    function restoreMath(html, placeholders) {
      const api = window.markdownEditorMath;
      return typeof api?.restoreSource === 'function'
        ? api.restoreSource(html, placeholders)
        : String(html || '');
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // 统计字数
    function updateCount() {
      clearTimeout(countUpdateTimer);
      countUpdateTimer = 0;
      const count = documentModel?.getNonWhitespaceCount?.()
        ?? editor.virtualEditor?.getNonWhitespaceCount?.()
        ?? editor.value.replace(/\s/g, '').length;
      wordCount.textContent = t('wordCount', count);
    }

    function scheduleCountUpdate() {
      clearTimeout(countUpdateTimer);
      countUpdateTimer = setTimeout(updateCount, editor.textLength >= 50000 ? 140 : 40);
    }

    // 切换预览/源码模式
    function setPreviewMode(mode, skipRefresh = false) {
      // 桌面版只保留“左侧源码 + 右侧预览”。
      // 旧版右侧源码会和左侧编辑区重复，因此这里统一强制为预览模式。
      previewMode = 'preview';
      localStorage.setItem(PREVIEW_MODE_KEY, previewMode);
      preview.hidden = false;
      if (!skipRefresh) {
        updatePreview();
        updateCount();
        autoSave();
      }
    }

    // 自动保存
