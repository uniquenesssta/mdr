const coreCompatibilityHost = document.getElementById('compatibility-business-ports');
const corePlatformPort = coreCompatibilityHost?.markdownEditorPlatformPort;
const coreI18nPort = coreCompatibilityHost?.markdownEditorI18nPort;
const coreSettingsStorePort = coreCompatibilityHost?.markdownEditorSettingsStorePort;
const coreDocumentDomainPort = coreCompatibilityHost?.markdownEditorDocumentDomainPort;
const coreDocumentSessionPort = coreCompatibilityHost?.markdownEditorDocumentSessionPort;
const coreDocumentControllerPort = coreCompatibilityHost?.markdownEditorDocumentControllerPort;
const coreRecentFilesPort = coreCompatibilityHost?.markdownEditorRecentFilesPort;
const coreDocumentUiCommandPort = coreCompatibilityHost?.markdownEditorDocumentUiCommandPort;
const coreEditorUiCommandPort = coreCompatibilityHost?.markdownEditorEditorUiCommandPort;
const coreLayoutStatePort = coreCompatibilityHost?.markdownEditorLayoutStatePort;
const coreSidebarControllerPort = coreCompatibilityHost?.markdownEditorSidebarControllerPort;
if (!coreI18nPort) throw new Error('I18n compatibility port is unavailable.');
if (!coreSettingsStorePort) throw new Error('Settings Store compatibility port is unavailable.');
if (!coreDocumentDomainPort) throw new Error('Document domain compatibility port is unavailable.');
if (!coreDocumentSessionPort) throw new Error('Document session compatibility port is unavailable.');
if (!coreDocumentControllerPort) throw new Error('Document controller compatibility port is unavailable.');
if (!coreRecentFilesPort) throw new Error('Recent files compatibility port is unavailable.');
if (!coreDocumentUiCommandPort) throw new Error('Document UI command compatibility port is unavailable.');
if (!coreEditorUiCommandPort) throw new Error('Editor UI command compatibility port is unavailable.');
if (!coreLayoutStatePort) throw new Error('Layout State compatibility port is unavailable.');
if (!coreSidebarControllerPort) throw new Error('Sidebar controller compatibility port is unavailable.');
coreDocumentUiCommandPort.register({
  openDocument: documentId => openDocument(documentId),
  closeDocument: documentId => closeDocument(documentId),
  renameDocument: documentId => renameDocument(documentId),
  duplicateDocument: documentId => duplicateDocument(documentId),
  saveAsDocument: documentId => saveAsContextDocument(documentId),
  exportDocument: documentId => exportContextDocument(documentId),
  copyDocumentTitle: documentId => copyContextDocumentTitle(documentId),
  newDocument: () => newDocument(),
  duplicateActiveDocument: () => duplicateDocument(coreDocumentSessionPort.activeId),
  updateTitleDraft(value) {
    const result = coreDocumentControllerPort.updateActiveTitleDraft(value);
    autoSave();
    syncCurrentDocumentFileTree();
    return result;
  }
});
coreEditorUiCommandPort.register({
  notify: message => showToast(message),
  closeAppMenus: () => closeAppMenus()
});
const editor = document.getElementById('editor');
    const documentModel = window.markdownEditorDocumentModel;
    const preview = document.getElementById('preview');
    const filenameInput = document.getElementById('filename');
    const wordCount = document.getElementById('word-count');
    const saveHint = document.getElementById('save-hint');
    const toast = document.getElementById('toast');

    const PREVIEW_MODE_KEY = 'md_editor_preview_mode';
    const OUTLINE_COLLAPSED_KEY = 'md_editor_outline_collapsed';
    const DOCUMENT_INDEX_KEY_PREFIX = 'md_editor_document_index_v1:';

    let previewMode = 'preview';
    const getSessionDocuments = () => coreDocumentSessionPort.records;
    const getActiveDocumentId = () => coreDocumentSessionPort.activeId;
    let autoSaveEnabled = true;
    let autoSaveDelay = 500;
    let editorFontSize = 16;
    let editorTextColor = '';
    let activeLineColor = '';
    let exportDirectory = '';
    let toolbarVisible = true;
    let toolbarHiddenItems = new Set();
    let contextOutlineId = '';
    let outlineCollapsed = {};
    let previewPerformanceMode = 'auto';
    let tableVisualEditingEnabled = false;
    let codeVisualEditingEnabled = false;
    let cachedHeadings = [];
    let cachedHeadingSource = null;
    let outlineDirty = true;
    coreSidebarControllerPort.registerLifecycle('outline', {
      activate() {
        if (outlineDirty || !cachedHeadings.length) renderOutline();
      },
      deactivate() {}
    });
    let cachedDocumentStatistics = null;
    let selectionSyncLock = false;
    let saveStatusState = 'saved';
    let saveStatusResetTimer = 0;
    const LARGE_DOCUMENT_CHARS = 80000;
    const ULTRA_LARGE_DOCUMENT_CHARS = 400000;
    const VIRTUAL_PREVIEW_BLOCK_THRESHOLD = 1400;
    const AUTOSAVE_MIN_SECONDS = 0.5;
    const AUTOSAVE_MAX_SECONDS = 3600;
    const PREVIEW_PERFORMANCE_MODES = new Set(['auto', 'full', 'virtual', 'chapter']);
    const TOOLBAR_ITEM_IDS = new Set([
      'bold', 'italic', 'underline', 'strikethrough', 'script', 'textColor', 'highlight',
      'heading', 'quote', 'lists', 'code', 'link', 'image', 'table', 'find', 'mermaid'
    ]);

    function loadRecentFiles() {
      coreRecentFilesPort.load();
    }

    function addRecentFile(path, name = '', refresh = true) {
      const result = coreRecentFilesPort.add(path, {
        name,
        fallbackName: '未命名文件'
      });
      if (!result.added) return false;
      if (refresh) renderRecentFilesMenu();
      return true;
    }

    function clearRecentFiles() {
      coreRecentFilesPort.clear();
      renderRecentFilesMenu();
      closeAppMenus();
      showToast('已清空最近打开记录');
    }

    async function openRecentFile(path) {
      closeAppMenus();
      const normalizedPath = coreDocumentDomainPort.normalizeRecentPath(path);
      if (!normalizedPath || typeof handleNativeDroppedPath !== 'function') return;
      const opened = await handleNativeDroppedPath(normalizedPath);
      if (!opened) renderRecentFilesMenu();
    }

    function renderRecentFilesMenu() {
      const menu = document.getElementById('recent-files-menu');
      const menuItem = document.getElementById('recent-files-menu-item');
      if (!menu || !menuItem) return;
      menu.replaceChildren();
      if (!corePlatformPort?.supports('desktop.fileSystem')) {
        menuItem.classList.add('disabled');
        const empty = document.createElement('div');
        empty.className = 'menu-item recent-file-empty';
        empty.textContent = '桌面版可用';
        menu.appendChild(empty);
        return;
      }
      menuItem.classList.remove('disabled');
      const recentFiles = coreRecentFilesPort.entries;
      if (!recentFiles.length) {
        const empty = document.createElement('div');
        empty.className = 'menu-item recent-file-empty';
        empty.textContent = '暂无记录';
        menu.appendChild(empty);
        return;
      }
      for (const item of recentFiles) {
        const button = document.createElement('div');
        button.className = 'menu-item recent-file-item';
        button.title = item.path;
        const label = document.createElement('span');
        label.textContent = item.name || getFileNameFromPath(item.path);
        button.appendChild(label);
        button.addEventListener('click', event => {
          event.stopPropagation();
          openRecentFile(item.path);
        });
        menu.appendChild(button);
      }
      const separator = document.createElement('div');
      separator.className = 'menu-separator';
      menu.appendChild(separator);
      const clear = document.createElement('div');
      clear.className = 'menu-item';
      clear.textContent = '清空记录';
      clear.addEventListener('click', event => {
        event.stopPropagation();
        clearRecentFiles();
      });
      menu.appendChild(clear);
    }

    function normalizePreviewPerformanceMode(value) {
      const mode = String(value || 'auto');
      return PREVIEW_PERFORMANCE_MODES.has(mode) ? mode : 'auto';
    }

    function resolvePreviewPerformanceMode(sourceLength = editor.textLength, blockCount = 0) {
      const requested = normalizePreviewPerformanceMode(previewPerformanceMode);
      if (requested !== 'auto') return requested;
      if (sourceLength >= 1000000 || blockCount >= 12000) return 'chapter';
      if (sourceLength >= ULTRA_LARGE_DOCUMENT_CHARS || blockCount >= VIRTUAL_PREVIEW_BLOCK_THRESHOLD) return 'virtual';
      return 'full';
    }

    function updatePreviewStrategyBadge(mode = 'full', details = {}) {
      const badge = document.getElementById('preview-strategy-badge');
      if (!badge) return;
      const resolved = normalizePreviewPerformanceMode(mode === 'standard' ? 'full' : mode);
      const labels = { full: '完整预览', virtual: '虚拟预览', chapter: '当前章节' };
      const shouldShow = resolved !== 'full' || previewPerformanceMode !== 'auto' || editor.textLength >= 100000;
      badge.hidden = !shouldShow;
      badge.textContent = labels[resolved] || labels.full;
      badge.dataset.mode = resolved;
      const blockCount = Number(details.blockCount) || 0;
      const mountedBlocks = Number(details.mountedBlocks) || 0;
      badge.title = resolved === 'chapter'
        ? '超大文档仅实时预览光标所在章节'
        : resolved === 'virtual'
          ? `全文虚拟预览：${mountedBlocks || 0}/${blockCount || 0} 个块已挂载`
          : '完整实时预览';
      document.body.dataset.previewPerformanceMode = resolved;
    }

    function normalizeAutoSaveDelay(value) {
      const delay = Number(value);
      if (!Number.isFinite(delay)) return 500;
      return Math.min(
        AUTOSAVE_MAX_SECONDS * 1000,
        Math.max(AUTOSAVE_MIN_SECONDS * 1000, Math.round(delay))
      );
    }
    let previewUpdateTimer = 0;
    let previewFocusUpdateTimer = 0;
    let previewLineFocusVersion = 0;
    let previewLineFocusTarget = 0;
    let previewLineFocusPromise = null;
    let activePreviewFocusChapter = null;
    let previewEnhancementRaf = 0;
    let previewEnhancementIdle = 0;
    let previewRenderVersion = 0;
    let previewRenderTheme = '';
    let previewReferenceDefinitions = '';
    let countUpdateTimer = 0;
    let previewBodyResizeObserver = null;
    let observedPreviewBody = null;
    let previewBodyResizeTimer = 0;
    let previewAnchorMetricsCache = null;
    let previewAnchorsCache = null;
    let activeOutlineRow = null;
    let activeOutlineHeadingId = '';

    function t(key, ...args) {
      return coreI18nPort.t(key, ...args);
    }

    function refreshClassicLocalizedState() {
      updateCollapseBtnLabels();
      if (coreEditorUiCommandPort.has('refreshToolbarLayoutLabel')) coreEditorUiCommandPort.invoke('refreshToolbarLayoutLabel');
      updateStatusBar();
      updateCount();
      if (coreEditorUiCommandPort.has('refreshToolbarBoundary')) coreEditorUiCommandPort.invoke('refreshToolbarBoundary');
    }

    coreI18nPort.subscribe(() => refreshClassicLocalizedState());

    function updateCollapseBtnLabels() {
      const editorBtn = document.getElementById('editor-collapse-btn');
      const previewBtn = document.getElementById('preview-collapse-btn');
      if (editorBtn) editorBtn.title = coreLayoutStatePort.editorCollapsed ? t('expandEditor') : t('collapseEditor');
      if (previewBtn) previewBtn.title = coreLayoutStatePort.previewCollapsed ? t('expandPreview') : t('collapsePreview');
    }

    function updateLargeDocumentMode(length = editor.textLength) {
      document.body.classList.toggle('large-document', length >= LARGE_DOCUMENT_CHARS);
      document.body.classList.toggle('ultra-large-document', length >= ULTRA_LARGE_DOCUMENT_CHARS);
    }

    function setSaveStatus(state, message = '') {
      const hint = document.getElementById('save-hint');
      if (!hint) return;
      clearTimeout(saveStatusResetTimer);
      saveStatusResetTimer = 0;
      saveStatusState = state || 'saved';
      const labels = {
        queued: '等待保存…',
        saving: '正在保存…',
        saved: '✓ ' + t('saved'),
        error: '保存失败'
      };
      hint.dataset.state = saveStatusState;
      hint.textContent = message || labels[saveStatusState] || labels.saved;
      hint.classList.toggle('show', saveStatusState !== 'saved');
      if (saveStatusState === 'saved') {
        hint.classList.add('show');
        saveStatusResetTimer = setTimeout(() => hint.classList.remove('show'), 1500);
      }
    }

    function updateStatusBar() {
      const statusLeft = document.getElementById('status-left');
      if (statusLeft) statusLeft.textContent = autoSaveEnabled
        ? `自动保存已启用 · ${Math.round(autoSaveDelay) / 1000} 秒`
        : '自动保存已关闭';
      if (!autoSaveEnabled) {
        saveStatusState = 'saved';
        clearTimeout(saveStatusResetTimer);
        saveStatusResetTimer = 0;
        const hint = document.getElementById('save-hint');
        if (hint) {
          hint.dataset.state = 'disabled';
          hint.textContent = '自动保存关闭';
          hint.classList.remove('show');
        }
        return;
      }
      if (!['queued', 'saving', 'error'].includes(saveStatusState)) setSaveStatus('saved');
    }

    window.markdownEditorDocumentStore?.subscribe?.(event => {
      if (!event || event.documentId !== getActiveDocumentId()) return;
      if (event.state === 'loading-index') {
        const statusLeft = document.getElementById('status-left');
        if (statusLeft) statusLeft.textContent = '正在读取文档索引…';
      } else if (event.state === 'manifest') {
        const manifest = event.manifest || {};
        if (Array.isArray(manifest.headings)) {
          updateHeadingCacheFromWorkerIndex(manifest.headings, 0, true);
          updateDocumentStatistics({
            characters: Number(manifest.textLength) || 0,
            lines: Number(manifest.lineCount) || 1,
            blocks: 0,
            headings: manifest.headings.length,
            nonWhitespaceCount: Number(manifest.nonWhitespaceCount) || 0,
            nativeIndex: true
          });
          if (coreSidebarControllerPort.isActive('outline')) renderOutline();
        }
        const statusLeft = document.getElementById('status-left');
        if (statusLeft) statusLeft.textContent = '索引已恢复，正在读取正文…';
      } else if (event.state === 'loading') {
        const progress = Math.max(0, Math.min(100, Math.round((Number(event.progress) || 0) * 100)));
        const statusLeft = document.getElementById('status-left');
        if (statusLeft) statusLeft.textContent = `正在分段恢复文档… ${progress}%`;
      } else if (event.state === 'loaded') {
        updateStatusBar();
      } else if (event.state === 'load-error') {
        const statusLeft = document.getElementById('status-left');
        if (statusLeft) statusLeft.textContent = '文档恢复失败';
      } else if (event.state === 'queued') setSaveStatus('queued');
      else if (event.state === 'saving') {
        const progress = Number(event.progress);
        const message = Number.isFinite(progress)
          ? `正在分段创建安全快照… ${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`
          : event.backendVersion === 0 ? '正在创建安全快照…' : '正在后台保存…';
        setSaveStatus('saving', message);
      }
      else if (event.state === 'saved') {
        const detail = event.snapshotCreated ? '✓ 已保存并生成快照' : '✓ 已保存';
        setSaveStatus(event.pending > 0 ? 'queued' : 'saved', event.pending > 0 ? '等待保存…' : detail);
      } else if (event.state === 'error') {
        setSaveStatus('error', '保存失败：' + (event.message || '未知错误'));
      }
    });

    function toggleLangMenu() {
      document.getElementById('lang-menu').classList.toggle('show');
    }

    function closeLangMenu() {
      document.getElementById('lang-menu').classList.remove('show');
    }
    function positionTopLevelAppMenu(menu) {
      if (!menu || !menu.parentElement?.classList.contains('menu-dropdown')) return;
      const trigger = menu.parentElement.querySelector(':scope > .menu-trigger, :scope > button');
      if (!trigger) return;
      const triggerRect = trigger.getBoundingClientRect();
      const margin = 8;
      menu.style.position = 'fixed';
      menu.style.right = 'auto';
      menu.style.top = Math.round(triggerRect.bottom + 4) + 'px';
      menu.style.left = Math.round(triggerRect.left) + 'px';
      const menuRect = menu.getBoundingClientRect();
      const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - menuRect.height - margin);
      menu.style.left = Math.round(Math.max(margin, Math.min(triggerRect.left, maxLeft))) + 'px';
      if (triggerRect.bottom + 4 + menuRect.height > window.innerHeight - margin) {
        menu.style.top = Math.round(Math.max(margin, Math.min(triggerRect.top - menuRect.height - 4, maxTop))) + 'px';
      }
    }

    function resetTopLevelAppMenuPosition(menu) {
      if (!menu || !menu.parentElement?.classList.contains('menu-dropdown')) return;
      menu.style.removeProperty('position');
      menu.style.removeProperty('left');
      menu.style.removeProperty('right');
      menu.style.removeProperty('top');
    }

    function positionAppSubmenu(submenu, owner) {
      if (!submenu || !owner) return;
      const ownerRect = owner.getBoundingClientRect();
      const margin = 8;
      const gap = 4;

      // 子菜单必须保持在父菜单项的局部坐标系中。顶层菜单进入动画包含 transform，
      // 若这里使用 fixed，浏览器会把视口坐标再次叠加到动画容器坐标，造成横向偏移。
      submenu.style.position = 'absolute';
      submenu.style.right = 'auto';
      submenu.style.left = Math.round(ownerRect.width + gap) + 'px';
      submenu.style.top = '-6px';

      const submenuRect = submenu.getBoundingClientRect();
      const fitsRight = ownerRect.right + gap + submenuRect.width <= window.innerWidth - margin;
      const localLeft = fitsRight
        ? ownerRect.width + gap
        : -submenuRect.width - gap;
      const maxViewportTop = Math.max(margin, window.innerHeight - submenuRect.height - margin);
      const viewportTop = Math.max(margin, Math.min(ownerRect.top - 6, maxViewportTop));

      submenu.style.left = Math.round(localLeft) + 'px';
      submenu.style.top = Math.round(viewportTop - ownerRect.top) + 'px';
    }

    function resetAppSubmenuPosition(submenu) {
      if (!submenu) return;
      submenu.style.removeProperty('position');
      submenu.style.removeProperty('left');
      submenu.style.removeProperty('right');
      submenu.style.removeProperty('top');
    }

    function initializeAppSubmenus() {
      const closeDelayMs = 1000;
      document.querySelectorAll('.menu-submenu').forEach(owner => {
        if (owner.dataset.submenuPositioningReady === 'true') return;
        const submenu = owner.querySelector(':scope > .menu-submenu-list');
        if (!submenu) return;
        owner.dataset.submenuPositioningReady = 'true';
        let closeTimer = 0;

        const cancelClose = () => {
          if (!closeTimer) return;
          clearTimeout(closeTimer);
          closeTimer = 0;
        };
        const openSubmenu = () => {
          if (owner.classList.contains('disabled')) return;
          cancelClose();
          owner.classList.add('is-submenu-open');
          requestAnimationFrame(() => positionAppSubmenu(submenu, owner));
        };
        const scheduleClose = () => {
          cancelClose();
          closeTimer = window.setTimeout(() => {
            closeTimer = 0;
            if (owner.matches(':hover') || submenu.matches(':hover') || owner.contains(document.activeElement)) return;
            owner.classList.remove('is-submenu-open');
            resetAppSubmenuPosition(submenu);
          }, closeDelayMs);
        };

        owner.__markdownEditorCancelSubmenuClose = cancelClose;
        owner.addEventListener('pointerenter', openSubmenu);
        owner.addEventListener('pointerleave', scheduleClose);
        owner.addEventListener('focusin', openSubmenu);
        owner.addEventListener('focusout', scheduleClose);
        submenu.addEventListener('pointerenter', openSubmenu);
        submenu.addEventListener('pointerleave', scheduleClose);
      });
    }

    function toggleAppMenu(menuId) {
      const target = document.getElementById(menuId);
      if (!target) return;
      const willShow = !target.classList.contains('show');
      closeAppMenus();
      if (!willShow) return;
      target.classList.add('show');
      const trigger = target.parentElement?.querySelector(':scope > .menu-trigger, :scope > button');
      trigger?.setAttribute('aria-expanded', 'true');
      positionTopLevelAppMenu(target);
    }

    function closeAppMenus() {
      document.querySelectorAll('.menu-dropdown-list.show').forEach(menu => {
        menu.classList.remove('show');
        resetTopLevelAppMenuPosition(menu);
      });
      document.querySelectorAll('.menu-submenu').forEach(owner => {
        owner.__markdownEditorCancelSubmenuClose?.();
        owner.classList.remove('is-submenu-open');
      });
      document.querySelectorAll('.menu-submenu-list').forEach(resetAppSubmenuPosition);
      document.querySelectorAll('.menu-trigger[aria-expanded="true"]').forEach(button => {
        button.setAttribute('aria-expanded', 'false');
      });
    }

    async function triggerImportFile() {
      if (corePlatformPort?.supports('desktop.dialogs')) {
        try {
          const path = await corePlatformPort.call('dialogs', 'openFile', {
            title: '打开 Markdown 或文本文件',
            extensions: ['md', 'markdown', 'txt'],
            filterName: 'Markdown 和文本文件'
          });
          if (path) await handleNativeDroppedPath(path);
        } catch (error) {
          showToast(recordDocumentOperationError('open-file-dialog', error));
        }
        return;
      }
      const input = document.getElementById('importFile');
      if (!input) return;
      input.value = '';
      input.click();
    }

    function getCurrentTimestamp() {
      return Date.now();
    }

    function normalizeDocumentTitle(name) {
      return coreDocumentDomainPort.normalizeTitle(name, t('filenameDefault'));
    }

    function updateDocumentStatistics(statistics) {
      cachedDocumentStatistics = statistics && typeof statistics === 'object' ? { ...statistics } : null;
      window.markdownEditorDocumentStatistics = cachedDocumentStatistics;
    }

    function getDocumentIndexSignature() {
      const length = documentModel?.getTextLength?.() ?? editor.textLength;
      const slice = documentModel?.sliceText?.bind(documentModel) || editor.virtualEditor?.sliceText?.bind(editor.virtualEditor);
      const head = slice ? slice(0, Math.min(length, 256)) : editor.value.slice(0, 256);
      const tail = slice ? slice(Math.max(0, length - 256), length) : editor.value.slice(-256);
      return simpleHash(length + ':' + head + ':' + tail);
    }

    function getDocumentIndexStorageKey(documentId) {
      return DOCUMENT_INDEX_KEY_PREFIX + encodeURIComponent(String(documentId || ''));
    }

    function restoreDocumentIndex(doc) {
      updateDocumentStatistics(null);
      if (!doc?.id) return false;
      try {
        const parsed = JSON.parse(localStorage.getItem(getDocumentIndexStorageKey(doc.id)) || 'null');
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.headings)) return false;
        const currentLength = editor.textLength;
        if (Number(parsed.textLength) !== currentLength) return false;
        if (String(parsed.signature || '') !== getDocumentIndexSignature()) return false;
        updateHeadingCacheFromWorkerIndex(parsed.headings, editor.virtualEditor?.getDocumentVersion?.());
        updateDocumentStatistics(parsed.statistics);
        return true;
      } catch (_) {
        return false;
      }
    }

    function persistCurrentDocumentIndex(headings, statistics = null) {
      const doc = getCurrentDocument();
      if (!doc?.id || !Array.isArray(headings)) return;
      const payload = {
        version: 1,
        updatedAt: Number(doc.updatedAt) || 0,
        textLength: editor.textLength,
        signature: getDocumentIndexSignature(),
        headings: headings.map(item => ({
          id: String(item.id || ''),
          level: Number(item.level) || 1,
          text: String(item.text || ''),
          line: Number(item.line) || 1
        })),
        statistics: statistics && typeof statistics === 'object' ? { ...statistics } : null
      };
      updateDocumentStatistics(payload.statistics);
      const save = () => {
        try {
          localStorage.setItem(getDocumentIndexStorageKey(doc.id), JSON.stringify(payload));
        } catch (error) {
          console.debug('Document index cache skipped:', error?.message || error);
        }
      };
      const scheduler = window.markdownEditorTaskScheduler;
      if (scheduler?.schedule) scheduler.schedule('document-index-' + doc.id, save, { priority: 'idle', timeout: 1000 });
      else setTimeout(save, 0);
    }

    function clearDocumentIndex(documentId) {
      window.markdownEditorTaskScheduler?.cancel?.('document-index-' + documentId);
      try {
        localStorage.removeItem(getDocumentIndexStorageKey(documentId));
      } catch (_) {}
    }

    async function applyDocumentLifecycleUi(result, options = {}) {
      if (!result || !coreDocumentControllerPort.isCurrentGeneration(result.generation)) return false;
      const doc = options.record === undefined
        ? (result.record || coreDocumentControllerPort.getActiveRecord())
        : options.record;
      const loaded = result.loaded || null;
      filenameInput.value = doc?.title || t('filenameDefault');
      const restoredCachedIndex = restoreDocumentIndex(doc);
      if (Array.isArray(loaded?.headings)) {
        updateHeadingCacheFromWorkerIndex(loaded.headings, documentModel?.getDocumentVersion?.() ?? 0, true);
        updateDocumentStatistics({
          characters: Number(loaded.textLength) || editor.textLength,
          lines: Number(loaded.lineCount) || editor.lineCount,
          blocks: Number(cachedDocumentStatistics?.blocks) || 0,
          headings: loaded.headings.length,
          nonWhitespaceCount: Number(loaded.nonWhitespaceCount) || 0,
          nativeIndex: true
        });
        if (coreSidebarControllerPort.isActive('outline')) renderOutline();
      } else if (!restoredCachedIndex) {
        updateDocumentStatistics(null);
      }
      if (loaded?.recovered && coreDocumentControllerPort.isCurrentGeneration(result.generation)) {
        const message = loaded.recoveryMessage || '检测到未完整写入的数据，已从可用快照恢复';
        showToast(message);
        window.markdownEditorPerf?.record('storage.document-recovered', {
          category: 'storage.recovery',
          status: 'recovered',
          details: { documentId: doc?.id || '', version: doc?.nativeVersion || 0, message }
        });
      }
      if (!coreDocumentControllerPort.isCurrentGeneration(result.generation)) return false;
      await resetPreviewPipeline();
      if (!coreDocumentControllerPort.isCurrentGeneration(result.generation)) return false;
      updateCount();
      syncCurrentDocumentFileTree();
      return true;
    }

    async function setupDocuments() {
      const storedDocuments = coreDocumentControllerPort.getLegacySessionRecords();
      for (const storedDocument of storedDocuments) {
        if (storedDocument?.filePath) addRecentFile(storedDocument.filePath, storedDocument.title, false);
        if (storedDocument?.id) clearDocumentIndex(storedDocument.id);
      }
      renderRecentFilesMenu();
      const result = coreDocumentControllerPort.initializeEmptySession({ legacyRecords: storedDocuments });
      filenameInput.value = t('filenameDefault');
      syncCurrentDocumentFileTree();

      window.markdownEditorPerf?.record?.('document.session-reset', {
        category: 'document.lifecycle',
        durationMs: 0,
        details: {
          discardedDocuments: storedDocuments.length,
          migratedRecentFiles: storedDocuments.filter(item => item?.filePath).length,
          currentDocumentId: coreDocumentControllerPort.activeId || '',
          generation: result.generation,
          emptyWorkspace: true
        }
      });
    }

    function getCurrentDocument() {
      return coreDocumentSessionPort.getActiveRecord();
    }

    window.markdownEditorRuntimeContext = {
      ...(window.markdownEditorRuntimeContext || {}),
      getCurrentDocumentContext() {
        const document = getCurrentDocument();
        return {
          documentId: String(document?.id || ''),
          filePath: String(document?.filePath || ''),
          title: String(document?.title || filenameInput.value || '')
        };
      }
    };

    function ensureCurrentDocumentForEditing() {
      const current = coreDocumentControllerPort.getActiveRecord();
      if (current) return current;
      const result = coreDocumentControllerPort.ensureActiveForEditing({
        title: t('filenameDefault'),
        fallbackTitle: t('filenameDefault')
      });
      filenameInput.value = result.record.title;
      syncCurrentDocumentFileTree();
      window.markdownEditorPerf?.record?.('document.lazy-created', {
        category: 'document.lifecycle',
        durationMs: 0,
        details: { documentId: result.record.id, characters: editor.textLength, generation: result.generation }
      });
      return result.record;
    }

    async function confirmUserAction(message, options = {}) {
      if (corePlatformPort) return corePlatformPort.call('dialogs', 'confirm', message, options);
      return confirm(String(message || ''));
    }

    function recordDocumentOperationError(operation, error, details = {}) {
      const message = error?.message || String(error);
      console.error(operation + ' failed:', error);
      window.markdownEditorPerf?.record?.('document.' + operation + '-error', {
        category: 'document.error',
        status: 'error',
        details: {
          ...details,
          message,
          currentDocumentId: getActiveDocumentId() || '',
          runtimeDocumentId: documentModel?.documentId || ''
        }
      });
      return message;
    }

    async function saveCurrentDocumentState(refreshList = true, options = {}) {
      try {
        const result = await coreDocumentControllerPort.saveActive({
          title: filenameInput.value,
          fallbackTitle: t('filenameDefault'),
          forceSnapshot: Boolean(options.forceSnapshot),
          snapshotReason: options.snapshotReason || 'document-storage'
        });
        if (refreshList && coreDocumentControllerPort.isCurrentGeneration(result.generation)) syncCurrentDocumentFileTree();
        return result.result || { native: Boolean(result.native) };
      } catch (error) {
        if (coreDocumentControllerPort.isStaleError(error)) return { native: false, stale: true };
        throw error;
      }
    }

    function normalizeWorkspaceFilePath(path) {
      const value = String(path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
      if (!value) return '';
      return (/^[a-z]:\//i.test(value) || value.startsWith('//')) ? value.toLocaleLowerCase() : value;
    }

    async function openFolderTreeFile(path) {
      const normalizedPath = normalizeWorkspaceFilePath(path);
      if (!normalizedPath) return false;
      const existing = getSessionDocuments().find(item => normalizeWorkspaceFilePath(item?.filePath) === normalizedPath);
      if (existing) {
        if (existing.id !== getActiveDocumentId()) await openDocument(existing.id);
        void coreSidebarControllerPort.select('files');
        return true;
      }
      if (typeof handleNativeDroppedPath !== 'function') return false;
      const opened = await handleNativeDroppedPath(path);
      if (opened) void coreSidebarControllerPort.select('files');
      return opened;
    }

    async function openDocument(id) {
      if (id === coreDocumentControllerPort.activeId) return;
      try {
        clearTimeout(saveTimer);
        const result = await coreDocumentControllerPort.openDocument(id, {
          currentTitle: filenameInput.value,
          fallbackTitle: t('filenameDefault')
        });
        if (!result.opened) return;
        if (!await applyDocumentLifecycleUi(result)) return;
        if (coreDocumentControllerPort.isCurrentGeneration(result.generation)) showToast('已切换文档');
      } catch (error) {
        if (coreDocumentControllerPort.isStaleError(error)) return;
        showToast(recordDocumentOperationError('open', error, { targetDocumentId: id }));
      }
    }

    async function newDocument() {
      try {
        clearTimeout(saveTimer);
        const index = getSessionDocuments().length + 1;
        const result = await coreDocumentControllerPort.newDocument({
          title: '未命名文档-' + index + '.md',
          content: '',
          currentTitle: filenameInput.value,
          fallbackTitle: t('filenameDefault')
        });
        if (!await applyDocumentLifecycleUi(result)) return;
        if (!coreDocumentControllerPort.isCurrentGeneration(result.generation)) return;
        void coreSidebarControllerPort.select('docs');
        showToast('已新建文档');
        editor.focus();
      } catch (error) {
        if (coreDocumentControllerPort.isStaleError(error)) return;
        showToast(recordDocumentOperationError('new', error));
      }
    }

    async function duplicateDocument(id = coreDocumentControllerPort.activeId) {
      try {
        const result = await coreDocumentControllerPort.duplicateDocument(id, {
          currentTitle: filenameInput.value,
          fallbackTitle: t('filenameDefault'),
          copySuffix: ' 副本.md'
        });
        if (!result.duplicated) return;
        if (!await applyDocumentLifecycleUi(result)) return;
        if (!coreDocumentControllerPort.isCurrentGeneration(result.generation)) return;
        void coreSidebarControllerPort.select('docs');
        showToast('已复制文档');
      } catch (error) {
        if (coreDocumentControllerPort.isStaleError(error)) return;
        showToast(recordDocumentOperationError('duplicate', error, { sourceDocumentId: id }));
      }
    }

    function renameDocument(id = coreDocumentControllerPort.activeId) {
      const doc = coreDocumentControllerPort.getRecord(id) || coreDocumentControllerPort.getActiveRecord();
      if (!doc) return;
      const nextName = prompt('重命名文档', doc.title || filenameInput.value || t('filenameDefault'));
      if (nextName === null) return;
      try {
        const result = coreDocumentControllerPort.renameDocument(doc.id, nextName, { fallbackTitle: t('filenameDefault') });
        if (!result.renamed) return;
        if (result.active) {
          filenameInput.value = result.record.title;
          autoSave();
        }
        syncCurrentDocumentFileTree();
        showToast('已重命名文档');
      } catch (error) {
        if (coreDocumentControllerPort.isStaleError(error)) return;
        showToast(recordDocumentOperationError('rename', error, { documentId: doc.id }));
      }
    }

    function renameCurrentDocument() {
      renameDocument(coreDocumentControllerPort.activeId);
    }

    function hasUnsavedDocumentChanges(id) {
      if (
        id !== coreDocumentControllerPort.activeId
        || String(documentModel?.documentId || '') !== String(id || '')
        || !documentModel?.dirty
      ) return false;
      return !autoSaveEnabled || saveStatusState === 'queued' || saveStatusState === 'error';
    }

    async function closeDocument(id, event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const doc = coreDocumentControllerPort.getRecord(id);
      if (!doc) return;
      const shouldSaveBeforeClose = hasUnsavedDocumentChanges(id);
      if (shouldSaveBeforeClose) {
        const confirmed = await confirmUserAction('文档「' + doc.title + '」尚未自动保存。是否立即保存并关闭？', {
          title: '关闭文档',
          kind: 'warning',
          okLabel: '保存并关闭',
          cancelLabel: '取消'
        });
        if (!confirmed) return;
      }

      try {
        const closingActive = coreDocumentControllerPort.activeId === id;
        if (closingActive) {
          clearTimeout(saveTimer);
          if (shouldSaveBeforeClose) {
            const saved = await saveCurrentFile();
            if (!saved) return;
          }
        }
        const result = await coreDocumentControllerPort.closeDocument(id, {
          currentTitle: filenameInput.value,
          fallbackTitle: t('filenameDefault'),
          persistDirty: !shouldSaveBeforeClose
        });
        if (!result.closed) return;
        clearDocumentIndex(id);
        if (result.closingActive) {
          const uiResult = { ...result, record: result.activeRecord || null };
          if (!await applyDocumentLifecycleUi(uiResult, { record: result.activeRecord || null })) return;
        } else {
          syncCurrentDocumentFileTree();
        }
        if (coreDocumentControllerPort.isCurrentGeneration(result.generation)) showToast('已关闭文档');
      } catch (error) {
        if (coreDocumentControllerPort.isStaleError(error)) return;
        showToast(recordDocumentOperationError('close', error, { documentId: id }));
      }
    }

    // 保留旧入口，避免已有内联调用或性能工具失效。
    function deleteDocument(id, event) {
      return closeDocument(id, event);
    }

    function syncCurrentDocumentFileTree() {
      window.markdownEditorFileTree?.syncCurrentDocument?.(
        window.markdownEditorRuntimeContext?.getCurrentDocumentContext?.()
      );
    }

    function showContextMenu(menu, event) {
      if (!menu || !event) return;
      event.preventDefault();
      event.stopPropagation();
      closeContextMenus();
      menu.style.display = 'block';
      menu.classList.add('show');
      const width = menu.offsetWidth || 180;
      const height = menu.offsetHeight || 220;
      const x = Math.min(event.clientX, window.innerWidth - width - 8);
      const y = Math.min(event.clientY, window.innerHeight - height - 8);
      menu.style.left = Math.max(8, x) + 'px';
      menu.style.top = Math.max(8, y) + 'px';
    }

    function closeContextMenus() {
      const menu = document.getElementById('outline-context-menu');
      menu?.classList.remove('show');
      if (menu) menu.style.display = 'none';
    }

    function exportMarkdownContent(content, preferredName) {
      const blob = new Blob([content || ''], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      let name = normalizeDocumentTitle(preferredName || t('filenameDefault'));
      if (!name.toLowerCase().endsWith('.md') && !name.toLowerCase().endsWith('.markdown')) name += '.md';
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    async function exportContextDocument(documentId) {
      const doc = coreDocumentSessionPort.getRecord(documentId) || getCurrentDocument();
      if (!doc) return;
      try {
        const contentResult = doc.id === getActiveDocumentId()
          ? { generation: coreDocumentControllerPort.generation, content: documentModel?.createSnapshot?.('context-export') ?? editor.value }
          : await coreDocumentControllerPort.readDocumentContent(doc.id);
        if (!coreDocumentControllerPort.isCurrentGeneration(contentResult.generation)) return;
        const content = contentResult.content;
        const name = doc.title || t('filenameDefault');
        const savedPath = await exportTextContent(content, name, getExportSaveOptions(
          '导出 Markdown',
          'md',
          'Markdown 文档',
          ['md', 'markdown']
        ));
        if (savedPath === null) return;
        if (savedPath === false) exportMarkdownContent(content, name);
        if (!coreDocumentControllerPort.isCurrentGeneration(contentResult.generation)) return;
        showToast('已导出 Markdown');
      } catch (error) {
        showToast(error?.message || String(error));
      }
    }

    async function saveAsContextDocument(documentId) {
      const doc = coreDocumentSessionPort.getRecord(documentId) || getCurrentDocument();
      if (!doc) return;
      try {
        const savedPath = await saveMarkdownWithPicker(async () => {
          if (doc.id === getActiveDocumentId()) {
            return documentModel?.createSnapshot?.('context-save-as') ?? editor.value;
          }
          const contentResult = await coreDocumentControllerPort.readDocumentContent(doc.id);
          if (!coreDocumentControllerPort.isCurrentGeneration(contentResult.generation)) throw new Error('DOCUMENT_OPERATION_STALE');
          return contentResult.content;
        }, doc.title || t('filenameDefault'), 'context-save-as');
        if (savedPath) {
          if (typeof savedPath === 'string') bindDocumentFilePath(doc, savedPath);
          showToast('已另存为 Markdown');
        }
      } catch (error) {
        showToast('另存为失败：' + (error?.message || String(error)));
      }
    }

    function copyContextDocumentTitle(documentId) {
      const doc = coreDocumentSessionPort.getRecord(documentId) || getCurrentDocument();
      if (!doc) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(doc.title || '').then(() => showToast('已复制文件名')).catch(() => showToast(doc.title || ''));
      } else {
        showToast(doc.title || '');
      }
    }

    let activeLayoutTransition = null;

    function isWindowResizeBurstActive() {
      return performance.now() < coreLayoutStatePort.windowResizeActiveUntil;
    }

    function consumeViewTransitionPromise(promise) {
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    }

    function silenceViewTransition(transition) {
      if (!transition) return;
      consumeViewTransitionPromise(transition.ready);
      consumeViewTransitionPromise(transition.updateCallbackDone);
      consumeViewTransitionPromise(transition.finished);
    }

    function runLayoutTransition(commit, kind = 'layout') {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const canUseViewTransition = typeof document.startViewTransition === 'function'
        && document.documentElement.classList.contains('app-ready')
        && !reduceMotion
        && !coreLayoutStatePort.isResizing
        && !coreLayoutStatePort.isSidebarResizing
        && !isWindowResizeBurstActive();
      if (!canUseViewTransition) {
        commit();
        return null;
      }

      try {
        if (activeLayoutTransition) {
          silenceViewTransition(activeLayoutTransition);
          activeLayoutTransition.skipTransition?.();
        }
        document.documentElement.dataset.layoutTransition = kind;
        const transition = document.startViewTransition(commit);
        silenceViewTransition(transition);
        activeLayoutTransition = transition;
        const clear = () => {
          if (activeLayoutTransition !== transition) return;
          activeLayoutTransition = null;
          delete document.documentElement.dataset.layoutTransition;
        };
        transition.finished.then(clear, clear);
        return transition;
      } catch (_) {
        delete document.documentElement.dataset.layoutTransition;
        commit();
        return null;
      }
    }

    function toggleSidebar() {
      if (coreLayoutStatePort.sidebarAutoCollapsed) {
        showToast('当前窗口较窄，侧边栏已自动折叠');
        return;
      }
      const nextVisible = !coreLayoutStatePort.sidebarVisible;
      coreSettingsStorePort.set('sidebarVisible', nextVisible);
      runLayoutTransition(() => { coreLayoutStatePort.sidebarVisible = nextVisible; }, 'sidebar');
      showToast(coreLayoutStatePort.sidebarVisible ? '已显示侧边栏' : '已隐藏侧边栏');
    }

    function parseOutlineCollapsed() {
      try {
        const parsed = JSON.parse(localStorage.getItem(OUTLINE_COLLAPSED_KEY) || '{}');
        outlineCollapsed = parsed && typeof parsed === 'object' ? parsed : {};
      } catch (_) {
        outlineCollapsed = {};
      }
    }

    function saveOutlineCollapsed() {
      localStorage.setItem(OUTLINE_COLLAPSED_KEY, JSON.stringify(outlineCollapsed));
    }

    function getHeadingCacheKey(version = documentModel?.getDocumentVersion?.() ?? editor.virtualEditor?.getDocumentVersion?.()) {
      return Number.isFinite(version) ? 'version:' + version : null;
    }

    function createHeadingRecord(lineText, lineNumber) {
      const match = String(lineText || '').match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (!match) return null;
      const rawText = match[2].trim();
      const text = stripHeadingMarkdown(rawText);
      return {
        id: 'h-' + lineNumber + '-' + match[1].length + '-' + simpleHash(rawText),
        level: match[1].length,
        text: text || rawText,
        line: lineNumber,
        children: []
      };
    }

    function headingsEqual(left, right) {
      return left.length === right.length && left.every((item, index) => {
        const next = right[index];
        return next && item.id === next.id && item.level === next.level && item.line === next.line && item.text === next.text;
      });
    }

    function updateHeadingCacheFromPreviewBlocks(blocks, version = documentModel?.getDocumentVersion?.() ?? editor.virtualEditor?.getDocumentVersion?.()) {
      if (!Array.isArray(blocks)) return;
      const headings = [];
      for (const block of blocks) {
        if (block.type !== 'heading') continue;
        const firstLine = String(block.raw || '').split('\n', 1)[0];
        const heading = createHeadingRecord(firstLine, Math.max(1, Number(block.startLine) || 1));
        if (heading) headings.push(heading);
      }
      const changed = !headingsEqual(cachedHeadings, headings);
      cachedHeadings = headings;
      cachedHeadingSource = getHeadingCacheKey(version);
      if (changed) outlineDirty = true;
    }

    function updateHeadingCacheFromWorkerIndex(headings, version = documentModel?.getDocumentVersion?.() ?? editor.virtualEditor?.getDocumentVersion?.(), changedHint = null) {
      if (!Array.isArray(headings)) return false;
      if (changedHint === false && cachedHeadings.length) {
        cachedHeadingSource = getHeadingCacheKey(version);
        return false;
      }
      const normalized = headings.map(item => ({
        id: String(item.id || ('h-' + item.line + '-' + item.level)),
        level: Math.max(1, Math.min(6, Number(item.level) || 1)),
        text: String(item.text || '').trim(),
        line: Math.max(1, Number(item.line) || 1),
        children: []
      }));
      const changed = changedHint === true || !headingsEqual(cachedHeadings, normalized);
      cachedHeadings = normalized;
      cachedHeadingSource = getHeadingCacheKey(version);
      if (changed) outlineDirty = true;
      return changed;
    }

    function getMarkdownHeadings() {
      const cacheKey = getHeadingCacheKey();
      if (cacheKey && cachedHeadingSource === cacheKey) return cachedHeadings;
      const source = documentModel?.createSnapshot?.('outline-fallback') ?? editor.value;
      const lines = source.split('\n');
      const headings = [];
      lines.forEach((line, index) => {
        const heading = createHeadingRecord(line, index + 1);
        if (heading) headings.push(heading);
      });
      cachedHeadingSource = cacheKey || source;
      cachedHeadings = headings;
      return headings;
    }

    function simpleHash(text) {
      let hash = 0;
      for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
      return Math.abs(hash).toString(36);
    }

    function stripHeadingMarkdown(text) {
      return String(text || '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/~~(.*?)~~/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function buildOutlineTree(headings) {
      const root = { level: 0, children: [] };
      const stack = [root];
      headings.forEach(item => {
        const node = { ...item, children: [] };
        while (stack.length > 1 && stack[stack.length - 1].level >= node.level) stack.pop();
        stack[stack.length - 1].children.push(node);
        stack.push(node);
      });
      return root.children;
    }

    function renderOutline(force = false) {
      const list = document.getElementById('outline-list');
      if (!list) return;
      const wasDirty = outlineDirty;
      const previousHeadings = cachedHeadings;
      const nextHeadings = getMarkdownHeadings();
      const structureUnchanged = headingsEqual(previousHeadings, nextHeadings);
      cachedHeadings = nextHeadings;
      outlineDirty = false;
      if (!force && !wasDirty && structureUnchanged && list.querySelector('.outline-tree')) {
        updateActiveOutlineByLine(getEditorCursorLine());
        return;
      }
      if (!cachedHeadings.length) {
        list.innerHTML = '<div class="sidebar-empty">当前文档还没有标题。使用 # 至 ###### 创建标题后会自动生成可折叠大纲。</div>';
        activeOutlineRow = null;
        activeOutlineHeadingId = '';
        return;
      }
      const tree = buildOutlineTree(cachedHeadings);
      list.innerHTML = renderOutlineNodes(tree, true);
      activeOutlineRow = null;
      activeOutlineHeadingId = '';
      updateActiveOutlineByLine(getEditorCursorLine());
    }

    function renderOutlineNodes(nodes, isRoot = false) {
      const html = nodes.map(node => {
        const hasChildren = node.children && node.children.length;
        const collapsed = !!outlineCollapsed[node.id];
        const toggle = hasChildren
          ? '<button class="outline-toggle" aria-label="折叠/展开" onclick="toggleOutlineNode(\'' + node.id + '\', event)">' + (collapsed ? '▸' : '▾') + '</button>'
          : '<span class="outline-toggle outline-toggle-placeholder"></span>';
        const children = hasChildren
          ? '<ul class="outline-children' + (collapsed ? ' collapsed' : '') + '">' + renderOutlineNodes(node.children) + '</ul>'
          : '';
        return '<li class="outline-node outline-level-' + node.level + (hasChildren ? ' has-children' : '') + (collapsed ? ' is-collapsed' : '') + '" data-outline-id="' + node.id + '" data-outline-level="' + node.level + '">'
          + '<div class="outline-row" data-line="' + node.line + '">'
          + toggle
          + '<button class="outline-link" data-line="' + node.line + '" title="第 ' + node.line + ' 行" onclick="jumpToLine(' + node.line + ')">' + escapeHtml(node.text) + '</button>'
          + '</div>'
          + children
          + '</li>';
      }).join('');
      return isRoot ? '<ul class="outline-tree">' + html + '</ul>' : html;
    }

    function toggleOutlineNode(id, event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      outlineCollapsed[id] = !outlineCollapsed[id];
      saveOutlineCollapsed();
      renderOutline(true);
    }

    function collectCollapsibleOutlineIds(nodes, output = []) {
      for (const node of nodes || []) {
        if (node.children?.length) {
          output.push(node.id);
          collectCollapsibleOutlineIds(node.children, output);
        }
      }
      return output;
    }

    function getCurrentOutlineTree() {
      return buildOutlineTree(getMarkdownHeadings());
    }

    function expandAllOutline() {
      for (const heading of getMarkdownHeadings()) delete outlineCollapsed[heading.id];
      saveOutlineCollapsed();
      renderOutline(true);
    }

    function collapseAllOutline() {
      const collapsibleIds = collectCollapsibleOutlineIds(getCurrentOutlineTree());
      for (const id of collapsibleIds) outlineCollapsed[id] = true;
      saveOutlineCollapsed();
      renderOutline(true);
    }

    function openOutlineContextMenu(event) {
      const node = event?.target?.closest?.('.outline-node');
      contextOutlineId = node?.dataset?.outlineId || '';
      const hasChildren = Boolean(node?.classList?.contains('has-children'));
      const separator = document.getElementById('outline-context-node-separator');
      const collapseButton = document.getElementById('outline-context-collapse-node');
      if (separator) separator.hidden = !hasChildren;
      if (collapseButton) collapseButton.hidden = !hasChildren;
      showContextMenu(document.getElementById('outline-context-menu'), event);
    }

    function collapseContextOutlineNode() {
      if (!contextOutlineId) return;
      outlineCollapsed[contextOutlineId] = true;
      saveOutlineCollapsed();
      renderOutline(true);
    }

    function updateActiveOutlineByLine(line) {
      const list = document.getElementById('outline-list');
      if (!list || !cachedHeadings.length) return;
      const targetLine = Math.max(1, Number(line) || 1);
      let low = 0;
      let high = cachedHeadings.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (cachedHeadings[mid].line <= targetLine) low = mid;
        else high = mid - 1;
      }
      const active = cachedHeadings[low];
      if (!active || activeOutlineHeadingId === active.id) return;
      activeOutlineRow?.classList.remove('active');
      const row = list.querySelector('.outline-row[data-line="' + active.line + '"]');
      row?.classList.add('active');
      activeOutlineRow = row || null;
      activeOutlineHeadingId = active.id;
    }

    function jumpToLine(line) {
      const targetLine = Math.max(1, Number(line) || 1);
      const position = getLineStartIndex(targetLine);
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(position, position);
      if (editor.virtualEditor?.scrollPositionIntoView) {
        editor.virtualEditor.scrollPositionIntoView(position, 'auto', 0.5);
      } else {
        scrollEditorToLine(targetLine, 'auto', 0.5);
      }
      void focusPreviewLine(targetLine, { behavior: 'auto', scroll: true });
      updateActiveOutlineByLine(targetLine);
    }

    document.addEventListener('markdown-editor:settings-changed', event => {
      const applied = event?.detail?.snapshot;
      if (!applied || !Array.isArray(event?.detail?.changedIds)) return;
      coreLayoutStatePort.sidebarVisible = applied.sidebarVisible;
      autoSaveEnabled = applied.autoSaveEnabled;
      autoSaveDelay = applied.autoSaveDelay;
      editorFontSize = applied.editorFontSize;
      editorTextColor = applied.editorTextColor;
      activeLineColor = applied.activeLineColor;
      exportDirectory = applied.exportDirectory;
      toolbarVisible = applied.toolbarVisible;
      toolbarHiddenItems = new Set(applied.toolbarHiddenItems);
      previewPerformanceMode = applied.previewPerformanceMode;
      setLayoutMode(applied.layoutMode, false, false);
      applyEditorPreferences();
      updateStatusBar();
      autoSave();
      showToast('设置已保存');
    });

    function updateToolbarItemVisibility() {
      document.querySelectorAll('[data-toolbar-item]').forEach(item => {
        item.classList.toggle('toolbar-item-hidden', toolbarHiddenItems.has(item.dataset.toolbarItem));
      });

      const formatGroup = document.querySelector('.editor-toolbar .format-group');
      if (!formatGroup) return;
      const children = Array.from(formatGroup.children);
      children.filter(child => child.classList.contains('divider'))
        .forEach(divider => divider.classList.add('toolbar-divider-hidden'));

      let hasVisibleItem = false;
      let pendingDivider = null;
      for (const child of children) {
        if (child.classList.contains('divider')) {
          if (hasVisibleItem) pendingDivider = child;
          continue;
        }
        if (child.classList.contains('toolbar-item-hidden')) continue;
        if (pendingDivider) {
          pendingDivider.classList.remove('toolbar-divider-hidden');
          pendingDivider = null;
        }
        hasVisibleItem = true;
      }
      if (coreEditorUiCommandPort.has('refreshToolbarBoundary')) coreEditorUiCommandPort.invoke('refreshToolbarBoundary');
    }

    function applyEditorPreferences() {
      document.documentElement.style.setProperty('--editor-font-size', editorFontSize + 'px');
      if (editorTextColor) document.body.style.setProperty('--color-editor-text', editorTextColor);
      else document.body.style.removeProperty('--color-editor-text');
      if (activeLineColor) document.body.style.setProperty('--color-editor-active-line', activeLineColor);
      else document.body.style.removeProperty('--color-editor-active-line');
      const toolbar = document.querySelector('.editor-toolbar');
      if (toolbar) {
        toolbar.classList.toggle('hidden', !toolbarVisible);
        toolbar.classList.toggle('is-hidden', !toolbarVisible);
      }
      updateToolbarItemVisibility();
      if (typeof updateInlineColorToolAvailability === 'function') updateInlineColorToolAvailability();
      scheduleEditorMetricsRebuild(80);
      invalidatePreviewAnchorMetrics();
    }

    let fetchedHtml = '';

    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,
        gfm: true,
        headerIds: false,
        mangle: false
      });
    }


    // 平滑双向滚动、预览定位与选择同步
