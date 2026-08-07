    const eventsPlatformPort = document.getElementById('compatibility-business-ports')?.markdownEditorPlatformPort;

    editor.addEventListener('input', () => {
      ensureCurrentDocumentForEditing();
      if (!editor.virtualEditor) {
        clearTimeout(historyTimer);
        historyTimer = setTimeout(recordHistory, 400);
      }
      editorLineIndexText = null;
      editorMetricText = null;
      cachedHeadingSource = null;
      if (!editor.virtualEditor) outlineDirty = true;
      updateLargeDocumentMode();
      scheduleEditorMetricsRebuild(120);
      schedulePreviewUpdate();
      scheduleCountUpdate();
      autoSave();
      updateInlineColorToolAvailability();
    });
    editor.addEventListener('select', () => {
      schedulePreviewFocusUpdate();
      updateInlineColorToolAvailability();
    });
    previewSource.addEventListener('input', () => {
      // 保留隐藏 textarea 仅作旧环境兼容；虚拟编辑器不复制百万字全文。
      if (!editor.virtualEditor) previewSource.value = editor.value;
      else previewSource.value = '';
    });
    filenameInput.addEventListener('input', () => {
      documentModel?.updateTitle?.(filenameInput.value);
      autoSave();
      setTimeout(renderDocumentList, 550);
    });

    const linkUrlInput = document.getElementById('link-url-input');
    linkUrlInput?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      confirmLinkInsert();
    });

    function bindCompactPaneActivation(selector, pane) {
      document.querySelector(selector)?.addEventListener('click', event => {
        if (!compactSplitActive || event.target.closest('.collapse-btn')) return;
        const isCollapsed = pane === 'editor' ? editorCollapsed : previewCollapsed;
        if (isCollapsed) activateCompactSplitPane(pane, `collapsed-${pane}-click`);
      });
    }
    bindCompactPaneActivation('.editor-pane', 'editor');
    bindCompactPaneActivation('.preview-pane', 'preview');

    function applyWindowMaximizedState(isMaximized) {
      const maximizeButton = document.getElementById('window-maximize-btn');
      if (!maximizeButton) return;
      const maximizeUse = maximizeButton.querySelector('use');
      const maximized = Boolean(isMaximized);
      maximizeButton.dataset.maximized = maximized ? 'true' : 'false';
      maximizeButton.title = maximized ? '还原窗口' : '最大化';
      maximizeButton.setAttribute('aria-label', maximized ? '还原窗口' : '最大化');
      if (maximizeUse) maximizeUse.setAttribute('href', maximized ? '/assets/icons.svg#icon-restore' : '/assets/icons.svg#icon-maximize');
      document.documentElement.classList.toggle('window-maximized', maximized);
    }

    async function refreshWindowChromeState() {
      if (!eventsPlatformPort?.supports('desktop.window')) return;
      try {
        applyWindowMaximizedState(await eventsPlatformPort.call('window', 'isMaximized'));
      } catch (error) {
        console.warn('Failed to refresh window state:', error);
      }
    }

    function setupWindowChrome() {
      const controls = document.getElementById('window-controls');
      if (!controls) return;
      if (!eventsPlatformPort?.supports('desktop.window')) {
        controls.hidden = true;
        document.documentElement.classList.remove('tauri-shell');
        return;
      }
      controls.hidden = false;
      const menuBar = document.querySelector('.menu-bar');
      const minimizeButton = document.getElementById('window-minimize-btn');
      const maximizeButton = document.getElementById('window-maximize-btn');
      const closeButton = document.getElementById('window-close-btn');

      menuBar?.addEventListener('mousedown', async event => {
        if (event.buttons !== 1) return;
        if (event.target instanceof Element && event.target.closest('.menu-dropdown, .window-controls, button, input, select, textarea, a, [role="button"]')) return;
        try {
          if (event.detail === 2) {
            const maximized = await eventsPlatformPort.call('window', 'toggleMaximize');
            applyWindowMaximizedState(maximized);
          } else {
            await eventsPlatformPort.call('window', 'startDrag');
          }
        } catch (error) {
          console.warn('Window drag failed:', error);
        }
      });

      minimizeButton?.addEventListener('click', async () => {
        try {
          await eventsPlatformPort.call('window', 'minimize');
        } catch (error) {
          showToast(error?.message || String(error));
        }
      });

      maximizeButton?.addEventListener('click', async () => {
        try {
          const maximized = await eventsPlatformPort.call('window', 'toggleMaximize');
          applyWindowMaximizedState(maximized);
        } catch (error) {
          showToast(error?.message || String(error));
        }
      });

      closeButton?.addEventListener('click', async () => {
        try {
          if (windowCloseSaving) return;
          windowCloseSaving = true;
          clearTimeout(saveTimer);
          await saveCurrentDocumentState(false, { waitForNative: true, forceSnapshot: true });
          await commitWindowClose();
        } catch (error) {
          windowCloseSaving = false;
          const message = recordDocumentOperationError('close-save', error);
          const exitAnyway = await confirmUserAction('关闭前保存失败：' + message + '\n\n仍然关闭软件吗？未保存的修改可能丢失。', {
            title: '关闭前保存失败',
            kind: 'warning',
            okLabel: '仍然关闭',
            cancelLabel: '返回编辑'
          });
          if (exitAnyway) await commitWindowClose();
        }
      });

      if (eventsPlatformPort?.supports('desktop.window')) {
        Promise.resolve(eventsPlatformPort.call('window', 'subscribeResize', () => {
          refreshWindowChromeState();
        })).catch(error => {
          console.warn('Failed to register window resize listener:', error);
        });
      }

      refreshWindowChromeState();
    }

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
          const content = await eventsPlatformPort.call('files', 'readText', resolvedPath);
          const opened = await loadTextContentAsDocument(name, content || '', resolvedPath);
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

    let windowCloseCommitted = false;
    let windowCloseSaving = false;

    async function commitWindowClose() {
      windowCloseCommitted = true;
      try {
        await eventsPlatformPort.call('window', 'requestClose');
        return;
      } catch (closeError) {
        try {
          await eventsPlatformPort.call('window', 'forceClose');
        } catch (destroyError) {
          windowCloseCommitted = false;
          windowCloseSaving = false;
          const message = destroyError?.message || closeError?.message || String(destroyError || closeError);
          console.error('Window close failed:', closeError, destroyError);
          window.markdownEditorPerf?.record?.('window.close-error', {
            category: 'app.lifecycle',
            status: 'error',
            details: { message }
          });
          showToast('关闭窗口失败：' + message);
        }
      }
    }

    if (eventsPlatformPort?.supports('desktop.window')) {
      Promise.resolve(eventsPlatformPort.call('window', 'subscribeCloseRequest', async event => {
        if (windowCloseCommitted) return;
        event.preventDefault();
        if (windowCloseSaving) return;
        windowCloseSaving = true;
        clearTimeout(saveTimer);
        try {
          await saveCurrentDocumentState(false, { waitForNative: true, forceSnapshot: true });
          await commitWindowClose();
        } catch (error) {
          windowCloseSaving = false;
          const message = recordDocumentOperationError('close-save', error);
          const exitAnyway = await confirmUserAction('关闭前保存失败：' + message + '\n\n仍然关闭软件吗？未保存的修改可能丢失。', {
            title: '关闭前保存失败',
            kind: 'warning',
            okLabel: '仍然关闭',
            cancelLabel: '返回编辑'
          });
          if (exitAnyway) await commitWindowClose();
        }
      })).catch(error => {
        console.warn('Failed to register close handler:', error);
        window.markdownEditorPerf?.record?.('window.close-handler-error', {
          category: 'app.lifecycle',
          status: 'error',
          details: { message: error?.message || String(error) }
        });
      });
    }

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
      const headingDropdown = document.getElementById('heading-dropdown');
      if (headingDropdown && !headingDropdown.contains(e.target)) {
        closeHeadingMenu();
      }
      const viewDropdown = document.getElementById('view-dropdown');
      if (viewDropdown && !viewDropdown.contains(e.target)) {
        closeViewMenu();
      }
      const tableDropdown = document.getElementById('table-dropdown');
      if (tableDropdown && !tableDropdown.contains(e.target)) {
        closeTableMenu();
      }
      const langDropdown = document.getElementById('lang-dropdown');
      if (langDropdown && !langDropdown.contains(e.target)) {
        closeLangMenu();
      }
      if (!e.target.closest('.color-dropdown')) {
        closeInlineColorMenus();
      }
    });

    // 全屏状态监听
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    // 快捷键
    function isEditorShortcutTarget(target) {
      return target === previewSource || target === editor || Boolean(editor?.contains?.(target));
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
        else if (key === ',') action = openSettings;
        else if (key === 'b' && e.shiftKey) action = toggleSidebar;
        else if (!outsideTextControl && key === 'z' && e.shiftKey) action = redo;
        else if (!outsideTextControl && key === 'y') action = redo;
        else if (!outsideTextControl && key === 'z') action = undo;
        else if (!outsideTextControl && key === 'k' && e.shiftKey) action = openImageModal;
        else if (!outsideTextControl && key === 'b') action = formatBold;
        else if (!outsideTextControl && key === 'u') action = formatUnderline;
        else if (!outsideTextControl && key === 'i') action = formatItalic;
        else if (!outsideTextControl && key === 'k') action = insertLink;
        else if (!outsideTextControl && key === 'f') action = () => openFindModal(false);
        else if (!outsideTextControl && key === 'h') action = () => openFindModal(true);
      } else if (key === 'f2') {
        action = renameCurrentDocument;
      } else if (key === 'f11') {
        action = togglePageFullscreen;
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
        const el = getActiveEditor();
        const start = el.selectionStart;
        const end = el.selectionEnd;
        el.setRangeText('    ', start, end, 'end');
        syncEditorFromActive();
        updatePreview();
        updateCount();
      }
    }
    document.addEventListener('keydown', handleAppKeydown, true);

    // 启动
    setupWindowChrome();
    initializeAppSubmenus();
    updateInlineColorToolAvailability();
    window.__markdownEditorInitPromise = init().then(async () => {
      updateInlineColorToolAvailability();
      const initialPath = eventsPlatformPort?.supports('desktop.fileSystem')
        ? await eventsPlatformPort.call('files', 'getInitialPath')
        : null;
      if (initialPath) await handleNativeDroppedPath(initialPath);
    }).catch(error => {
      console.error('Application initialization failed:', error);
      showToast(error?.message || String(error));
      throw error;
    });
