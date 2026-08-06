    async function init() {
      const savedLang = localStorage.getItem(LANG_KEY);
      if (savedLang && i18n[savedLang]) currentLang = savedLang;

      // 每次启动都建立新的会话文档。上次打开的外部路径仅迁移到“最近打开”，
      // 不再先恢复旧正文或文档元数据，避免侧栏历史和后台快照重新进入当前会话。
      editor.value = '';
      filenameInput.value = t('filenameDefault');
      const theme = localStorage.getItem(THEME_KEY) || 'light';
      document.body.setAttribute('data-theme', theme);

      if (typeof mermaid !== 'undefined') {
        mermaid.initialize({
          startOnLoad: false,
          theme: theme === 'dark' ? 'dark' : 'default'
        });
      }

      const savedRatio = localStorage.getItem(RATIO_KEY);
      if (savedRatio !== null) {
        const parsed = parseFloat(savedRatio);
        if (!isNaN(parsed)) editorRatio = parsed;
      }
      sidebarVisible = localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== 'false';
      sidebarWidth = normalizeSidebarWidth(localStorage.getItem(SIDEBAR_WIDTH_KEY) || 248);
      loadRecentFiles();
      renderRecentFilesMenu();
      activeSidebarTab = localStorage.getItem(SIDEBAR_TAB_KEY) || 'docs';
      autoSaveEnabled = localStorage.getItem(AUTOSAVE_ENABLED_KEY) !== 'false';
      autoSaveDelay = normalizeAutoSaveDelay(localStorage.getItem(AUTOSAVE_DELAY_KEY) || 500);
      editorFontSize = parseInt(localStorage.getItem(EDITOR_FONT_SIZE_KEY) || '16', 10) || 16;
      editorTextColor = normalizeSettingColor(localStorage.getItem(EDITOR_TEXT_COLOR_KEY));
      activeLineColor = normalizeSettingColor(localStorage.getItem(ACTIVE_LINE_COLOR_KEY));
      exportDirectory = String(localStorage.getItem(EXPORT_DIRECTORY_KEY) || '').trim();
      toolbarVisible = localStorage.getItem(TOOLBAR_VISIBLE_KEY) !== 'false';
      toolbarHiddenItems = parseToolbarHiddenItems(localStorage.getItem(TOOLBAR_ITEMS_KEY));
      previewPerformanceMode = normalizePreviewPerformanceMode(localStorage.getItem(PREVIEW_PERFORMANCE_MODE_KEY) || 'auto');
      tableVisualEditingEnabled = localStorage.getItem(TABLE_VISUAL_EDITING_KEY) === 'true';
      codeVisualEditingEnabled = localStorage.getItem(CODE_VISUAL_EDITING_KEY) === 'true';
      parseOutlineCollapsed();
      applyEditorPreferences();
      applyTableVisualEditingSetting({ persist: false, notify: false });
      applyCodeVisualEditingSetting({ persist: false, notify: false });
      await setupDocuments();
      updateStatusBar();
      applySidebarWidth();
      initializeCompactShellLayout?.();
      applySidebarVisibility();
      setSidebarTab(activeSidebarTab);
      editorCollapsed = localStorage.getItem(EDITOR_COLLAPSED_KEY) === 'true';
      previewCollapsed = localStorage.getItem(PREVIEW_COLLAPSED_KEY) === 'true';
      previewMode = 'preview';
      localStorage.setItem(PREVIEW_MODE_KEY, 'preview');

      updateLargeDocumentMode();
      if (editor.textLength >= LARGE_DOCUMENT_CHARS) {
        preview.innerHTML = '<div class="markdown-body preview-loading">正在生成实时预览…</div>';
      }
      updateCount();
      setPreviewMode(previewMode, true);

      // CodeMirror 使用事务历史；仅旧编辑器兼容路径保留全文快照。
      if (editor.virtualEditor) {
        historyStack = [];
        historyIndex = -1;
        lastHistoryText = null;
      } else {
        historyStack = [editor.value];
        historyIndex = 0;
        lastHistoryText = editor.value;
      }

      // 恢复用户选择的布局；单视图模式复用同一 CodeMirror 文档状态。
      const savedLayoutMode = localStorage.getItem(LAYOUT_MODE_KEY);
      if (['both', 'hybrid', 'edit', 'preview'].includes(savedLayoutMode)) {
        setLayoutMode(savedLayoutMode, false);
      } else {
        setLayoutMode('both', false);
      }
      initializePreviewLayoutObserver?.();
      initializeCompactSplitObserver?.();
      if (!previewCollapsed && !isHybridLayoutMode()) {
        refreshPreviewAfterLayout?.({ forceRender: true, reason: 'startup-layout' });
      }
      updateViewMenuLabel();

      // 恢复页面全屏
      if (localStorage.getItem(PAGE_FULLSCREEN_KEY) === 'true') {
        document.querySelector('.app').classList.add('page-fullscreen', 'is-page-fullscreen');
        document.body.classList.add('page-fullscreen-active', 'is-page-fullscreen-active');
      }

      if (!localStorage.getItem(HELP_SHOWN_KEY)) {
        openHelp();
      }
      applyLanguage();
    }

    // 渲染预览。大文档输入时由 schedulePreviewUpdate 合并频繁刷新；
    // Markdown 只词法解析一次，渲染和源码块标注复用同一份 token。
