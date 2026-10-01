    const eventsCompatibilityHost = document.getElementById('compatibility-business-ports');
    const eventsPlatformPort = eventsCompatibilityHost?.markdownEditorPlatformPort;
    const eventsFileImportPort = eventsCompatibilityHost?.markdownEditorFileImportPort;
    if (!eventsFileImportPort) throw new Error('File Import compatibility port is unavailable.');
    const eventsDropImportPort = eventsCompatibilityHost?.markdownEditorDropImportPort;
    if (!eventsDropImportPort) throw new Error('Drop Import compatibility port is unavailable.');
    const eventsDocumentControllerPort = eventsCompatibilityHost?.markdownEditorDocumentControllerPort;
    const eventsEditorControllerPort = eventsCompatibilityHost?.markdownEditorEditorControllerPort;
    const eventsEditorUiCommandPort = eventsCompatibilityHost?.markdownEditorEditorUiCommandPort;
    const eventsLayoutStatePort = eventsCompatibilityHost?.markdownEditorLayoutStatePort;
    const eventsPreviewCommandPort = eventsCompatibilityHost?.markdownEditorPreviewCommandPort;
    if (!eventsDocumentControllerPort) throw new Error('Document controller compatibility port is unavailable.');
    if (!eventsEditorControllerPort) throw new Error('Editor Controller compatibility port is unavailable.');
    if (!eventsEditorUiCommandPort) throw new Error('Editor UI command compatibility port is unavailable.');
    if (!eventsLayoutStatePort) throw new Error('Layout State compatibility port is unavailable.');
    if (!eventsPreviewCommandPort) throw new Error('Preview Command compatibility port is unavailable.');

    eventsEditorControllerPort.subscribeTransactions(transaction => {
      if (!transaction.interactive) return;
      ensureCurrentDocumentForEditing();
      editorLineIndexText = null;
      editorMetricText = null;
      updateLargeDocumentMode();
      scheduleEditorMetricsRebuild(120);
      eventsPreviewCommandPort.scheduleUpdate();
      eventsPreviewCommandPort.scheduleCountUpdate();
      eventsEditorUiCommandPort.invoke('requestDocumentPersistence', 'editor-transaction');
    });
    eventsEditorUiCommandPort.register({
      selectionChanged: () => eventsPreviewCommandPort.scheduleFocusUpdate()
    });





    // R13.4 owns event routing; image policy/reading migrate in 13.6/13.7.
    eventsDropImportPort.register({
      openBrowserText: (file, request) => loadFile(file, request),
      openBrowserImage(file, request) {
        const decision = eventsDropImportPort.assessImage(file);
        if (!decision.allowed) {
          showToast(t(decision.reason === 'too-large' ? 'toastImageTooLarge' : 'toastDropUnsupported'));
          return false;
        }
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          const finish = () => { reader.onload = null; reader.onerror = null; reader.onabort = null; };
          reader.onload = event => {
            finish();
            if (!request.isCurrent()) { resolve(false); return; }
            try {
              insertImageMarkdown(file.name, event.target.result);
              showToast(t('toastImageInserted'));
              resolve(true);
            } catch (error) { reject(error); }
          };
          reader.onerror = () => { const error = reader.error || new Error('无法读取所选图片'); finish(); reject(error); };
          reader.onabort = () => { finish(); resolve(false); };
          try { reader.readAsDataURL(file); } catch (error) { finish(); reject(error); }
        });
      },
      async openNativeText(resolvedPath, request) {
        const name = resolvedPath.split(/[\\/]/).pop() || '';
        const opened = await loadDocumentFromContentLoader(
          name,
          async () => {
            const result = await eventsFileImportPort.readPath(resolvedPath);
            if (!request.isCurrent()) throw Object.assign(new Error('文档读取已取消'), { code: 'FILE_IMPORT_CANCELLED' });
            return result.content;
          },
          resolvedPath,
          { nativePath: resolvedPath }
        );
        if (opened && request.isCurrent()) addRecentFile(resolvedPath, name);
        return opened;
      },
      async openNativeImage(resolvedPath, request) {
        const name = resolvedPath.split(/[\\/]/).pop() || '';
        const dataUrl = await eventsPlatformPort.call('files', 'readImage', resolvedPath, '');
        if (!request.isCurrent()) return false;
        insertImageMarkdown(name, dataUrl);
        showToast(t('toastImageInserted'));
        return true;
      },
      unsupported: () => showToast(t('toastDropUnsupported')),
      onError: error => showToast(error?.message || String(error))
    });

    // Existing picker/recent/startup commands share the same path router until 13.13.
    function handleNativeDroppedPath(path) {
      return eventsDropImportPort.openPath(path);
    }

    // Settings menu trigger preserves the legacy menu-close side effect without inline handlers.
    document.querySelector('[data-settings-open]')?.addEventListener('click', closeAppMenus);

    // 点击外部关闭下拉菜单
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) {
        closeContextMenus();
      }
      if (!e.target.closest('.menu-dropdown')) {
        closeAppMenus();
      }
      const exportDropdown = document.getElementById('export-dropdown');
      if (exportDropdown && !exportDropdown.contains(e.target)) {
        closeExportMenu();
      }
      const importDropdown = document.getElementById('import-dropdown');
      if (importDropdown && !importDropdown.contains(e.target)) {
        closeImportMenu();
      }
    });


    // 快捷键
    function isEditorShortcutTarget(target) {
      return target === editor || Boolean(editor?.contains?.(target));
    }

    function isTextControlOutsideEditor(target) {
      if (!(target instanceof Element) || isEditorShortcutTarget(target)) return false;
      return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
    }

    function invokeShortcut(action) {
      try {
        const result = action();
        if (result && typeof result.catch === 'function') {
          result.catch(error => showToast(error?.message || String(error)));
        }
      } catch (error) {
        showToast(error?.message || String(error));
      }
    }

    function handleAppKeydown(e) {
      const tableCellInput = e.target instanceof Element
        ? e.target.closest('[data-hybrid-table-cell-input]')
        : null;
      const codeBlockEditor = e.target instanceof Element
        ? e.target.closest('[data-hybrid-code-editor]')
        : null;
      const key = String(e.key || '').toLowerCase();
      const modifier = e.ctrlKey || e.metaKey;
      if (tableCellInput) {
        // 单元格输入保留浏览器原生文本撤销；保存前先同步当前单元格，
        // 避免 Ctrl/Cmd+S 保存到尚未写回 Markdown 的旧值。
        if (modifier && key === 's') {
          e.preventDefault();
          e.stopPropagation();
          tableCellInput.__markdownEditorCommitTableCell?.();
          invokeShortcut(() => eventsEditorUiCommandPort.invoke(e.shiftKey ? 'saveAsMarkdown' : 'saveCurrentFile'));
        }
        return;
      }
      if (codeBlockEditor) {
        // 代码块深度编辑时保留 textarea 原生撤销；保存前先写回 Markdown。
        if (modifier && key === 's') {
          e.preventDefault();
          e.stopPropagation();
          codeBlockEditor.__markdownEditorCommitCodeBlock?.();
          invokeShortcut(() => eventsEditorUiCommandPort.invoke(e.shiftKey ? 'saveAsMarkdown' : 'saveCurrentFile'));
        }
        return;
      }
      const outsideTextControl = isTextControlOutsideEditor(e.target);
      let action = null;

      if (modifier) {
        if (key === 's' && e.shiftKey) action = () => eventsEditorUiCommandPort.invoke('saveAsMarkdown');
        else if (key === 's') action = () => eventsEditorUiCommandPort.invoke('saveCurrentFile');
        else if (key === 'o') action = triggerImportFile;
        else if (key === 'n') action = newDocument;
        else if (key === 'b' && e.shiftKey) action = toggleSidebar;
        else if (!outsideTextControl && key === 'z' && e.shiftKey) action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'redo');
        else if (!outsideTextControl && key === 'y') action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'redo');
        else if (!outsideTextControl && key === 'z') action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'undo');
        else if (!outsideTextControl && key === 'k' && e.shiftKey) action = () => eventsEditorUiCommandPort.invoke('openImage');
        else if (!outsideTextControl && key === 'b') action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'bold');
        else if (!outsideTextControl && key === 'u') action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'underline');
        else if (!outsideTextControl && key === 'i') action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'italic');
        else if (!outsideTextControl && key === 'k') action = () => eventsEditorUiCommandPort.invoke('openLink');
        else if (!outsideTextControl && key === 'f') action = () => eventsEditorUiCommandPort.invoke('openFind', false);
        else if (!outsideTextControl && key === 'h') action = () => eventsEditorUiCommandPort.invoke('openFind', true);
      } else if (key === 'f2') {
        action = renameCurrentDocument;
      } else if (key === 'f11') {
        action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'page-fullscreen');
      }

      if (action) {
        e.preventDefault();
        e.stopPropagation();
        invokeShortcut(action);
        return;
      }

      if (key === 'tab' && isEditorShortcutTarget(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.setRangeText('    ', start, end, 'end');
      }
    }
    document.addEventListener('keydown', handleAppKeydown, true);

    // 启动
    window.__markdownEditorInitPromise = init().then(async () => {
      const initialPath = eventsPlatformPort?.supports('desktop.fileSystem')
        ? await eventsPlatformPort.call('files', 'getInitialPath')
        : null;
      if (initialPath) await handleNativeDroppedPath(initialPath);
    }).catch(error => {
      console.error('Application initialization failed:', error);
      showToast(error?.message || String(error));
      throw error;
    });
