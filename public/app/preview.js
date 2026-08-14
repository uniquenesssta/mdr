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
    if (!classicPreviewStatePort) throw new Error('Preview State compatibility port is unavailable.');
    const classicPreviewBehaviorThresholds = previewThresholdsPort.snapshot;
    previewEditorUiCommandPort.register({
      focusPreviewLineForOutline: (line, options) => focusPreviewLine(line, options)
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

    let previewLayoutObserver = null;
    let previewObservedWidth = 0;
    let previewObservedHeight = 0;

    function getPreviewLayoutState() {
      const previewPane = document.querySelector('.preview-pane');
      const width = Math.round(preview.clientWidth || 0);
      const height = Math.round(preview.clientHeight || 0);
      return {
        previewPane,
        width,
        height,
        visible: Boolean(
          previewPane
          && !previewPane.classList.contains('collapsed')
          && width > 0
          && height > 0
        )
      };
    }

    function refreshPreviewViewportAfterLayout(task) {
      const refresh = () => {
        window.markdownEditorVirtualPreview?.refreshViewport?.({ forceWindow: true });
        invalidatePreviewAnchorMetrics();
        window.markdownEditorScrollController?.notifyGeometryChanged?.('preview');
      };
      if (!task.commit(refresh)) return;
      task.schedule(nextTask => nextTask.commit(refresh), { kind: 'frame' });
    }

    function refreshPreviewAfterLayout(options = {}) {
      const forceRender = options.forceRender !== false;
      const reason = String(options.reason || 'layout-visible');
      let attempts = 0;
      let stableFrames = 0;
      let previousWidth = -1;
      let previousHeight = -1;

      const run = async task => {
        if (!task.isCurrent()) return;
        if (typeof isHybridLayoutMode === 'function' && isHybridLayoutMode()) return;

        const layout = getPreviewLayoutState();
        attempts += 1;
        if (!layout.visible) {
          if (attempts < classicPreviewBehaviorThresholds.scheduling.layout.maxAttempts) {
            task.schedule(run, {
              kind: 'timeout',
              delay: classicPreviewBehaviorThresholds.scheduling.layout.retryMs
            });
          }
          return;
        }

        if (Math.abs(layout.width - previousWidth) <= 1 && Math.abs(layout.height - previousHeight) <= 1) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
          previousWidth = layout.width;
          previousHeight = layout.height;
        }
        if (stableFrames < classicPreviewBehaviorThresholds.scheduling.layout.stableFrames
          && attempts < classicPreviewBehaviorThresholds.scheduling.layout.maxAttempts) {
          task.schedule(run, { kind: 'frame' });
          return;
        }

        const body = preview.querySelector('.markdown-body');
        const hasStablePreview = Boolean(classicPreviewStatePort.snapshot.lastStableResult);
        const renderRequired = forceRender
          || !hasStablePreview
          || !body
          || body.classList.contains('preview-loading')
          || body.childElementCount === 0;
        const started = performance.now();
        try {
          if (renderRequired) await Promise.resolve(updatePreview());
          if (!task.isCurrent()) return;
          refreshPreviewViewportAfterLayout(task);
        } catch (error) {
          task.commit(() => console.warn('Preview layout refresh failed:', error));
        } finally {
          task.commit(() => {
            window.markdownEditorPerf?.record('render.preview-layout-refresh', {
              category: 'render.pipeline',
              durationMs: performance.now() - started,
              aggregate: true,
              details: {
                reason,
                forceRender,
                renderRequired,
                attempts,
                stableFrames,
                width: layout.width,
                height: layout.height,
                previewBlocks: window.markdownEditorVirtualPreview?.getStats?.().blocks
                  || preview.querySelector('.markdown-body')?.children.length
                  || 0,
                mountedBlocks: window.markdownEditorVirtualPreview?.getStats?.().mountedBlocks || 0
              }
            });
          });
        }
      };

      previewSchedulerPort.schedule('layout', run, { kind: 'frame' });
    }

    function initializePreviewLayoutObserver() {
      if (previewLayoutObserver || typeof ResizeObserver !== 'function') return;
      const previewPane = document.querySelector('.preview-pane');
      previewLayoutObserver = new ResizeObserver(() => {
        if (typeof isHybridLayoutMode === 'function' && isHybridLayoutMode()) return;
        const layout = getPreviewLayoutState();
        const becameVisible = layout.visible && (previewObservedWidth <= 0 || previewObservedHeight <= 0);
        const sizeChanged = layout.visible && (
          Math.abs(layout.width - previewObservedWidth) > 1
          || Math.abs(layout.height - previewObservedHeight) > 1
        );
        previewObservedWidth = layout.width;
        previewObservedHeight = layout.height;
        if (!layout.visible || (!becameVisible && !sizeChanged)) return;
        const body = preview.querySelector('.markdown-body');
        const hasStablePreview = Boolean(classicPreviewStatePort.snapshot.lastStableResult);
        refreshPreviewAfterLayout({
          forceRender: becameVisible || !hasStablePreview || !body || body.classList.contains('preview-loading'),
          reason: becameVisible ? 'preview-became-visible' : 'preview-container-resize'
        });
      });
      if (previewPane) previewLayoutObserver.observe(previewPane);
      previewLayoutObserver.observe(preview);
      const initial = getPreviewLayoutState();
      previewObservedWidth = initial.width;
      previewObservedHeight = initial.height;
    }

    function schedulePreviewFocusUpdate() {
      if (typeof isHybridLayoutMode === 'function' && isHybridLayoutMode()) return;
      if (!editor.virtualEditor
        || (editor.textLength < classicPreviewBehaviorThresholds.mode.workerChars && previewPerformanceMode !== 'chapter')
        || previewSchedulerPort.hasPending('input')) return;
      const line = editor.virtualEditor.getLineNumberAtPosition?.(editor.selectionStart || 0) || 1;
      const chapter = classicPreviewStatePort.snapshot.focusSection;
      if (chapter && line >= chapter.startLine && line <= chapter.endLine) return;
      previewSchedulerPort.schedule('focus', () => updatePreview(), {
        kind: 'timeout',
        delay: classicPreviewBehaviorThresholds.scheduling.focusMs
      });
    }


    function previewScopeContainsLine(line) {
      const targetLine = Math.max(1, Number(line) || 1);
      const controller = window.markdownEditorVirtualPreview;
      if (controller?.active && typeof controller.containsLineRange === 'function') {
        return controller.containsLineRange(targetLine, targetLine);
      }
      if (classicPreviewStatePort.snapshot.mode !== 'chapter') return true;
      const chapter = classicPreviewStatePort.snapshot.focusSection;
      return Boolean(chapter && targetLine >= chapter.startLine && targetLine <= chapter.endLine);
    }

    async function focusPreviewLine(line, options = {}) {
      const targetLine = Math.max(1, Number(line) || 1);
      const behavior = options.behavior === 'smooth' ? 'smooth' : 'auto';
      const shouldScroll = options.scroll !== false;
      const requestVersion = ++previewLineFocusVersion;
      const needsScopeRefresh = classicPreviewStatePort.snapshot.mode === 'chapter' && !previewScopeContainsLine(targetLine);

      if (needsScopeRefresh) {
        previewSchedulerPort.cancel('focus');
        previewSchedulerPort.cancel('input');

        let pending = previewLineFocusPromise;
        if (!pending || previewLineFocusTarget !== targetLine) {
          previewLineFocusTarget = targetLine;
          pending = Promise.resolve(updatePreview());
          previewLineFocusPromise = pending;
          pending.finally(() => {
            if (previewLineFocusPromise === pending) {
              previewLineFocusPromise = null;
              previewLineFocusTarget = 0;
            }
          });
        }
        await pending;
        if (requestVersion !== previewLineFocusVersion) return false;
      }

      const controller = window.markdownEditorVirtualPreview;
      if (controller?.active) {
        const anchor = controller.ensureLineVisible?.(targetLine);
        if (!anchor && classicPreviewStatePort.snapshot.mode === 'chapter') return false;
        invalidatePreviewAnchorStructure();
      }
      if (shouldScroll) scrollPreviewToLine(targetLine, behavior, 0.5);
      return true;
    }

    function suspendPreviewForHybridMode() {
      previewSchedulerPort.cancel('input');
      previewSchedulerPort.cancel('focus');
      previewSchedulerPort.cancel('layout');
      const suspendedVersion = classicPreviewStatePort.invalidate({
        mode: 'hybrid',
        status: 'suspended',
        clearStable: false,
        clearError: false
      });
      cancelScheduledPreviewEnhancements();
      getPreviewEnhancementQueue()?.begin(suspendedVersion);
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

    function cancelScheduledPreviewEnhancements() {
      previewSchedulerPort.cancel('enhancement');
    }

    function schedulePreviewEnhancements(sourceText, blockTokens, renderVersion, sourceAlreadyAnnotated = false, sourceLength = sourceText.length) {
      cancelScheduledPreviewEnhancements();
      previewSchedulerPort.schedule('enhancement', task => {
        if (!classicPreviewStatePort.isCurrentVersion(renderVersion)) return;
        const annotationStarted = performance.now();
        const annotationCommitted = task.commit(() => {
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
        });
        if (!annotationCommitted) return;

        const finish = finishTask => {
          if (!classicPreviewStatePort.isCurrentVersion(renderVersion)) return;
          finishTask.commit(() => {
            const started = performance.now();
            window.markdownEditorSelectionController?.notifyPreviewMounted?.('preview-enhancements');
            // 在空闲阶段预热锚点坐标，避免用户第一次滚动时同步测量全部预览块。
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
          });
        };
        if (sourceLength >= classicPreviewBehaviorThresholds.scheduling.postprocess.deferChars) {
          task.schedule(finish, {
            kind: 'background',
            timeout: classicPreviewBehaviorThresholds.scheduling.postprocess.idleTimeoutMs,
            fallbackMs: classicPreviewBehaviorThresholds.scheduling.postprocess.fallbackMs
          });
        } else {
          finish(task);
        }
      }, { kind: 'frame' });
    }

    function getPreviewNodeRenderKey(node, occurrences) {
      const markup = node.outerHTML;
      const base = node.tagName + ':' + markup.length + ':' + simpleHash(markup);
      const occurrence = occurrences.get(base) || 0;
      occurrences.set(base, occurrence + 1);
      return base + ':' + occurrence;
    }

    function assignPreviewRenderKeys(body) {
      const occurrences = new Map();
      Array.from(body.children).forEach(node => {
        node.dataset.renderKey = getPreviewNodeRenderKey(node, occurrences);
      });
    }

    function patchPreviewBody(html, forceFullRebuild = false) {
      const template = document.createElement('template');
      template.innerHTML = '<div class="markdown-body">' + html + '</div>';
      const nextBody = template.content.firstElementChild;
      assignPreviewRenderKeys(nextBody);
      const currentBody = preview.querySelector('.markdown-body');
      if (!currentBody || currentBody.classList.contains('preview-loading')) {
        preview.replaceChildren(nextBody);
        observedPreviewBody = null;
        invalidatePreviewAnchorStructure();
        return { body: nextBody, changedNodes: Array.from(nextBody.children), reused: 0 };
      }
      if (forceFullRebuild) {
        const changedNodes = Array.from(nextBody.children);
        currentBody.replaceChildren(...changedNodes);
        invalidatePreviewAnchorStructure();
        return { body: currentBody, changedNodes, reused: 0 };
      }

      const oldChildren = Array.from(currentBody.children);
      const buckets = new Map();
      oldChildren.forEach(node => {
        const key = node.dataset.renderKey || '';
        if (!key) return;
        const bucket = buckets.get(key) || [];
        bucket.push(node);
        buckets.set(key, bucket);
      });

      const desiredNodes = [];
      const changedNodes = [];
      let reused = 0;
      Array.from(nextBody.children).forEach(newNode => {
        const key = newNode.dataset.renderKey || '';
        const bucket = key ? buckets.get(key) : null;
        const reusable = bucket?.shift();
        if (reusable) {
          desiredNodes.push(reusable);
          reused += 1;
        } else {
          desiredNodes.push(newNode);
          changedNodes.push(newNode);
        }
      });

      if (desiredNodes.length && reused / desiredNodes.length < 0.25) {
        currentBody.replaceChildren(...desiredNodes);
      } else {
        const used = new Set(desiredNodes);
        let cursor = currentBody.firstChild;
        desiredNodes.forEach(node => {
          if (node === cursor) {
            cursor = cursor.nextSibling;
            return;
          }
          currentBody.insertBefore(node, cursor);
        });
        oldChildren.forEach(node => {
          if (!used.has(node) && node.parentNode === currentBody) node.remove();
        });
      }
      invalidatePreviewAnchorStructure();
      return { body: currentBody, changedNodes, reused };
    }

    function sourceContainsMath(value) {
      return window.markdownEditorMath?.containsMath?.(value)
        ?? (String(value || '').includes('$') || String(value || '').includes('\\[') || String(value || '').includes('\\('));
    }

    function getMathDelimiters() {
      return window.markdownEditorMath?.delimiters || [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false }
      ];
    }

    function renderMathInPreviewNodes(nodes) {
      const mathRenderer = window.markdownEditorPresentation?.math || window.markdownEditorMath;
      if (!mathRenderer?.renderTree && typeof renderMathInElement === 'undefined') return;
      nodes.forEach(node => {
        if (mathRenderer?.renderTree) {
          mathRenderer.renderTree(node, { delimiters: getMathDelimiters() });
          return;
        }
        renderMathInElement(node, {
          delimiters: getMathDelimiters(),
          throwOnError: false
        });
      });
    }


    async function copyPreviewCode(text) {
      const value = String(text ?? '');
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
      }
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.className = 'c-clipboard-buffer';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) throw new Error('无法复制代码');
    }

    function getPreviewCodeLanguage(code, highlighter) {
      const languageClass = Array.from(code.classList || []).find(name => name.startsWith('language-')) || '';
      const language = languageClass.slice('language-'.length) || 'text';
      return {
        language,
        normalized: highlighter.getNormalizedCodeLanguage?.(language) || language.toLowerCase()
      };
    }

    function resolvePreviewCodeSourceStart(pre) {
      const sourceStart = Number(pre.dataset.sourceStartIndex);
      const sourceEnd = Number(pre.dataset.sourceEndIndex);
      if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) return null;
      const source = documentModel?.sliceText?.(sourceStart, sourceEnd);
      if (typeof source !== 'string') return null;
      const firstLineEnd = source.indexOf('\n');
      if (firstLineEnd < 0) return null;
      const firstLine = source.slice(0, firstLineEnd);
      if (!/^\s*(`{3,}|~{3,})/.test(firstLine)) return null;
      return sourceStart + firstLineEnd + 1;
    }

    function collectPreviewCodeElements(roots) {
      const elements = [];
      const seen = new Set();
      const add = code => {
        if (!(code instanceof HTMLElement) || seen.has(code)) return;
        const pre = code.parentElement;
        if (!(pre instanceof HTMLPreElement) || pre.dataset.previewCodeEnhanced === 'true') return;
        seen.add(code);
        elements.push(code);
      };
      Array.from(roots || []).forEach(root => {
        if (!(root instanceof Element)) return;
        if (root.matches('pre')) add(root.querySelector(':scope > code'));
        root.querySelectorAll?.('pre > code').forEach(add);
      });
      return elements;
    }

    function enhancePreviewCodeBlocks(roots) {
      const highlighter = window.markdownEditorPresentation?.code || window.markdownEditorCodeHighlighter;
      if (!highlighter?.renderHighlightedCodeRows) return;
      collectPreviewCodeElements(roots).forEach(code => {
        const pre = code.parentElement;
        const { language, normalized } = getPreviewCodeLanguage(code, highlighter);
        if (!pre || normalized === 'mermaid') return;

        const source = code.textContent || '';
        const renderResult = highlighter.renderHighlightedCodeRows?.(code, source, language, {
          variant: 'preview',
          includeSourceNewlines: true
        });
        if (!renderResult) return;

        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'preview-code-copy';
        copyButton.setAttribute('aria-label', '复制代码');
        copyButton.title = '复制代码';
        copyButton.addEventListener('mousedown', event => event.preventDefault());
        copyButton.addEventListener('click', async event => {
          event.preventDefault();
          event.stopPropagation();
          try {
            await copyPreviewCode(source);
            showToast('代码已复制');
          } catch (error) {
            showToast(error?.message || '复制失败');
          }
        });

        code.classList.add('preview-code-body');
        pre.classList.add('preview-code-widget');
        pre.dataset.previewCodeEnhanced = 'true';
        pre.dataset.codeLanguage = normalized || language || 'text';
        const codeSourceStart = resolvePreviewCodeSourceStart(pre);
        if (Number.isFinite(codeSourceStart)) pre.dataset.codeSourceStartIndex = String(codeSourceStart);
        pre.insertBefore(copyButton, code);
      });
    }

    function stylePreviewNodes(roots) {
      styleTaskLists(roots);
      enhancePreviewCodeBlocks(roots);
    }


    let incrementalPreviewModel = null;
    let previewWorkerClient = null;
    let virtualPreviewController = null;
    let previewEnhancementQueue = null;

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

    function getPreviewEnhancementQueue() {
      if (!previewEnhancementQueue && window.createPreviewEnhancementQueue) {
        previewEnhancementQueue = window.createPreviewEnhancementQueue({
          styleTasks: roots => stylePreviewNodes(roots),
          renderMath: roots => renderMathInPreviewNodes(roots),
          renderMermaid: (roots, isCancelled) => renderMermaidBlocks(roots, isCancelled),
          animate: nodes => animatePreviewChanges(nodes),
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
          onBatchComplete() {
            invalidatePreviewAnchorMetrics();
            virtualPreviewController?.scheduleMeasure?.();
          }
        });
        window.markdownEditorPreviewEnhancements = previewEnhancementQueue;
      }
      return previewEnhancementQueue;
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
      previewEnhancementQueue?.cancel?.();
      preview.replaceChildren();
      observedPreviewBody = null;
      invalidatePreviewAnchorStructure();
      return updatePreview();
    }

    function enhancePreviewNodes(nodes, changedNodes = nodes) {
      if (!nodes?.length) return;
      const queue = getPreviewEnhancementQueue();
      if (queue) {
        queue.enqueue(nodes, changedNodes || []);
        return;
      }
      stylePreviewNodes(nodes);
      renderMathInPreviewNodes(nodes);
      renderMermaidBlocks(nodes);
      animatePreviewChanges(changedNodes || []);
      invalidatePreviewAnchorMetrics();
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

    function createPreviewNodesForBlock(block) {
      const template = document.createElement('template');
      template.innerHTML = typeof block.html === 'string' ? block.html : renderMarkdownFragment(block.raw);
      const nodes = Array.from(template.content.childNodes).map(node => {
        if (node.nodeType === Node.ELEMENT_NODE) return node;
        if (!node.textContent?.trim()) return null;
        const span = document.createElement('span');
        span.textContent = node.textContent;
        return span;
      }).filter(Boolean);
      if (!nodes.length) return [];
      nodes.forEach((node, index) => {
        node.dataset.previewBlockId = block.id;
        node.dataset.previewNodeIndex = String(index);
        node.dataset.renderKey = block.id + ':' + index;
      });
      return nodes;
    }

    function animatePreviewChanges(nodes) {
      const maxAnimatedNodes = document.body.classList.contains('ultra-large-document') ? 8 : 32;
      if (!nodes.length || nodes.length > maxAnimatedNodes) return;
      nodes.forEach(node => {
        node.classList.add('preview-block-enter');
        node.addEventListener('animationend', () => node.classList.remove('preview-block-enter'), { once: true });
      });
    }

    function applyPreviewBlockSourceRange(nodes, block) {
      nodes.forEach(node => {
        node.dataset.sourceLine = String(block.startLine);
        node.dataset.sourceEndLine = String(block.endLine);
        node.dataset.sourceStartIndex = String(block.start);
        node.dataset.sourceEndIndex = String(block.end);
      });
    }

    function patchIncrementalPreview(result, forceAll = false) {
      let body = preview.querySelector('.markdown-body');
      if (!body || body.classList.contains('preview-loading')) {
        body = document.createElement('div');
        body.className = 'markdown-body';
        preview.replaceChildren(body);
        observedPreviewBody = null;
        forceAll = true;
      }

      const existingByBlock = new Map();
      Array.from(body.children).forEach(node => {
        const id = node.dataset.previewBlockId;
        if (!id) return;
        const bucket = existingByBlock.get(id) || [];
        bucket.push(node);
        existingByBlock.set(id, bucket);
      });
      existingByBlock.forEach(nodes => nodes.sort((a, b) => Number(a.dataset.previewNodeIndex || 0) - Number(b.dataset.previewNodeIndex || 0)));

      const desiredNodes = [];
      const changedNodes = [];
      let reused = 0;
      for (const block of result.blocks) {
        const existing = existingByBlock.get(block.id) || [];
        const shouldRender = forceAll || result.changedIds.has(block.id) || !existing.length;
        const nodes = shouldRender ? createPreviewNodesForBlock(block) : existing;
        if (shouldRender) changedNodes.push(...nodes);
        else reused += nodes.length;
        applyPreviewBlockSourceRange(nodes, block);
        desiredNodes.push(...nodes);
      }

      const reuseRatio = desiredNodes.length ? reused / desiredNodes.length : 0;
      const shouldBulkReplace = forceAll
        || !result.incremental
        || !desiredNodes.length
        || reuseRatio < 0.25;

      if (shouldBulkReplace && body.childNodes.length && reuseRatio < 0.25) {
        // 文档切换时直接替换整个离屏构建完成的 body。相比在仍连接到页面的
        // 容器中删除上千个节点，这只触发一次 DOM 提交和一次布局失效。
        const replacementBody = document.createElement('div');
        replacementBody.className = 'markdown-body';
        replacementBody.append(...desiredNodes);
        preview.replaceChildren(replacementBody);
        body = replacementBody;
        observedPreviewBody = null;
      } else if (shouldBulkReplace) {
        // 围栏结构变化但仍有较高复用率时，批量重排已有节点。
        body.replaceChildren(...desiredNodes);
      } else {
        const desiredSet = new Set(desiredNodes);
        let cursor = body.firstChild;
        desiredNodes.forEach(node => {
          if (node === cursor) {
            cursor = cursor.nextSibling;
            return;
          }
          body.insertBefore(node, cursor);
        });
        Array.from(body.childNodes).forEach(node => {
          if (!desiredSet.has(node)) node.remove();
        });
      }

      invalidatePreviewAnchorStructure();
      previewAnchorsCache = desiredNodes.filter(node => node.dataset.sourceLine);
      return { body, changedNodes, reused, parsedChars: result.parsedChars, mode: result.incremental ? 'incremental' : result.reason };
    }

    async function updatePreview() {
      previewSchedulerPort.cancel('input');
      const renderVersion = classicPreviewStatePort.beginRender();
      getPreviewEnhancementQueue()?.begin(renderVersion);
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
          getPreviewEnhancementQueue()?.setPriorityRange(focusSection);
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
              createNodes: createPreviewNodesForBlock,
              applySourceRange: applyPreviewBlockSourceRange,
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
              if (!hasStablePreview || !body || body.classList.contains('preview-loading')) return null;
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
              const rendered = patchPreviewBody(wholeResult.wholeHtml, forceRender);
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
              const rendered = patchIncrementalPreview(incrementalResult, forceRender);
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
        cancelScheduledPreviewEnhancements();
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
        const body = preview.querySelector('.markdown-body');
        if (lastStableResult && body && !body.classList.contains('preview-loading')) {
          patchResult = {
            body,
            changedNodes: [],
            reused: virtualPreviewController?.active
              ? virtualPreviewController.getStats().mountedBlocks
              : body.children.length,
            parsedChars: 0,
            mode: 'worker-safe-fallback-stale',
            virtualized: Boolean(virtualPreviewController?.active),
            blockCount: virtualPreviewController?.getStats?.().blocks || body.children.length
          };
        } else {
          disableVirtualPreview();
          const fallbackBody = document.createElement('div');
          fallbackBody.className = 'markdown-body preview-loading';
          fallbackBody.textContent = '后台预览恢复中，编辑内容与自动保存不受影响…';
          preview.replaceChildren(fallbackBody);
          patchResult = {
            body: fallbackBody,
            changedNodes: [],
            reused: 0,
            parsedChars: 0,
            mode: 'worker-safe-fallback-paused',
            virtualized: false,
            blockCount: 0
          };
        }
        resolvedPreviewMode = previewModeResolverPort.resolve({ previewPerformanceMode }, sourceLength, patchResult.blockCount);
        resolvedPreviewScopeKey = lastStableResult?.scopeKey || resolvedPreviewMode;
        sourceAlreadyAnnotated = true;
        skipEnhancements = true;
      }

      if (!patchResult && !workerFailed) {
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
        patchResult = patchPreviewBody(html, forceFullRebuild);
        patchResult.parsedChars = sourceLength;
        patchResult.mode = 'whole-document';
        patchResult.blockCount = patchResult.body.children.length;
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
          enhancementJobs: previewEnhancementQueue?.getStats?.().pending || 0,
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

    function styleTaskLists(roots = null) {
      const checkboxes = roots && roots.length
        ? roots.flatMap(root => [root, ...root.querySelectorAll('input[type="checkbox"]')]).filter(node => node.matches?.('input[type="checkbox"]'))
        : Array.from(preview.querySelectorAll('input[type="checkbox"]'));
      checkboxes.forEach(cb => {
        const li = cb.closest('li');
        if (!li) return;
        li.classList.add('task-item');
        const ul = li.closest('ul, ol');
        if (ul && ul.tagName === 'UL') ul.classList.add('task-list');
      });
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
