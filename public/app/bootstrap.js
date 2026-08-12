const bootstrapCompatibilityHost = document.getElementById('compatibility-business-ports');
const bootstrapHelpPort = bootstrapCompatibilityHost?.markdownEditorHelpPort;
const bootstrapSettingsStorePort = bootstrapCompatibilityHost?.markdownEditorSettingsStorePort;
const bootstrapEditorControllerPort = bootstrapCompatibilityHost?.markdownEditorEditorControllerPort;
const bootstrapLayoutStatePort = bootstrapCompatibilityHost?.markdownEditorLayoutStatePort;
if (!bootstrapHelpPort) throw new Error('Help compatibility port is unavailable.');
if (!bootstrapSettingsStorePort) throw new Error('Settings Store compatibility port is unavailable.');
if (!bootstrapEditorControllerPort) throw new Error('Editor Controller compatibility port is unavailable.');
if (!bootstrapLayoutStatePort) throw new Error('Layout State compatibility port is unavailable.');

    async function init() {
      const restoredSettings = bootstrapSettingsStorePort.snapshot;

      // 每次启动都建立新的会话文档。上次打开的外部路径仅迁移到“最近打开”，
      // 不再先恢复旧正文或文档元数据，避免侧栏历史和后台快照重新进入当前会话。
      bootstrapEditorControllerPort.setText('');
      filenameInput.value = t('filenameDefault');
      bootstrapLayoutStatePort.sidebarVisible = restoredSettings.sidebarVisible;
      loadRecentFiles();
      renderRecentFilesMenu();
      autoSaveEnabled = restoredSettings.autoSaveEnabled;
      autoSaveDelay = normalizeAutoSaveDelay(restoredSettings.autoSaveDelay);
      editorFontSize = restoredSettings.editorFontSize;
      editorTextColor = restoredSettings.editorTextColor;
      activeLineColor = restoredSettings.activeLineColor;
      exportDirectory = restoredSettings.exportDirectory;
      toolbarVisible = restoredSettings.toolbarVisible;
      toolbarHiddenItems = new Set(restoredSettings.toolbarHiddenItems);
      previewPerformanceMode = restoredSettings.previewPerformanceMode;
      tableVisualEditingEnabled = restoredSettings.tableVisualEditing;
      codeVisualEditingEnabled = restoredSettings.codeVisualEditing;
      applyEditorPreferences();
      applyTableVisualEditingSetting({ persist: false, notify: false });
      applyCodeVisualEditingSetting({ persist: false, notify: false });
      await setupDocuments();
      updateStatusBar();
      previewMode = 'preview';
      localStorage.setItem(PREVIEW_MODE_KEY, 'preview');

      updateLargeDocumentMode();
      if (editor.textLength >= LARGE_DOCUMENT_CHARS) {
        preview.innerHTML = '<div class="markdown-body preview-loading">正在生成实时预览…</div>';
      }
      updateCount();
      setPreviewMode(previewMode, true);


      // 恢复用户选择的布局；单视图模式复用同一 CodeMirror 文档状态。
      const savedLayoutMode = restoredSettings.layoutMode;
      if (['both', 'hybrid', 'edit', 'preview'].includes(savedLayoutMode)) {
        setLayoutMode(savedLayoutMode, false, false);
      } else {
        setLayoutMode('both', false);
      }
      initializePreviewLayoutObserver?.();
      if (!bootstrapLayoutStatePort.previewCollapsed && !isHybridLayoutMode()) {
        refreshPreviewAfterLayout?.({ forceRender: true, reason: 'startup-layout' });
      }


      bootstrapHelpPort.openFirstRun();
      refreshClassicLocalizedState();
    }

    // 渲染预览。大文档输入时由 schedulePreviewUpdate 合并频繁刷新；
    // Markdown 只词法解析一次，渲染和源码块标注复用同一份 token。