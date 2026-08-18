    const eventsCompatibilityHost = document.getElementById('compatibility-business-ports');
    const eventsPlatformPort = eventsCompatibilityHost?.markdownEditorPlatformPort;
    const eventsDocumentControllerPort = eventsCompatibilityHost?.markdownEditorDocumentControllerPort;
    const eventsEditorControllerPort = eventsCompatibilityHost?.markdownEditorEditorControllerPort;
    const eventsEditorUiCommandPort = eventsCompatibilityHost?.markdownEditorEditorUiCommandPort;
    const eventsAutosaveControllerPort = eventsCompatibilityHost?.markdownEditorAutosaveControllerPort;
    const eventsLayoutStatePort = eventsCompatibilityHost?.markdownEditorLayoutStatePort;
    const eventsPreviewCommandPort = eventsCompatibilityHost?.markdownEditorPreviewCommandPort;
    if (!eventsDocumentControllerPort) throw new Error('Document controller compatibility port is unavailable.');
    if (!eventsEditorControllerPort) throw new Error('Editor Controller compatibility port is unavailable.');
    if (!eventsEditorUiCommandPort) throw new Error('Editor UI command compatibility port is unavailable.');
    if (!eventsAutosaveControllerPort) throw new Error('Autosave Controller compatibility port is unavailable.');
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
      eventsAutosaveControllerPort.schedule({ reason: 'editor-transaction' });
    });
    eventsEditorUiCommandPort.register({
      selectionChanged: () => eventsPreviewCommandPort.scheduleFocusUpdate()
    });





    // 拖放文件打开
    const dropOverlay = document.getElementById('drop-overlay');
    let dragCounter = 0;

    function showDropOverlay() {
      if (dropOverlay) dropOverlay.classList.add('show');
    }

    function hideDropOverlay() {
      if (dropOverlay) dropOverlay.classList.remove('show');
    }

    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      showDropOverlay();
    });

    document.addEventListener('dragleave', (e) => {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        hideDropOverlay();
      }
    });

    document.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      hideDropOverlay();
      if (eventsPlatformPort?.supports('desktop.dragDrop')) return;
      const files = e.dataTransfer.files;
      if (!files.length) return;
      const file = files[0];
      const ext = file.name.split('.').pop().toLowerCase();

      const allowedText = ['md', 'markdown', 'txt'];
      if (allowedText.includes(ext)) {
        loadFile(file);
        return;
      }

      if (file.type.startsWith('image/')) {
        if (file.size > 5 * 1024 * 1024) {
          showToast(t('toastImageTooLarge'));
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          insertImageMarkdown(file.name, ev.target.result);
          showToast(t('toastImageInserted'));
        };
        reader.readAsDataURL(file);
        return;
      }

      showToast(t('toastDropUnsupported'));
    });

    async function handleNativeDroppedPath(path) {
      const resolvedPath = String(path || '').trim();
      if (!resolvedPath || !eventsPlatformPort?.supports('desktop.fileSystem')) return false;
      const name = getFileNameFromPath(resolvedPath);
      const ext = String(name.split('.').pop() || '').toLowerCase();
      try {
        if (['md', 'markdown', 'txt'].includes(ext)) {
          const opened = await loadDocumentFromContentLoader(
            name,
            () => eventsPlatformPort.call('files', 'readText', resolvedPath),
            resolvedPath,
            { nativePath: resolvedPath }
          );
          if (opened) addRecentFile(resolvedPath, name);
          return opened;
        }
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
          const dataUrl = await eventsPlatformPort.call('files', 'readImage', resolvedPath, '');
          insertImageMarkdown(name, dataUrl);
          showToast(t('toastImageInserted'));
          return true;
        }
        showToast(t('toastDropUnsupported'));
        return false;
      } catch (err) {
        showToast(err?.message || String(err));
        return false;
      }
    }

    if (eventsPlatformPort?.supports('desktop.dragDrop')) {
      Promise.resolve(eventsPlatformPort.call('dragDrop', 'subscribe', async payload => {
        if (payload?.type === 'over') {
          showDropOverlay();
          return;
        }
        if (payload?.type === 'drop') {
          hideDropOverlay();
          const path = Array.isArray(payload.paths) ? payload.paths[0] : null;
          if (path) await handleNativeDroppedPath(path);
          return;
        }
        hideDropOverlay();
      })).catch(err => console.warn('Failed to register native drag-drop listener', err));
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
          invokeShortcut(e.shiftKey ? saveAsMarkdown : saveCurrentFile);
        }
        return;
      }
      if (codeBlockEditor) {
        // 代码块深度编辑时保留 textarea 原生撤销；保存前先写回 Markdown。
        if (modifier && key === 's') {
          e.preventDefault();
          e.stopPropagation();
          codeBlockEditor.__markdownEditorCommitCodeBlock?.();
          invokeShortcut(e.shiftKey ? saveAsMarkdown : saveCurrentFile);
        }
        return;
      }
      const outsideTextControl = isTextControlOutsideEditor(e.target);
      let action = null;

      if (modifier) {
        if (key === 's' && e.shiftKey) action = saveAsMarkdown;
        else if (key === 's') action = saveCurrentFile;
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
