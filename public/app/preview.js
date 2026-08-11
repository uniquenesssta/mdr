    const previewCompatibilityHost = document.getElementById('compatibility-business-ports');
    const previewDocumentSessionPort = previewCompatibilityHost?.markdownEditorDocumentSessionPort;
    const previewLayoutStatePort = previewCompatibilityHost?.markdownEditorLayoutStatePort;
    if (!previewDocumentSessionPort) throw new Error('Document session compatibility port is unavailable.');
    if (!previewLayoutStatePort) throw new Error('Layout State compatibility port is unavailable.');
    function schedulePreviewUpdate() {
      clearTimeout(previewUpdateTimer);
      const length = editor.textLength;
      const delay = length >= ULTRA_LARGE_DOCUMENT_CHARS ? 420 : length >= 100000 ? 120 : length >= 40000 ? 70 : 18;
      previewUpdateTimer = setTimeout(() => {
        previewUpdateTimer = 0;
        updatePreview();
      }, delay);
    }

    let previewLayoutRefreshFrame = 0;
    let previewLayoutRefreshTimer = 0;
    let previewLayoutRefreshSequence = 0;
    let previewLayoutObserver = null;
    let previewObservedWidth = 0;
    let previewObservedHeight = 0;
    const PREVIEW_LAYOUT_MAX_ATTEMPTS = 18;
    const PREVIEW_LAYOUT_STABLE_FRAMES = 2;
    const MIN_CHAPTER_PREVIEW_BLOCKS = 24;

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

    function refreshPreviewViewportAfterLayout() {
      window.markdownEditorVirtualPreview?.refreshViewport?.({ forceWindow: true });
      invalidatePreviewAnchorMetrics();
      window.markdownEditorScrollController?.notifyGeometryChanged?.('preview');
      requestAnimationFrame(() => {
        window.markdownEditorVirtualPreview?.refreshViewport?.({ forceWindow: true });
        invalidatePreviewAnchorMetrics();
        window.markdownEditorScrollController?.notifyGeometryChanged?.('preview');
      });
    }

    function refreshPreviewAfterLayout(options = {}) {
      const forceRender = options.forceRender !== false;
      const reason = String(options.reason || 'layout-visible');
      const sequence = ++previewLayoutRefreshSequence;
      let attempts = 0;
      let stableFrames = 0;
      let previousWidth = -1;
      let previousHeight = -1;
      cancelAnimationFrame(previewLayoutRefreshFrame);
      clearTimeout(previewLayoutRefreshTimer);

      const schedule = (delay = 0) => {
        if (sequence !== previewLayoutRefreshSequence) return;
        if (delay > 0) {
          previewLayoutRefreshTimer = setTimeout(() => schedule(), delay);
          return;
        }
        previewLayoutRefreshFrame = requestAnimationFrame(() => {
          previewLayoutRefreshFrame = 0;
          if (sequence !== previewLayoutRefreshSequence) return;
          if (typeof isHybridLayoutMode === 'function' && isHybridLayoutMode()) return;

          const layout = getPreviewLayoutState();
          attempts += 1;
          if (!layout.visible) {
            if (attempts < PREVIEW_LAYOUT_MAX_ATTEMPTS) schedule(34);
            return;
          }

          if (Math.abs(layout.width - previousWidth) <= 1 && Math.abs(layout.height - previousHeight) <= 1) {
            stableFrames += 1;
          } else {
            stableFrames = 0;
            previousWidth = layout.width;
            previousHeight = layout.height;
          }
          if (stableFrames < PREVIEW_LAYOUT_STABLE_FRAMES && attempts < PREVIEW_LAYOUT_MAX_ATTEMPTS) {
            schedule();
            return;
          }

          const body = preview.querySelector('.markdown-body');
          const renderRequired = forceRender
            || !body
            || body.classList.contains('preview-loading')
            || body.childElementCount === 0;
          const started = performance.now();
          const renderPromise = renderRequired ? Promise.resolve(updatePreview()) : Promise.resolve();
          renderPromise.then(() => {
            if (sequence !== previewLayoutRefreshSequence) return;
            refreshPreviewViewportAfterLayout();
          }, error => {
            console.warn('Preview layout refresh failed:', error);
          }).finally(() => {
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
        });
      };

      schedule();
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
        refreshPreviewAfterLayout({
          forceRender: becameVisible || !body || body.classList.contains('preview-loading'),
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
      if (!editor.virtualEditor || (editor.textLength < 100000 && previewPerformanceMode !== 'chapter') || previewUpdateTimer) return;
      const line = editor.virtualEditor.getLineNumberAtPosition?.(editor.selectionStart || 0) || 1;
      const chapter = activePreviewFocusChapter;
      if (chapter && line >= chapter.startLine && line <= chapter.endLine) return;
      clearTimeout(previewFocusUpdateTimer);
      previewFocusUpdateTimer = setTimeout(() => {
        previewFocusUpdateTimer = 0;
        updatePreview();
      }, 120);
    }


    function previewScopeContainsLine(line) {
      const targetLine = Math.max(1, Number(line) || 1);
      const controller = window.markdownEditorVirtualPreview;
      if (controller?.active && typeof controller.containsLineRange === 'function') {
        return controller.containsLineRange(targetLine, targetLine);
      }
      if (activeResolvedPreviewMode !== 'chapter') return true;
      const chapter = activePreviewFocusChapter;
      return Boolean(chapter && targetLine >= chapter.startLine && targetLine <= chapter.endLine);
    }

    async function focusPreviewLine(line, options = {}) {
      const targetLine = Math.max(1, Number(line) || 1);
      const behavior = options.behavior === 'smooth' ? 'smooth' : 'auto';
      const shouldScroll = options.scroll !== false;
      const requestVersion = ++previewLineFocusVersion;
      const needsScopeRefresh = activeResolvedPreviewMode === 'chapter' && !previewScopeContainsLine(targetLine);

      if (needsScopeRefresh) {
        clearTimeout(previewFocusUpdateTimer);
        previewFocusUpdateTimer = 0;
        clearTimeout(previewUpdateTimer);
        previewUpdateTimer = 0;

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
        if (!anchor && activeResolvedPreviewMode === 'chapter') return false;
        invalidatePreviewAnchorStructure();
      }
      if (shouldScroll) scrollPreviewToLine(targetLine, behavior, 0.5);
      return true;
    }

    function suspendPreviewForHybridMode() {
      clearTimeout(previewUpdateTimer);
      previewUpdateTimer = 0;
      clearTimeout(previewFocusUpdateTimer);
      previewFocusUpdateTimer = 0;
      previewRenderVersion += 1;
      cancelScheduledPreviewEnhancements();
      getPreviewEnhancementQueue()?.begin(previewRenderVersion);
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
      if (previewEnhancementRaf) cancelAnimationFrame(previewEnhancementRaf);
      previewEnhancementRaf = 0;
      if (previewEnhancementIdle?.cancel) previewEnhancementIdle.cancel();
      else if (previewEnhancementIdle && 'cancelIdleCallback' in window) cancelIdleCallback(previewEnhancementIdle);
      else if (previewEnhancementIdle) clearTimeout(previewEnhancementIdle);
      previewEnhancementIdle = 0;
    }

    function schedulePreviewEnhancements(sourceText, blockTokens, renderVersion, sourceAlreadyAnnotated = false, sourceLength = sourceText.length) {
      cancelScheduledPreviewEnhancements();
      previewEnhancementRaf = requestAnimationFrame(() => {
        previewEnhancementRaf = 0;
        if (renderVersion !== previewRenderVersion) return;
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

        const finish = () => {
          previewEnhancementIdle = 0;
          if (renderVersion !== previewRenderVersion) return;
          const started = performance.now();
          if (previewLayoutStatePort.sidebarVisible && activeSidebarTab === 'outline') renderOutline();
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
        };
        if (sourceLength >= LARGE_DOCUMENT_CHARS) {
          const scheduler = window.markdownEditorTaskScheduler;
          if (scheduler?.schedule) {
            previewEnhancementIdle = scheduler.schedule('preview-postprocess', ({ signal }) => {
              if (!signal.aborted) finish();
            }, { priority: 'background', timeout: 260 });
          } else if ('requestIdleCallback' in window) {
            previewEnhancementIdle = requestIdleCallback(finish, { timeout: 260 });
          } else {
            previewEnhancementIdle = setTimeout(finish, 32);
          }
        } else {
          finish();
        }
      });
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
    let activeResolvedPreviewMode = 'full';
    let activePreviewScopeKey = '';
    let previewWorkerFailureNotified = false;

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
            const chapter = activePreviewFocusChapter;
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

    function getChapterPreviewResult(result) {
      const chapter = result?.focusChapter;
      const blocks = result?.blocks || [];
      if (!chapter || !blocks.length) return result;
      const chapterStartIndex = Math.max(0, Math.min(blocks.length - 1, Number(chapter.startIndex) || 0));
      const chapterEndIndex = Math.max(
        chapterStartIndex + 1,
        Math.min(blocks.length, Number(chapter.endIndex) || blocks.length)
      );
      let startIndex = chapterStartIndex;
      let endIndex = chapterEndIndex;
      if (endIndex - startIndex < MIN_CHAPTER_PREVIEW_BLOCKS) {
        const missing = MIN_CHAPTER_PREVIEW_BLOCKS - (endIndex - startIndex);
        startIndex = Math.max(0, startIndex - Math.ceil(missing / 2));
        endIndex = Math.min(blocks.length, Math.max(chapterEndIndex, startIndex + MIN_CHAPTER_PREVIEW_BLOCKS));
        startIndex = Math.max(0, Math.min(startIndex, endIndex - MIN_CHAPTER_PREVIEW_BLOCKS));
      }
      const chapterBlocks = blocks.slice(startIndex, endIndex);
      const chapterIds = new Set(chapterBlocks.map(block => block.id));
      return {
        ...result,
        blocks: chapterBlocks,
        changedIds: new Set([...(result.changedIds || [])].filter(id => chapterIds.has(id))),
        removedIds: new Set(result.removedIds || []),
        previewScopeKey: `chapter:${chapter.headingId || chapter.startLine || chapterStartIndex}:${chapter.endLine || chapterEndIndex}:${startIndex}-${endIndex}`
      };
    }

    function resolvePreviewRenderResult(result, sourceLength) {
      const blockCount = result?.blocks?.length || 0;
      const mode = resolvePreviewPerformanceMode(sourceLength, blockCount);
      if (mode === 'chapter') {
        return { mode, result: getChapterPreviewResult(result) };
      }
      return { mode, result };
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
      if (scheduler?.schedule) scheduler.schedule('preview-prewarm', run, { priority: 'idle', timeout: 700 });
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
      clearTimeout(previewFocusUpdateTimer);
      previewFocusUpdateTimer = 0;
      activePreviewFocusChapter = null;
      activeResolvedPreviewMode = 'full';
      activePreviewScopeKey = '';
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
      clearTimeout(previewUpdateTimer);
      previewUpdateTimer = 0;
      const renderVersion = ++previewRenderVersion;
      getPreviewEnhancementQueue()?.begin(renderVersion);
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
      const requestedPreviewMode = normalizePreviewPerformanceMode(previewPerformanceMode);
      const hybridMode = typeof isHybridLayoutMode === 'function' && isHybridLayoutMode();
      const useWorker = (hybridMode || sourceLength >= 100000 || requestedPreviewMode === 'virtual' || requestedPreviewMode === 'chapter')
        && Boolean(window.createPreviewWorkerClient);

      try {
        if (useWorker) {
          const client = getPreviewWorkerClient();
          modelResult = await client.update(documentModel || editor, getSourceText, forceFullRebuild, {
            indexOnly: hybridMode
          });
          if (modelResult?.cancelled || renderVersion !== previewRenderVersion) return;
          workerDurationMs = modelResult.workerDurationMs || 0;
          previewWorkerFailureNotified = false;
          blockTokens = modelResult.tokens || [];
          incrementalPreviewModel?.reset();
        } else if (typeof marked !== 'undefined' && typeof marked.lexer === 'function' && window.IncrementalPreviewModel) {
          if (!incrementalPreviewModel) incrementalPreviewModel = new window.IncrementalPreviewModel(marked.lexer.bind(marked));
          modelResult = incrementalPreviewModel.update(getSourceText(), { forceFull: forceFullRebuild });
          blockTokens = modelResult.tokens;
        }

        if (modelResult) {
          previewReferenceDefinitions = String(modelResult.referenceDefinitions || '');
          activePreviewFocusChapter = modelResult.focusChapter || null;
          getPreviewEnhancementQueue()?.setPriorityRange(activePreviewFocusChapter);
          updateDocumentStatistics(modelResult.statistics);
          const headingVersion = modelResult.documentVersion ?? documentModel?.getDocumentVersion?.() ?? editor.virtualEditor?.getDocumentVersion?.();
          if (Array.isArray(modelResult.headings)) {
            const headingIndexChanged = updateHeadingCacheFromWorkerIndex(
              modelResult.headings,
              headingVersion,
              modelResult.headingIndexChanged
            );
            if (headingIndexChanged) persistCurrentDocumentIndex(modelResult.headings, modelResult.statistics);
          } else {
            updateHeadingCacheFromPreviewBlocks(modelResult.blocks, headingVersion);
          }

          const indexedSourceLength = Number(modelResult.statistics?.characters) || 0;
          const resolved = resolvePreviewRenderResult(modelResult, Math.max(sourceLength, indexedSourceLength));
          const renderResult = resolved.result;
          const nextScopeKey = resolved.mode === 'chapter'
            ? (renderResult?.previewScopeKey || 'chapter:document')
            : resolved.mode;
          const previewScopeChanged = resolved.mode !== activeResolvedPreviewMode || nextScopeKey !== activePreviewScopeKey;
          const previousScopeKey = activePreviewScopeKey;
          activeResolvedPreviewMode = resolved.mode;
          activePreviewScopeKey = nextScopeKey;
          if (previewScopeChanged && resolved.mode === 'chapter' && previousScopeKey && previousScopeKey !== nextScopeKey) {
            window.markdownEditorScrollSync?.markProgrammaticScroll?.('preview', 420);
            window.markdownEditorScrollSync?.suspend?.(320);
            preview.scrollTop = 0;
          }

          if (modelResult.reason === 'unchanged' && !forceFullRebuild && !previewScopeChanged) {
            virtualPreviewController?.refreshRenderData?.(renderResult);
            const body = preview.querySelector('.markdown-body');
            if (body && !body.classList.contains('preview-loading')) {
              const pendingMermaidRoots = collectPendingMermaidRoots(body);
              patchResult = {
                body,
                changedNodes: pendingMermaidRoots,
                reused: virtualPreviewController?.active
                  ? virtualPreviewController.getStats().mountedBlocks
                  : body.children.length,
                parsedChars: 0,
                mode: pendingMermaidRoots.length ? 'unchanged-enhancement-retry' : 'unchanged',
                virtualized: Boolean(virtualPreviewController?.active),
                blockCount: renderResult.blocks?.length || 0
              };
              sourceAlreadyAnnotated = true;
              // A Mermaid job may be cancelled when the user switches layouts while
              // the async renderer is running. The Markdown model is still unchanged,
              // but the connected <pre> remains pending and must be enqueued again.
              skipEnhancements = pendingMermaidRoots.length === 0;
            }
          } else if (modelResult.wholeDocument && modelResult.wholeHtml && resolved.mode === 'full') {
            disableVirtualPreview();
            patchResult = patchPreviewBody(modelResult.wholeHtml, forceFullRebuild || previewScopeChanged);
            patchResult.parsedChars = modelResult.parsedChars;
            patchResult.mode = 'worker-whole-document';
            patchResult.blockCount = modelResult.blocks?.length || patchResult.body.children.length;
          } else if (resolved.mode === 'virtual' || resolved.mode === 'chapter') {
            const controller = getVirtualPreviewController();
            controller.setCacheContext?.(previewDocumentSessionPort.activeId, getPreviewHeightCacheVisualKey());
            patchResult = controller.update(renderResult, {
              forceAll: forceFullRebuild || previewScopeChanged,
              scope: resolved.mode,
              createNodes: createPreviewNodesForBlock,
              applySourceRange: applyPreviewBlockSourceRange,
              onNodesMounted(nodes, mountInfo) {
                enhancePreviewNodes(nodes, mountInfo.changedNodes);
                previewAnchorsCache = controller.getMountedAnchors();
                invalidatePreviewAnchorMetrics();
              },
              onPrewarmNeeded: prewarmPreviewBlocks
            });
            patchResult.mode = resolved.mode === 'chapter'
              ? 'worker-chapter-preview'
              : patchResult.mode;
            sourceAlreadyAnnotated = true;
          } else {
            disableVirtualPreview();
            patchResult = patchIncrementalPreview(renderResult, forceFullRebuild || previewScopeChanged);
            patchResult.blockCount = renderResult.blocks?.length || 0;
            sourceAlreadyAnnotated = true;
          }
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
        if (workerFailed && !previewWorkerFailureNotified) {
          previewWorkerFailureNotified = true;
          showToast('后台预览暂时不可用，已启用安全降级');
        }
      }

      if (renderVersion !== previewRenderVersion) return;

      if (hybridMode) {
        cancelScheduledPreviewEnhancements();
        activeResolvedPreviewMode = 'hybrid';
        activePreviewScopeKey = 'hybrid';
        const badge = document.getElementById('preview-strategy-badge');
        if (badge) badge.hidden = true;
        document.body.dataset.previewPerformanceMode = 'hybrid';
        if (previewLayoutStatePort.sidebarVisible && activeSidebarTab === 'outline' && outlineDirty) renderOutline();
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

      if (!patchResult && workerFailed && sourceLength >= ULTRA_LARGE_DOCUMENT_CHARS) {
        const body = preview.querySelector('.markdown-body');
        if (body && !body.classList.contains('preview-loading')) {
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
        activeResolvedPreviewMode = resolvePreviewPerformanceMode(sourceLength, patchResult.blockCount);
        sourceAlreadyAnnotated = true;
        skipEnhancements = true;
      }

      if (!patchResult) {
        disableVirtualPreview();
        activeResolvedPreviewMode = 'full';
        activePreviewScopeKey = 'full';
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
      updatePreviewStrategyBadge(activeResolvedPreviewMode, {
        blockCount: patchResult.blockCount ?? patchResult.body.children.length,
        mountedBlocks: virtualStats?.mountedBlocks ?? patchResult.body.children.length
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
          resolvedPreviewMode: activeResolvedPreviewMode
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
