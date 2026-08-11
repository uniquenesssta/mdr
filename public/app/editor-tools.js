const editorToolsCompatibilityHost = document.getElementById('compatibility-business-ports');
const editorToolsSettingsStorePort = editorToolsCompatibilityHost?.markdownEditorSettingsStorePort;
const editorToolsEditorUiCommandPort = editorToolsCompatibilityHost?.markdownEditorEditorUiCommandPort;
if (!editorToolsSettingsStorePort) throw new Error('Settings Store compatibility port is unavailable.');
if (!editorToolsEditorUiCommandPort) throw new Error('Editor UI command compatibility port is unavailable.');
editorToolsEditorUiCommandPort.register({
  getLayoutMode: () => getLayoutMode(),
  setLayoutMode: mode => setLayoutMode(mode),
  togglePageFullscreen: () => togglePageFullscreen(),
  toggleSystemFullscreen: () => toggleFullscreen()
});

    function updateTableVisualEditingToggle() {
      const item = document.getElementById('table-visual-editing-toggle');
      if (!item) return;
      item.classList.toggle('active', tableVisualEditingEnabled);
      item.setAttribute('aria-checked', tableVisualEditingEnabled ? 'true' : 'false');
      const state = item.querySelector('.menu-inline-switch-state');
      if (state) state.textContent = tableVisualEditingEnabled ? '开' : '关';
    }

    function applyTableVisualEditingSetting(options = {}) {
      const enabled = Boolean(tableVisualEditingEnabled);
      editor.virtualEditor?.setHybridTableVisualEditing?.(enabled);
      updateTableVisualEditingToggle();
      if (options.persist !== false) {
        editorToolsSettingsStorePort.set('tableVisualEditing', enabled);
      }
      if (options.notify !== false) {
        showToast(enabled
          ? '表格深度可视化编辑已开启：双击单元格直接编辑，也可点击“编辑源码”切换源码'
          : '表格深度可视化编辑已关闭：恢复为只读展示与源码切换');
      }
      return enabled;
    }

    function toggleTableVisualEditing(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const nextEnabled = !tableVisualEditingEnabled;
      try {
        editorToolsSettingsStorePort.set('tableVisualEditing', nextEnabled);
      } catch (error) {
        showToast('表格可视化编辑设置保存失败：' + (error?.message || String(error)));
        return;
      }
      tableVisualEditingEnabled = nextEnabled;
      applyTableVisualEditingSetting({ persist: false });
    }

    function updateCodeVisualEditingToggle() {
      const item = document.getElementById('code-visual-editing-toggle');
      if (!item) return;
      item.classList.toggle('active', codeVisualEditingEnabled);
      item.setAttribute('aria-checked', codeVisualEditingEnabled ? 'true' : 'false');
      const state = item.querySelector('.menu-inline-switch-state');
      if (state) state.textContent = codeVisualEditingEnabled ? '开' : '关';
    }

    function applyCodeVisualEditingSetting(options = {}) {
      const enabled = Boolean(codeVisualEditingEnabled);
      editor.virtualEditor?.setHybridCodeVisualEditing?.(enabled);
      updateCodeVisualEditingToggle();
      if (options.persist !== false) {
        editorToolsSettingsStorePort.set('codeVisualEditing', enabled);
      }
      if (options.notify !== false) {
        showToast(enabled
          ? '代码块深度可视化编辑已开启：双击有语言或无语言代码块直接编辑'
          : '代码块深度可视化编辑已关闭：恢复为高亮展示与源码切换');
      }
      return enabled;
    }

    function toggleCodeVisualEditing(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const nextEnabled = !codeVisualEditingEnabled;
      try {
        editorToolsSettingsStorePort.set('codeVisualEditing', nextEnabled);
      } catch (error) {
        showToast('代码块可视化编辑设置保存失败：' + (error?.message || String(error)));
        return;
      }
      codeVisualEditingEnabled = nextEnabled;
      applyCodeVisualEditingSetting({ persist: false });
    }

    // Mermaid 图表
    function collectMermaidCodeBlocks(roots) {
      const blocks = [];
      const seen = new Set();
      const add = code => {
        if (!(code instanceof HTMLElement) || seen.has(code)) return;
        const pre = code.closest('pre');
        if (!(pre instanceof HTMLPreElement) || pre.dataset.mermaidRendering === 'true') return;
        seen.add(code);
        blocks.push(code);
      };
      const searchRoots = Array.isArray(roots) && roots.length ? roots : [preview];
      searchRoots.forEach(root => {
        if (!(root instanceof Element)) return;
        if (root.matches('code.language-mermaid')) add(root);
        if (root.matches('pre')) add(root.querySelector(':scope > code.language-mermaid'));
        root.querySelectorAll?.('pre > code.language-mermaid').forEach(add);
      });
      return blocks;
    }

    function reportMermaidFailure(error, details = {}) {
      const message = error?.message || String(error || 'Mermaid render failed');
      console.error('Mermaid render error:', error);
      window.markdownEditorPerf?.diagnostic?.('preview.mermaid-render-failure', {
        category: 'render.pipeline',
        status: 'error',
        dedupeKey: `preview.mermaid-render-failure:${error?.name || 'Error'}:${details.sourceChars || 0}`,
        minIntervalMs: 3000,
        details: {
          ...details,
          message
        }
      });
    }

    async function renderMermaidBlocks(roots = null, isCancelled = () => false) {
      const presentation = window.markdownEditorPresentation?.mermaid;
      if (!presentation?.renderDiagram) return;
      if (isCancelled()) return;

      const theme = presentation.getTheme?.() || (document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'default');
      const blocks = collectMermaidCodeBlocks(roots);
      if (!blocks.length) return;
      let rendered = 0;
      let failed = 0;
      let cancelled = 0;

      for (const code of blocks) {
        if (isCancelled()) {
          cancelled += 1;
          break;
        }
        const pre = code.closest('pre');
        const source = String(code.textContent || '').trim();
        if (!(pre instanceof HTMLPreElement) || !source) continue;
        pre.dataset.mermaidRendering = 'true';
        pre.classList.remove('preview-mermaid-error');
        delete pre.dataset.mermaidError;

        const container = document.createElement('div');
        container.className = 'mermaid';
        for (const attribute of Array.from(pre.attributes)) {
          if (attribute.name.startsWith('data-') && attribute.name !== 'data-mermaid-rendering') {
            container.setAttribute(attribute.name, attribute.value);
          }
        }

        try {
          const sourceIdentity = Number(pre.dataset.sourceStartIndex);
          const cacheKey = Number.isFinite(sourceIdentity)
            ? `preview:${sourceIdentity}`
            : `preview-line:${Number(pre.dataset.sourceLine) || 0}`;
          const result = await presentation.renderDiagram(container, source, {
            theme,
            cacheKey,
            renderIdPrefix: 'markdown-editor-preview-mermaid',
            ariaLabel: 'Mermaid 图表',
            isCancelled: () => isCancelled() || !pre.isConnected
          });
          if (result.status === 'cancelled' || isCancelled() || !pre.isConnected) {
            delete pre.dataset.mermaidRendering;
            cancelled += 1;
            continue;
          }
          pre.replaceWith(container);
          rendered += 1;
        } catch (error) {
          delete pre.dataset.mermaidRendering;
          pre.classList.add('preview-mermaid-error');
          pre.dataset.mermaidError = 'true';
          failed += 1;
          reportMermaidFailure(error, {
            phase: 'render',
            sourceChars: source.length,
            sourceLine: Number(pre.dataset.sourceLine) || null
          });
        }
      }

      window.markdownEditorPerf?.record?.('preview.mermaid-render-result', {
        category: 'render.pipeline',
        durationMs: null,
        aggregate: true,
        details: { requested: blocks.length, rendered, failed, cancelled, renderer: 'shared' }
      });
    }

    // 视图布局与全屏
    function getLayoutMode() {
      return editorToolsSettingsStorePort.get('layoutMode');
    }

    function isHybridLayoutMode() {
      return getLayoutMode() === 'hybrid';
    }

    function applyEditorPresentationMode(mode) {
      const hybrid = mode === 'hybrid' && Boolean(editor.virtualEditor?.setPresentationMode);
      document.body.classList.toggle('hybrid-view-mode', hybrid);
      editor.virtualEditor?.setPresentationMode?.(hybrid ? 'hybrid' : 'source');
      const actualMode = editor.virtualEditor?.getPresentationMode?.() || 'source';
      if (actualMode !== (hybrid ? 'hybrid' : 'source')) {
        window.markdownEditorPerf?.diagnostic?.('hybrid.presentation-mode-mismatch', {
          category: 'editor.hybrid',
          status: 'error',
          dedupeKey: 'hybrid.presentation-mode-mismatch',
          minIntervalMs: 5000,
          details: {
            requestedMode: hybrid ? 'hybrid' : 'source',
            actualMode,
            layoutMode: mode,
            documentVersion: documentModel?.getDocumentVersion?.() || 0
          }
        });
      }
      const badge = document.getElementById('editor-presentation-badge');
      if (badge) {
        badge.hidden = !hybrid;
        badge.textContent = t('viewHybrid');
      }
      if (hybrid) suspendPreviewForHybridMode?.();
      return hybrid;
    }

    function setLayoutMode(mode, animate = document.documentElement.classList.contains('app-ready'), persist = true) {
      const previousMode = getLayoutMode();
      const previewWasHidden = previewCollapsed || previousMode === 'hybrid';
      let nextMode = ['both', 'hybrid', 'edit', 'preview'].includes(mode) ? mode : 'both';
      if (nextMode === 'hybrid' && !editor.virtualEditor?.setPresentationMode) nextMode = 'edit';
      if (persist) editorToolsSettingsStorePort.set('layoutMode', nextMode);

      if (nextMode === 'edit' || nextMode === 'hybrid') {
        editorCollapsed = false;
        previewCollapsed = true;
      } else if (nextMode === 'preview') {
        editorCollapsed = true;
        previewCollapsed = false;
        if (previewMode !== 'preview') setPreviewMode('preview');
      } else {
        editorCollapsed = false;
        previewCollapsed = false;
      }

      reconcileCompactSplitLayout?.(nextMode, {
        apply: false,
        resetPane: previousMode !== 'both' && nextMode === 'both'
      });

      localStorage.setItem(EDITOR_COLLAPSED_KEY, editorCollapsed ? 'true' : 'false');
      localStorage.setItem(PREVIEW_COLLAPSED_KEY, previewCollapsed ? 'true' : 'false');
      if (editorToolsEditorUiCommandPort.has('refreshToolbarLayoutLabel')) {
        editorToolsEditorUiCommandPort.invoke('refreshToolbarLayoutLabel', nextMode);
      }

      const commit = () => {
        applyEditorPresentationMode(nextMode);
        applyPaneStates(true);
      };
      const involvesHybridMode = previousMode === 'hybrid' || nextMode === 'hybrid';
      const documentLength = documentModel?.getTextLength?.() ?? editor.textLength;
      const shouldAnimate = animate && !involvesHybridMode && documentLength < LARGE_DOCUMENT_CHARS;
      if (shouldAnimate) runLayoutTransition(commit, 'panes');
      else commit();

      if (nextMode === 'hybrid') {
        schedulePreviewUpdate();
      } else if (!previewCollapsed) {
        const previewBody = preview.querySelector('.markdown-body');
        refreshPreviewAfterLayout?.({
          forceRender: previewWasHidden
            || !previewBody
            || previewBody.classList.contains('preview-loading')
            || previewBody.childElementCount === 0,
          reason: `layout:${previousMode}->${nextMode}`
        });
      }
      window.markdownEditorPerf?.record('layout.mode-change', {
        category: 'ui.layout',
        durationMs: 0,
        details: {
          previousMode,
          nextMode,
          presentation: nextMode === 'hybrid' ? 'hybrid' : 'source',
          animated: shouldAnimate,
          documentLength
        }
      });
    }

    function togglePageFullscreen() {
      const app = document.querySelector('.app');
      app.classList.toggle('page-fullscreen');
      app.classList.toggle('is-page-fullscreen');
      const isActive = app.classList.contains('is-page-fullscreen');
      document.body.classList.toggle('page-fullscreen-active', isActive);
      document.body.classList.toggle('is-page-fullscreen-active', isActive);
      localStorage.setItem(PAGE_FULLSCREEN_KEY, isActive ? 'true' : 'false');
      showToast(isActive ? '专注模式已开启：已隐藏工具栏、侧边栏和状态栏' : '专注模式已关闭');
    }

    function toggleFullscreen() {
      if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) {
        showToast(t('toastNoFullscreenApi'));
        return;
      }
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else {
        const el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      }
    }

    function onFullscreenChange() {
      const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
      // Optionally update toolbar state here in the future
    }

    // 网页转 Markdown 模态框
