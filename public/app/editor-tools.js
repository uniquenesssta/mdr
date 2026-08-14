const editorToolsCompatibilityHost = document.getElementById('compatibility-business-ports');
const editorToolsSettingsStorePort = editorToolsCompatibilityHost?.markdownEditorSettingsStorePort;
const editorToolsEditorUiCommandPort = editorToolsCompatibilityHost?.markdownEditorEditorUiCommandPort;
const editorToolsLayoutStatePort = editorToolsCompatibilityHost?.markdownEditorLayoutStatePort;
const editorToolsSplitControllerPort = editorToolsCompatibilityHost?.markdownEditorSplitControllerPort;
const editorToolsPreviewStatePort = editorToolsCompatibilityHost?.markdownEditorPreviewStatePort;
if (!editorToolsSettingsStorePort) throw new Error('Settings Store compatibility port is unavailable.');
if (!editorToolsEditorUiCommandPort) throw new Error('Editor UI command compatibility port is unavailable.');
if (!editorToolsLayoutStatePort) throw new Error('Layout State compatibility port is unavailable.');
if (!editorToolsSplitControllerPort) throw new Error('Split Controller compatibility port is unavailable.');
if (!editorToolsPreviewStatePort) throw new Error('Preview State compatibility port is unavailable.');
editorToolsEditorUiCommandPort.register({
  getLayoutMode: () => getLayoutMode(),
  setLayoutMode: mode => setLayoutMode(mode)
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

    // 视图布局与全屏
    function getLayoutMode() {
      return editorToolsLayoutStatePort.layoutMode;
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
      const previewWasHidden = editorToolsLayoutStatePort.previewCollapsed || previousMode === 'hybrid';
      let nextMode = ['both', 'hybrid', 'edit', 'preview'].includes(mode) ? mode : 'both';
      if (nextMode === 'hybrid' && !editor.virtualEditor?.setPresentationMode) nextMode = 'edit';
      if (persist) editorToolsSettingsStorePort.set('layoutMode', nextMode);
      editorToolsLayoutStatePort.layoutMode = nextMode;

      if (editorToolsEditorUiCommandPort.has('refreshToolbarLayoutLabel')) {
        editorToolsEditorUiCommandPort.invoke('refreshToolbarLayoutLabel', nextMode);
      }

      const involvesHybridMode = previousMode === 'hybrid' || nextMode === 'hybrid';
      const documentLength = documentModel?.getTextLength?.() ?? editor.textLength;
      const shouldAnimate = animate && !involvesHybridMode && documentLength < LARGE_DOCUMENT_CHARS;
      const commit = () => {
        applyEditorPresentationMode(nextMode);
        editorToolsSplitControllerPort.applyMode(nextMode, {
          resetCompactPane: previousMode !== 'both' && nextMode === 'both'
        });
      };
      if (shouldAnimate) runLayoutTransition(commit, 'panes');
      else commit();

      if (nextMode === 'hybrid') {
        schedulePreviewUpdate();
      } else if (!editorToolsLayoutStatePort.previewCollapsed) {
        const previewBody = preview.querySelector('.markdown-body');
        refreshPreviewAfterLayout?.({
          forceRender: previewWasHidden
            || !editorToolsPreviewStatePort.snapshot.lastStableResult
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

    // Temporary Stage 6 compatibility wrappers for inline menu handlers.
    // Atomic 6.10 removes these together with the remaining inline menu ownership.
    function togglePageFullscreen() {
      return editorToolsEditorUiCommandPort.invoke('togglePageFullscreen');
    }

    function toggleFullscreen() {
      return editorToolsEditorUiCommandPort.invoke('toggleSystemFullscreen');
    }

    // 网页转 Markdown 模态框
