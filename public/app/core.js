const coreCompatibilityHost = document.getElementById('compatibility-business-ports');
const corePlatformPort = coreCompatibilityHost?.markdownEditorPlatformPort;
const coreI18nPort = coreCompatibilityHost?.markdownEditorI18nPort;
const coreSettingsStorePort = coreCompatibilityHost?.markdownEditorSettingsStorePort;
if (!coreI18nPort) throw new Error('I18n compatibility port is unavailable.');
if (!coreSettingsStorePort) throw new Error('Settings Store compatibility port is unavailable.');
const editor = document.getElementById('editor');
    const documentModel = window.markdownEditorDocumentModel;
    const preview = document.getElementById('preview');
    const previewSource = document.getElementById('preview-source');
    const filenameInput = document.getElementById('filename');
    const wordCount = document.getElementById('word-count');
    const saveHint = document.getElementById('save-hint');
    const toast = document.getElementById('toast');

    const STORAGE_KEY = 'md_editor_content';
    const FILENAME_KEY = 'md_editor_filename';
    const RATIO_KEY = 'md_editor_ratio';
    const EDITOR_COLLAPSED_KEY = 'md_editor_editor_collapsed';
    const PREVIEW_COLLAPSED_KEY = 'md_editor_preview_collapsed';
    const PREVIEW_MODE_KEY = 'md_editor_preview_mode';
    const DOCS_KEY = 'md_editor_documents';
    const CURRENT_DOC_KEY = 'md_editor_current_document';
    const EMPTY_DOCUMENTS_KEY = 'md_editor_documents_intentionally_empty';
    const SIDEBAR_TAB_KEY = 'md_editor_sidebar_tab';
    const SIDEBAR_WIDTH_KEY = 'md_editor_sidebar_width';
    const RECENT_FILES_KEY = 'md_editor_recent_files';
    const OUTLINE_COLLAPSED_KEY = 'md_editor_outline_collapsed';
    const DOCUMENT_INDEX_KEY_PREFIX = 'md_editor_document_index_v1:';
    const MAX_RECENT_FILES = 20;
    const COMPACT_SHELL_WINDOW_WIDTH = 860;
    const COMPACT_SHELL_EXIT_WIDTH = 900;
    const WINDOW_RESIZE_SETTLE_MS = 220;

    let previewMode = 'preview';
    let documents = [];
    let currentDocumentId = null;
    let sidebarVisible = true;
    let sidebarAutoCollapsed = false;
    let compactShellActive = false;
    let compactShellRaf = 0;
    let compactShellInitialized = false;
    let windowResizeActiveUntil = 0;
    let windowResizeSettleTimer = 0;
    let windowResizeBurstStartedAt = 0;
    let windowResizeBurstEvents = 0;
    let activeSidebarTab = 'docs';
    let sidebarWidth = 248;
    let recentFiles = [];
    let autoSaveEnabled = true;
    let autoSaveDelay = 500;
    let editorFontSize = 16;
    let editorTextColor = '';
    let activeLineColor = '';
    let exportDirectory = '';
    let toolbarVisible = true;
    let toolbarHiddenItems = new Set();
    let toolbarBoundaryObserver = null;
    let toolbarBoundaryRaf = 0;
    let toolbarBoundaryInitialized = false;
    let toolbarBoundaryWrapped = false;
    let contextDocumentId = null;
    let contextOutlineId = '';
    let outlineCollapsed = {};
    let previewPerformanceMode = 'auto';
    let tableVisualEditingEnabled = false;
    let codeVisualEditingEnabled = false;
    let cachedHeadings = [];
    let cachedHeadingSource = null;
    let outlineDirty = true;
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

    function normalizeRecentFilePath(path) {
      return String(path || '').trim();
    }

    function loadRecentFiles() {
      try {
        const parsed = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || '[]');
        recentFiles = Array.isArray(parsed)
          ? parsed.filter(item => item && normalizeRecentFilePath(item.path)).slice(0, MAX_RECENT_FILES).map(item => ({
              path: normalizeRecentFilePath(item.path),
              name: String(item.name || getFileNameFromPath(item.path) || '未命名文件'),
              openedAt: Number(item.openedAt) || 0
            }))
          : [];
        saveRecentFiles();
      } catch (_) {
        recentFiles = [];
      }
    }

    function saveRecentFiles() {
      try {
        localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(recentFiles.slice(0, MAX_RECENT_FILES)));
      } catch (error) {
        console.warn('Recent file storage failed:', error);
      }
    }

    function addRecentFile(path, name = '', refresh = true) {
      const normalizedPath = normalizeRecentFilePath(path);
      if (!normalizedPath) return;
      const pathKey = normalizedPath.toLocaleLowerCase();
      recentFiles = recentFiles.filter(item => normalizeRecentFilePath(item.path).toLocaleLowerCase() !== pathKey);
      recentFiles.unshift({
        path: normalizedPath,
        name: String(name || getFileNameFromPath(normalizedPath) || '未命名文件'),
        openedAt: Date.now()
      });
      recentFiles = recentFiles.slice(0, MAX_RECENT_FILES);
      saveRecentFiles();
      if (refresh) renderRecentFilesMenu();
    }

    function clearRecentFiles() {
      recentFiles = [];
      saveRecentFiles();
      renderRecentFilesMenu();
      closeAppMenus();
      showToast('已清空最近打开记录');
    }

    async function openRecentFile(path) {
      closeAppMenus();
      const normalizedPath = normalizeRecentFilePath(path);
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

    function normalizeSidebarWidth(value) {
      const numeric = Number(value);
      const workspaceWidth = document.querySelector('.workspace')?.clientWidth || window.innerWidth || 1200;
      const maxWidth = Math.max(240, Math.min(520, workspaceWidth - 360));
      if (!Number.isFinite(numeric)) return 248;
      return Math.round(Math.max(180, Math.min(maxWidth, numeric)));
    }

    function applySidebarWidth() {
      sidebarWidth = normalizeSidebarWidth(sidebarWidth);
      document.documentElement.style.setProperty('--sidebar-width', sidebarWidth + 'px');
      const resizer = document.getElementById('sidebar-resizer');
      resizer?.setAttribute('aria-valuemin', '180');
      resizer?.setAttribute('aria-valuemax', '520');
      resizer?.setAttribute('aria-valuenow', String(sidebarWidth));
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
    let previewSourceScrollRaf = 0;
    let pendingPreviewSourceSide = '';
    let activeOutlineRow = null;
    let activeOutlineHeadingId = '';

    function t(key, ...args) {
      return coreI18nPort.t(key, ...args);
    }

    function refreshClassicLocalizedState() {
      updateCollapseBtnLabels();
      updateViewMenuLabel();
      updateStatusBar();
      updateCount();
      scheduleToolbarBoundaryEvaluation?.();
    }

    coreI18nPort.subscribe(() => refreshClassicLocalizedState());

    function updateCollapseBtnLabels() {
      const editorBtn = document.getElementById('editor-collapse-btn');
      const previewBtn = document.getElementById('preview-collapse-btn');
      if (editorBtn) editorBtn.title = editorCollapsed ? t('expandEditor') : t('collapseEditor');
      if (previewBtn) previewBtn.title = previewCollapsed ? t('expandPreview') : t('collapsePreview');
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
      if (!event || event.documentId !== currentDocumentId) return;
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
          if (activeSidebarTab === 'outline') renderOutline();
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

    function createDocument(title, content = '', filePath = '') {
      const now = getCurrentTimestamp();
      const document = {
        id: 'doc_' + now + '_' + Math.random().toString(36).slice(2, 8),
        title: normalizeDocumentTitle(title || t('filenameDefault')),
        content,
        createdAt: now,
        updatedAt: now
      };
      if (filePath) document.filePath = String(filePath);
      return document;
    }

    function normalizeDocumentTitle(name) {
      name = String(name || '').trim() || t('filenameDefault');
      if (!/\.(md|markdown|txt)$/i.test(name)) name += '.md';
      return name;
    }

    function loadDocumentsFromStorage() {
      try {
        const parsed = JSON.parse(localStorage.getItem(DOCS_KEY) || '[]');
        documents = Array.isArray(parsed) ? parsed.filter(doc => doc && doc.id) : [];
      } catch (_) {
        documents = [];
      }
    }

    function serializeDocumentsForStorage() {
      const nativeStore = window.markdownEditorDocumentStore;
      return documents.map(doc => {
        if (!doc.nativeBacked || !nativeStore?.available) return doc;
        const stored = { ...doc };
        delete stored.content;
        return stored;
      });
    }

    function saveDocumentsToStorage() {
      try {
        localStorage.setItem(DOCS_KEY, JSON.stringify(serializeDocumentsForStorage()));
        if (documents.length) localStorage.removeItem(EMPTY_DOCUMENTS_KEY);
        else localStorage.setItem(EMPTY_DOCUMENTS_KEY, 'true');
        if (currentDocumentId) localStorage.setItem(CURRENT_DOC_KEY, currentDocumentId);
        else localStorage.removeItem(CURRENT_DOC_KEY);
      } catch (error) {
        console.warn('Document metadata storage failed:', error);
      }
    }

    async function loadDocumentContent(doc) {
      if (!doc) return { content: '', loaded: null };
      let loaded = null;
      if (doc.nativeBacked && window.markdownEditorDocumentStore?.available) {
        try {
          loaded = await window.markdownEditorDocumentStore.load(doc.id);
        } catch (error) {
          console.warn('Native document restore failed:', error);
        }
      }
      if (loaded) {
        if (typeof loaded.content === 'string') doc.content = loaded.content;
        else if (Array.isArray(loaded.contentChunks)) delete doc.content;
        doc.title = loaded.title || doc.title || t('filenameDefault');
        doc.updatedAt = Math.max(Number(doc.updatedAt) || 0, Number(loaded.updatedAt) || 0);
        doc.nativeVersion = Number(loaded.version) || 0;
        if (loaded.recovered) {
          const message = loaded.recoveryMessage || '检测到未完整写入的数据，已从可用快照恢复';
          setTimeout(() => showToast(message), 0);
          window.markdownEditorPerf?.record('storage.document-recovered', {
            category: 'storage.recovery',
            status: 'recovered',
            details: { documentId: doc.id, version: doc.nativeVersion, message }
          });
        }
      } else if (doc.nativeBacked && typeof doc.content !== 'string') {
        throw new Error('无法恢复后台文档快照，为避免覆盖原内容已停止打开');
      }
      return {
        content: typeof loaded?.content === 'string' ? loaded.content : (doc.content || ''),
        chunks: Array.isArray(loaded?.contentChunks) ? loaded.contentChunks : null,
        loaded
      };
    }

    function materializeLoadedDocumentContent(restored) {
      if (typeof restored?.content === 'string' && restored.content.length) return restored.content;
      if (Array.isArray(restored?.chunks)) return restored.chunks.join('');
      if (Array.isArray(restored?.loaded?.contentChunks)) return restored.loaded.contentChunks.join('');
      return String(restored?.content || '');
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

    function activateDocumentRuntime(doc, loaded = null, content) {
      if (documentModel) {
        const options = { loaded };
        if (Array.isArray(loaded?.contentChunks)) options.chunks = loaded.contentChunks;
        else if (content !== undefined) options.content = content;
        documentModel.activate(doc, options);
      } else {
        if (Array.isArray(loaded?.contentChunks)) editor.value = loaded.contentChunks.join('');
        else if (content !== undefined) editor.value = String(content ?? '');
        editor.virtualEditor?.resetDocumentJournal?.();
      }
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
        if (activeSidebarTab === 'outline') renderOutline();
      } else if (!restoredCachedIndex) {
        updateDocumentStatistics(null);
      }
      window.markdownEditorDocumentStore?.activateDocument?.(documentModel || editor, doc, loaded);
    }

    function clearStoredDocumentSession(storedDocuments) {
      const staleDocumentIds = Array.from(new Set(
        Array.from(storedDocuments || []).map(doc => String(doc?.id || '')).filter(Boolean)
      ));
      localStorage.removeItem(DOCS_KEY);
      localStorage.removeItem(CURRENT_DOC_KEY);
      localStorage.removeItem(EMPTY_DOCUMENTS_KEY);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(FILENAME_KEY);
      for (const documentId of staleDocumentIds) clearDocumentIndex(documentId);

      const nativeStore = window.markdownEditorDocumentStore;
      if (!nativeStore?.available || typeof nativeStore.delete !== 'function' || !staleDocumentIds.length) return;
      const cleanup = () => Promise.allSettled(staleDocumentIds.map(documentId => nativeStore.delete(documentId)));
      const scheduler = window.markdownEditorTaskScheduler;
      if (scheduler?.schedule) {
        scheduler.schedule('stale-document-session-cleanup', cleanup, { priority: 'background', timeout: 1200 });
      } else {
        setTimeout(cleanup, 0);
      }
    }

    async function setupDocuments() {
      loadDocumentsFromStorage();
      const storedDocuments = documents.slice();
      for (const storedDocument of storedDocuments) {
        if (storedDocument?.filePath) addRecentFile(storedDocument.filePath, storedDocument.title, false);
      }
      renderRecentFilesMenu();
      clearStoredDocumentSession(storedDocuments);

      documents = [];
      currentDocumentId = '';
      filenameInput.value = t('filenameDefault');
      activateDocumentRuntime(null, null, '');
      saveDocumentsToStorage();
      renderDocumentList();

      window.markdownEditorPerf?.record?.('document.session-reset', {
        category: 'document.lifecycle',
        durationMs: 0,
        details: {
          discardedDocuments: storedDocuments.length,
          migratedRecentFiles: storedDocuments.filter(item => item?.filePath).length,
          currentDocumentId,
          emptyWorkspace: true
        }
      });
    }

    function getCurrentDocument() {
      return documents.find(doc => doc.id === currentDocumentId) || null;
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
      const current = getCurrentDocument();
      if (current) return current;
      const doc = createDocument(t('filenameDefault'), documentModel?.createSnapshot?.('lazy-document-create') ?? editor.value);
      documents.unshift(doc);
      currentDocumentId = doc.id;
      filenameInput.value = doc.title;
      documentModel?.adoptDocument?.(doc);
      window.markdownEditorDocumentStore?.activateDocument?.(documentModel || editor, doc, null);
      saveDocumentsToStorage();
      renderDocumentList();
      window.markdownEditorPerf?.record?.('document.lazy-created', {
        category: 'document.lifecycle',
        durationMs: 0,
        details: { documentId: doc.id, characters: editor.textLength }
      });
      return doc;
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
          currentDocumentId: currentDocumentId || '',
          runtimeDocumentId: documentModel?.documentId || ''
        }
      });
      return message;
    }

    async function saveCurrentDocumentState(refreshList = true, options = {}) {
      let doc = getCurrentDocument();
      const runtimeDocumentId = String(documentModel?.documentId || '');
      if (runtimeDocumentId && doc?.id !== runtimeDocumentId) {
        const runtimeDocument = documents.find(item => item.id === runtimeDocumentId);
        if (runtimeDocument) {
          doc = runtimeDocument;
          currentDocumentId = runtimeDocument.id;
          localStorage.setItem(CURRENT_DOC_KEY, currentDocumentId);
          window.markdownEditorPerf?.record?.('document.runtime-reconciled', {
            category: 'document.recovery',
            status: 'recovered',
            details: { documentId: currentDocumentId }
          });
        }
      }
      if (!doc) return { native: false };
      doc.title = normalizeDocumentTitle(filenameInput.value);
      doc.updatedAt = getCurrentTimestamp();

      const nativeStore = window.markdownEditorDocumentStore;
      documentModel?.updateTitle?.(doc.title);
      const contentLength = documentModel?.getTextLength?.() ?? editor.textLength;
      const useNative = nativeStore?.shouldUse?.(doc, contentLength);
      const wasNativeBacked = Boolean(doc.nativeBacked);
      if (!useNative || !wasNativeBacked) doc.content = documentModel?.createSnapshot?.('document-storage') ?? editor.value;
      let nativeSave = Promise.resolve({ native: false });
      if (useNative) {
        nativeSave = nativeStore.save(documentModel || editor, doc, { forceSnapshot: Boolean(options.forceSnapshot) });
        if (options.waitForNative) {
          try {
            await nativeSave;
            if (doc.nativeBacked) {
              delete doc.content;
              if (doc.id === currentDocumentId) localStorage.removeItem(STORAGE_KEY);
            }
            if (!wasNativeBacked) saveDocumentsToStorage();
          } catch (error) {
            console.error('Native document save failed:', error);
            throw error;
          }
        } else {
          nativeSave = nativeSave.then(result => {
            if (doc.nativeBacked) {
              delete doc.content;
              if (doc.id === currentDocumentId) localStorage.removeItem(STORAGE_KEY);
            }
            saveDocumentsToStorage();
            return result;
          }).catch(error => {
            console.error('Native document save failed:', error);
            return { native: false, error: error?.message || String(error) };
          });
        }
      }

      if (!useNative || wasNativeBacked) saveDocumentsToStorage();
      if (!useNative) {
        documentModel?.markPersisted?.(documentModel.getDocumentVersion(), 0);
      }
      if (refreshList) renderDocumentList();
      return nativeSave;
    }

    function resetHistoryForCurrentDocument() {
      if (editor.virtualEditor?.consumeDocumentLoadHistoryReset?.()) {
        historyStack = [];
        historyIndex = -1;
        lastHistoryText = null;
        return;
      }
      if (editor.virtualEditor?.resetHistory) {
        editor.virtualEditor.resetHistory();
        historyStack = [];
        historyIndex = -1;
        lastHistoryText = null;
        return;
      }
      historyStack = [editor.value];
      historyIndex = 0;
      lastHistoryText = editor.value;
    }

    function normalizeWorkspaceFilePath(path) {
      const value = String(path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
      if (!value) return '';
      return (/^[a-z]:\//i.test(value) || value.startsWith('//')) ? value.toLocaleLowerCase() : value;
    }

    async function openFolderTreeFile(path) {
      const normalizedPath = normalizeWorkspaceFilePath(path);
      if (!normalizedPath) return false;
      const existing = documents.find(item => normalizeWorkspaceFilePath(item?.filePath) === normalizedPath);
      if (existing) {
        if (existing.id !== currentDocumentId) await openDocument(existing.id);
        setSidebarTab('files');
        return true;
      }
      if (typeof handleNativeDroppedPath !== 'function') return false;
      const opened = await handleNativeDroppedPath(path);
      if (opened) setSidebarTab('files');
      return opened;
    }

    async function openDocument(id) {
      if (id === currentDocumentId) return;
      const previousDocumentId = currentDocumentId;
      let activated = false;
      try {
        clearTimeout(saveTimer);
        await saveCurrentDocumentState(false, { waitForNative: true });
        const doc = documents.find(item => item.id === id);
        if (!doc) throw new Error('目标文档不存在或已被删除');
        const restored = await loadDocumentContent(doc);

        // 先原子切换正文与编辑器状态，成功后再提交当前文档 ID。
        activateDocumentRuntime(doc, restored.loaded, restored.content);
        currentDocumentId = doc.id;
        activated = true;
        filenameInput.value = doc.title || t('filenameDefault');
        localStorage.setItem(FILENAME_KEY, filenameInput.value);
        localStorage.setItem(CURRENT_DOC_KEY, currentDocumentId);
        resetHistoryForCurrentDocument();
        await resetPreviewPipeline();
        updateCount();
        saveDocumentsToStorage();
        renderDocumentList();
        showToast('已切换文档');
      } catch (error) {
        if (error?.message === 'DOCUMENT_LOAD_CANCELLED') return;
        if (!activated) {
          currentDocumentId = previousDocumentId;
          if (previousDocumentId) localStorage.setItem(CURRENT_DOC_KEY, previousDocumentId);
        }
        showToast(recordDocumentOperationError('open', error, { targetDocumentId: id, activated }));
      }
    }

    async function newDocument() {
      try {
        clearTimeout(saveTimer);
        await saveCurrentDocumentState(false, { waitForNative: true });
        const index = documents.length + 1;
        const doc = createDocument('未命名文档-' + index + '.md', '');
        activateDocumentRuntime(doc, null, '');
        documents.unshift(doc);
        currentDocumentId = doc.id;
        filenameInput.value = doc.title;
        localStorage.setItem(CURRENT_DOC_KEY, currentDocumentId);
        resetHistoryForCurrentDocument();
        await resetPreviewPipeline();
        updateCount();
        saveDocumentsToStorage();
        renderDocumentList();
        setSidebarTab('docs');
        showToast('已新建文档');
        editor.focus();
      } catch (error) {
        showToast(recordDocumentOperationError('new', error));
      }
    }

    async function duplicateDocument(id = currentDocumentId) {
      try {
        await saveCurrentDocumentState(false, { waitForNative: true });
        const source = documents.find(item => item.id === id) || getCurrentDocument();
        if (!source) return;
        const sourceIsInactiveNative = source.id !== currentDocumentId && source.nativeBacked;
        const restored = source.id === currentDocumentId
          ? { content: documentModel?.createSnapshot?.('duplicate-document') ?? editor.value }
          : await loadDocumentContent(source);
        const baseName = source.title.replace(/\.(md|markdown|txt)$/i, '');
        const doc = createDocument(baseName + ' 副本.md', materializeLoadedDocumentContent(restored));
        if (sourceIsInactiveNative) delete source.content;
        const sourceIndex = documents.findIndex(item => item.id === source.id);
        documents.splice(sourceIndex >= 0 ? sourceIndex + 1 : documents.length, 0, doc);
        currentDocumentId = doc.id;
        filenameInput.value = doc.title;
        activateDocumentRuntime(doc, null, doc.content);
        resetHistoryForCurrentDocument();
        await resetPreviewPipeline();
        updateCount();
        saveDocumentsToStorage();
        renderDocumentList();
        setSidebarTab('docs');
        showToast('已复制文档');
      } catch (error) {
        showToast(recordDocumentOperationError('duplicate', error, { sourceDocumentId: id }));
      }
    }

    function renameDocument(id = currentDocumentId) {
      const doc = documents.find(item => item.id === id) || getCurrentDocument();
      if (!doc) return;
      const nextName = prompt('重命名文档', doc.title || filenameInput.value || t('filenameDefault'));
      if (nextName === null) return;
      const normalized = normalizeDocumentTitle(nextName);
      doc.title = normalized;
      doc.updatedAt = getCurrentTimestamp();
      if (doc.id === currentDocumentId) {
        filenameInput.value = normalized;
        documentModel?.updateTitle?.(normalized);
        localStorage.setItem(FILENAME_KEY, normalized);
        autoSave();
      }
      saveDocumentsToStorage();
      renderDocumentList();
      showToast('已重命名文档');
    }

    function renameCurrentDocument() {
      renameDocument(currentDocumentId);
    }

    function hasUnsavedDocumentChanges(id) {
      if (
        id !== currentDocumentId
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
      const doc = documents.find(item => item.id === id);
      if (!doc) return;

      const shouldSaveBeforeClose = hasUnsavedDocumentChanges(id);
      if (shouldSaveBeforeClose) {
        const confirmed = await confirmUserAction('文档「' + doc.title + '」尚未自动保存。是否立即保存并关闭？', {
          title: '关闭未保存的文档',
          kind: 'warning',
          okLabel: '保存并关闭',
          cancelLabel: '返回编辑'
        });
        if (!confirmed) return;
      }

      try {
        if (currentDocumentId === id) {
          clearTimeout(saveTimer);
          if (shouldSaveBeforeClose) {
            const saved = await saveCurrentFile();
            if (!saved) return;
          } else if (documentModel?.dirty) {
            await saveCurrentDocumentState(false, { waitForNative: true });
          }
        }
        const index = documents.findIndex(item => item.id === id);
        documents = documents.filter(item => item.id !== id);
        await window.markdownEditorDocumentStore?.delete?.(id);
        clearDocumentIndex(id);
        if (currentDocumentId === id) {
          const next = documents[Math.max(0, Math.min(index, documents.length - 1))];
          if (next) {
            currentDocumentId = next.id;
            const restored = await loadDocumentContent(next);
            filenameInput.value = next.title || t('filenameDefault');
            activateDocumentRuntime(next, restored.loaded, restored.content);
            localStorage.setItem(CURRENT_DOC_KEY, currentDocumentId);
            localStorage.setItem(FILENAME_KEY, filenameInput.value);
          } else {
            currentDocumentId = null;
            filenameInput.value = t('filenameDefault');
            localStorage.removeItem(CURRENT_DOC_KEY);
            localStorage.removeItem(FILENAME_KEY);
            localStorage.removeItem(STORAGE_KEY);
            activateDocumentRuntime(null, null, '');
          }
          resetHistoryForCurrentDocument();
          await resetPreviewPipeline();
          updateCount();
        }
        saveDocumentsToStorage();
        renderDocumentList();
        showToast('已关闭文档');
      } catch (error) {
        showToast(error?.message || String(error));
      }
    }

    // 保留旧入口，避免已有内联调用或性能工具失效。
    function deleteDocument(id, event) {
      return closeDocument(id, event);
    }

    function renderDocumentList() {
      const list = document.getElementById('document-list');
      if (!list) return;
      if (!documents.length) {
        list.innerHTML = '<div class="sidebar-empty">暂无文档</div>';
        window.markdownEditorFileTree?.syncCurrentDocument?.(
          window.markdownEditorRuntimeContext?.getCurrentDocumentContext?.()
        );
        return;
      }
      list.innerHTML = documents.map(doc => {
        const active = doc.id === currentDocumentId ? ' active' : '';
        const meta = doc.updatedAt ? new Date(doc.updatedAt).toLocaleString() : '';
        return '<div class="document-item' + active + '" onclick="openDocument(\'' + doc.id + '\')" oncontextmenu="openDocumentContextMenu(\'' + doc.id + '\', event)">'
          + '<div class="document-summary"><div class="document-title" title="' + escapeHtml(doc.title || '') + '">' + escapeHtml(doc.title || t('filenameDefault')) + '</div>'
          + '<div class="document-meta">' + escapeHtml(meta) + '</div></div>'
          + '<button type="button" class="document-close" title="关闭文档" aria-label="关闭文档 ' + escapeHtml(doc.title || t('filenameDefault')) + '" onclick="closeDocument(\'' + doc.id + '\', event)">×</button>'
          + '</div>';
      }).join('');
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
      document.querySelectorAll('.context-menu.show').forEach(menu => {
        menu.classList.remove('show');
        menu.style.display = 'none';
      });
    }

    function openDocumentContextMenu(id, event) {
      contextDocumentId = id;
      showContextMenu(document.getElementById('document-context-menu'), event);
    }

    function openSidebarContextMenu(event) {
      if (event.target.closest('.document-item')) return;
      showContextMenu(document.getElementById('sidebar-context-menu'), event);
    }

    function getContextDocument() {
      return documents.find(item => item.id === contextDocumentId) || getCurrentDocument();
    }

    function openContextDocument() {
      const doc = getContextDocument();
      if (doc) openDocument(doc.id);
    }

    function renameContextDocument() {
      const doc = getContextDocument();
      if (doc) renameDocument(doc.id);
    }

    function duplicateContextDocument() {
      const doc = getContextDocument();
      if (doc) duplicateDocument(doc.id);
    }

    function closeContextDocument() {
      const doc = getContextDocument();
      if (doc) closeDocument(doc.id);
    }

    function deleteContextDocument() {
      closeContextDocument();
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

    async function exportContextDocument() {
      const doc = getContextDocument();
      if (!doc) return;
      const releaseContent = doc.id !== currentDocumentId && doc.nativeBacked;
      try {
        const content = doc.id === currentDocumentId
          ? (documentModel?.createSnapshot?.('context-export') ?? editor.value)
          : materializeLoadedDocumentContent(await loadDocumentContent(doc));
        const name = doc.title || t('filenameDefault');
        const savedPath = await exportTextContent(content, name, getExportSaveOptions(
          '导出 Markdown',
          'md',
          'Markdown 文档',
          ['md', 'markdown']
        ));
        if (savedPath === null) return;
        if (savedPath === false) exportMarkdownContent(content, name);
        showToast('已导出 Markdown');
      } catch (error) {
        showToast(error?.message || String(error));
      } finally {
        if (releaseContent) delete doc.content;
      }
    }

    async function saveAsContextDocument() {
      const doc = getContextDocument();
      if (!doc) return;
      const releaseContent = doc.id !== currentDocumentId && doc.nativeBacked;
      try {
        const savedPath = await saveMarkdownWithPicker(async () => {
          if (doc.id === currentDocumentId) {
            return documentModel?.createSnapshot?.('context-save-as') ?? editor.value;
          }
          return materializeLoadedDocumentContent(await loadDocumentContent(doc));
        }, doc.title || t('filenameDefault'), 'context-save-as');
        if (savedPath) {
          if (typeof savedPath === 'string') bindDocumentFilePath(doc, savedPath);
          showToast('已另存为 Markdown');
        }
      } catch (error) {
        showToast('另存为失败：' + (error?.message || String(error)));
      } finally {
        if (releaseContent) delete doc.content;
      }
    }

    function copyContextDocumentTitle() {
      const doc = getContextDocument();
      if (!doc) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(doc.title || '').then(() => showToast('已复制文件名')).catch(() => showToast(doc.title || ''));
      } else {
        showToast(doc.title || '');
      }
    }

    function setSidebarTab(tab) {
      activeSidebarTab = ['docs', 'files', 'outline'].includes(tab) ? tab : 'docs';
      localStorage.setItem(SIDEBAR_TAB_KEY, activeSidebarTab);
      document.getElementById('sidebar-docs-tab')?.classList.toggle('active', activeSidebarTab === 'docs');
      document.getElementById('sidebar-files-tab')?.classList.toggle('active', activeSidebarTab === 'files');
      document.getElementById('sidebar-outline-tab')?.classList.toggle('active', activeSidebarTab === 'outline');
      document.getElementById('sidebar-docs-panel')?.classList.toggle('active', activeSidebarTab === 'docs');
      document.getElementById('sidebar-files-panel')?.classList.toggle('active', activeSidebarTab === 'files');
      document.getElementById('sidebar-outline-panel')?.classList.toggle('active', activeSidebarTab === 'outline');
      if (activeSidebarTab === 'files') window.markdownEditorFileTree?.activate?.();
      else window.markdownEditorFileTree?.deactivate?.();
      if (activeSidebarTab === 'outline' && (outlineDirty || !cachedHeadings.length)) renderOutline();
    }

    let activeLayoutTransition = null;

    function isWindowResizeBurstActive() {
      return performance.now() < windowResizeActiveUntil;
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

    function markWindowResizeActivity() {
      const now = performance.now();
      if (!windowResizeBurstStartedAt) windowResizeBurstStartedAt = now;
      windowResizeBurstEvents += 1;
      windowResizeActiveUntil = now + WINDOW_RESIZE_SETTLE_MS;
      clearTimeout(windowResizeSettleTimer);
      windowResizeSettleTimer = setTimeout(() => {
        const durationMs = Math.max(0, performance.now() - windowResizeBurstStartedAt);
        const events = windowResizeBurstEvents;
        windowResizeActiveUntil = 0;
        windowResizeBurstStartedAt = 0;
        windowResizeBurstEvents = 0;
        scheduleCompactShellEvaluation();
        scheduleCompactSplitEvaluation();
        scheduleToolbarBoundaryEvaluation();
        window.markdownEditorPerf?.record?.('layout.window-resize-settled', {
          category: 'ui.layout',
          durationMs: 0,
          details: {
            durationMs: Number(durationMs.toFixed(1)),
            events,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight
          }
        });
      }, WINDOW_RESIZE_SETTLE_MS);
    }

    function runLayoutTransition(commit, kind = 'layout') {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const canUseViewTransition = typeof document.startViewTransition === 'function'
        && document.documentElement.classList.contains('app-ready')
        && !reduceMotion
        && !isResizing
        && !isSidebarResizing
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

    function isSidebarEffectivelyVisible() {
      return sidebarVisible && !sidebarAutoCollapsed;
    }

    function applySidebarVisibility() {
      const sidebar = document.getElementById('sidebar');
      if (!sidebar) return;
      const visible = isSidebarEffectivelyVisible();
      sidebar.classList.toggle('hidden', !visible);
      sidebar.classList.toggle('is-hidden', !visible);
      sidebar.setAttribute('aria-hidden', visible ? 'false' : 'true');
      document.getElementById('sidebar-resizer')?.classList.toggle('hidden', !visible);
      document.getElementById('sidebar-resizer')?.classList.toggle('is-hidden', !visible);
      scheduleEditorMetricsRebuild(100);
      invalidatePreviewAnchorMetrics();
    }

    function evaluateCompactShellLayout() {
      const compactThreshold = compactShellActive ? COMPACT_SHELL_EXIT_WIDTH : COMPACT_SHELL_WINDOW_WIDTH;
      const nextCompact = window.innerWidth <= compactThreshold;
      const changed = nextCompact !== compactShellActive;
      compactShellActive = nextCompact;
      sidebarAutoCollapsed = nextCompact;
      document.documentElement.classList.toggle('compact-shell', nextCompact);
      document.documentElement.classList.toggle('is-compact-shell', nextCompact);
      if (changed) {
        closeAppMenus();
        applySidebarVisibility();
        scheduleCompactSplitEvaluation?.();
        window.markdownEditorPerf?.record?.('layout.compact-shell-change', {
          category: 'ui.layout',
          durationMs: 0,
          details: {
            active: nextCompact,
            viewportWidth: window.innerWidth,
            sidebarAutoCollapsed
          }
        });
      }
      return nextCompact;
    }

    function scheduleCompactShellEvaluation() {
      closeAppMenus();
      if (compactShellRaf) cancelAnimationFrame(compactShellRaf);
      compactShellRaf = requestAnimationFrame(() => {
        compactShellRaf = 0;
        evaluateCompactShellLayout();
      });
    }

    function initializeCompactShellLayout() {
      if (!compactShellInitialized) {
        compactShellInitialized = true;
        window.addEventListener('resize', () => {
          markWindowResizeActivity();
          scheduleCompactShellEvaluation();
        }, { passive: true });
      }
      evaluateCompactShellLayout();
    }

    function toggleSidebar() {
      if (sidebarAutoCollapsed) {
        showToast('当前窗口较窄，侧边栏已自动折叠');
        return;
      }
      const nextVisible = !sidebarVisible;
      coreSettingsStorePort.set('sidebarVisible', nextVisible);
      sidebarVisible = nextVisible;
      runLayoutTransition(applySidebarVisibility, 'sidebar');
      showToast(sidebarVisible ? '已显示侧边栏' : '已隐藏侧边栏');
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
      sidebarVisible = applied.sidebarVisible;
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
      applySidebarVisibility();
      applyEditorPreferences();
      updateStatusBar();
      autoSave();
      showToast('设置已保存');
    });

    function evaluateToolbarBoundary() {
      const toolbar = document.querySelector('.editor-toolbar');
      const formatGroup = toolbar?.querySelector('.format-group');
      const actions = toolbar?.querySelector('.editor-actions');
      if (!toolbar || !formatGroup || !actions) return;

      if (toolbar.classList.contains('hidden')) {
        toolbar.classList.remove('toolbar-boundary-wrap');
        toolbarBoundaryWrapped = false;
        return;
      }

      const mediaWrap = Boolean(window.matchMedia?.('(max-width: 768px)').matches);
      if (!mediaWrap) {
        // Measure the original single-row toolbar, then apply wrapping before the frame paints.
        toolbar.classList.remove('toolbar-boundary-wrap');
        void toolbar.offsetWidth;
      }

      const toolbarStyle = getComputedStyle(toolbar);
      const horizontalPadding = (parseFloat(toolbarStyle.paddingLeft) || 0)
        + (parseFloat(toolbarStyle.paddingRight) || 0);
      const columnGap = parseFloat(toolbarStyle.columnGap || toolbarStyle.gap) || 0;
      const availableWidth = Math.max(0, toolbar.clientWidth - horizontalPadding);
      const requiredWidth = Math.ceil(formatGroup.scrollWidth + actions.scrollWidth + columnGap);
      const shouldWrap = mediaWrap || requiredWidth > availableWidth;
      const previousWrapped = toolbarBoundaryWrapped;

      toolbar.classList.toggle('toolbar-boundary-wrap', shouldWrap);
      toolbarBoundaryWrapped = shouldWrap;

      if (previousWrapped !== shouldWrap) {
        window.markdownEditorPerf?.record?.('layout.toolbar-boundary-change', {
          category: 'ui.layout',
          durationMs: 0,
          details: {
            wrapped: shouldWrap,
            toolbarWidth: Math.round(toolbar.getBoundingClientRect().width),
            availableWidth: Math.round(availableWidth),
            requiredWidth: Math.round(requiredWidth)
          }
        });
      }
    }

    function scheduleToolbarBoundaryEvaluation() {
      if (toolbarBoundaryRaf) cancelAnimationFrame(toolbarBoundaryRaf);
      toolbarBoundaryRaf = requestAnimationFrame(() => {
        toolbarBoundaryRaf = 0;
        evaluateToolbarBoundary();
      });
    }

    function initializeToolbarBoundaryLayout() {
      if (toolbarBoundaryInitialized) {
        scheduleToolbarBoundaryEvaluation();
        return;
      }
      toolbarBoundaryInitialized = true;
      const toolbar = document.querySelector('.editor-toolbar');
      const formatGroup = toolbar?.querySelector('.format-group');
      const actions = toolbar?.querySelector('.editor-actions');
      if (!toolbar || !formatGroup || !actions) return;

      if (typeof ResizeObserver === 'function') {
        toolbarBoundaryObserver = new ResizeObserver(scheduleToolbarBoundaryEvaluation);
        toolbarBoundaryObserver.observe(toolbar);
      } else {
        window.addEventListener('resize', scheduleToolbarBoundaryEvaluation, { passive: true });
      }
      document.fonts?.ready?.then(scheduleToolbarBoundaryEvaluation).catch?.(() => {});
      scheduleToolbarBoundaryEvaluation();
    }

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
      scheduleToolbarBoundaryEvaluation();
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
      initializeToolbarBoundaryLayout();
      if (typeof updateInlineColorToolAvailability === 'function') updateInlineColorToolAvailability();
      scheduleEditorMetricsRebuild(80);
      invalidatePreviewAnchorMetrics();
    }

    let fetchedHtml = '';
    let editorCollapsed = false;
    let previewCollapsed = false;
    let editorRatio = 0.5;
    let isResizing = false;
    let resizeRect = null;
    let resizeStartedAt = 0;
    let resizeMoveEvents = 0;
    let resizeStartRatio = 0.5;
    let isSidebarResizing = false;
    let sidebarResizeRect = null;
    let splitApplyRaf = 0;
    const COMPACT_SPLIT_MAIN_WIDTH = 720;
    const COMPACT_SPLIT_EXIT_MAIN_WIDTH = 760;
    let compactSplitActive = false;
    let compactSplitPane = 'editor';
    let compactSplitObserver = null;
    let compactSplitRaf = 0;

    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,
        gfm: true,
        headerIds: false,
        mangle: false
      });
    }
    const PAGE_FULLSCREEN_KEY = 'md_editor_page_fullscreen';
    const MAX_HISTORY = 100;
    let historyStack = [];
    let historyIndex = -1;
    let lastHistoryText = null;
    let historyTimer = null;

    function getConfiguredLayoutMode() {
      return coreSettingsStorePort.get('layoutMode');
    }

    function getMainLayoutWidth() {
      const main = document.querySelector('.main');
      return Math.max(0, main?.getBoundingClientRect?.().width || main?.clientWidth || 0);
    }

    function shouldUseCompactSplit(mode = getConfiguredLayoutMode()) {
      const width = getMainLayoutWidth();
      const threshold = compactSplitActive ? COMPACT_SPLIT_EXIT_MAIN_WIDTH : COMPACT_SPLIT_MAIN_WIDTH;
      return mode === 'both' && width > 0 && width <= threshold;
    }

    function setCompactSplitClass(active) {
      document.querySelector('.main')?.classList.toggle('compact-split', Boolean(active));
      document.querySelector('.main')?.classList.toggle('is-compact-split', Boolean(active));
    }

    function persistPaneCollapsedState() {
      localStorage.setItem(EDITOR_COLLAPSED_KEY, editorCollapsed ? 'true' : 'false');
      localStorage.setItem(PREVIEW_COLLAPSED_KEY, previewCollapsed ? 'true' : 'false');
    }

    function commitResponsivePaneState(options = {}) {
      const commit = () => applyPaneStates(true);
      if (options.animate === false || isWindowResizeBurstActive()) commit();
      else runLayoutTransition(commit, 'panes');
    }

    function reconcileCompactSplitLayout(mode = getConfiguredLayoutMode(), options = {}) {
      const shouldCompact = shouldUseCompactSplit(mode);
      const wasCompact = compactSplitActive;
      const previewWasCollapsed = previewCollapsed;

      if (!shouldCompact) {
        compactSplitActive = false;
        setCompactSplitClass(false);
        if (wasCompact && mode === 'both') {
          editorCollapsed = false;
          previewCollapsed = false;
          persistPaneCollapsedState();
          if (options.apply !== false) commitResponsivePaneState(options);
          refreshPreviewAfterLayout?.({ forceRender: previewWasCollapsed, reason: 'compact-split:exit' });
        }
        return false;
      }

      compactSplitActive = true;
      setCompactSplitClass(true);
      if (!wasCompact || options.resetPane) compactSplitPane = 'editor';
      const nextEditorCollapsed = compactSplitPane !== 'editor';
      const nextPreviewCollapsed = compactSplitPane !== 'preview';
      const stateChanged = !wasCompact
        || editorCollapsed !== nextEditorCollapsed
        || previewCollapsed !== nextPreviewCollapsed;
      editorCollapsed = nextEditorCollapsed;
      previewCollapsed = nextPreviewCollapsed;
      if (stateChanged) {
        persistPaneCollapsedState();
        if (options.apply !== false) commitResponsivePaneState(options);
        if (!previewCollapsed) {
          refreshPreviewAfterLayout?.({ forceRender: previewWasCollapsed, reason: 'compact-split:enter' });
        }
      }
      return true;
    }

    function activateCompactSplitPane(pane, reason = 'pane-click') {
      if (!compactSplitActive || getConfiguredLayoutMode() !== 'both') return false;
      const nextPane = pane === 'preview' ? 'preview' : 'editor';
      const previewWasCollapsed = previewCollapsed;
      const alreadyActive = nextPane === 'editor'
        ? !editorCollapsed && previewCollapsed
        : editorCollapsed && !previewCollapsed;
      if (alreadyActive) return true;
      compactSplitPane = nextPane;
      editorCollapsed = nextPane !== 'editor';
      previewCollapsed = nextPane !== 'preview';
      persistPaneCollapsedState();
      runLayoutTransition(() => applyPaneStates(true), 'panes');
      if (!previewCollapsed) {
        refreshPreviewAfterLayout?.({ forceRender: previewWasCollapsed, reason: `compact-split:${reason}` });
      }
      window.markdownEditorPerf?.record?.('layout.compact-pane-change', {
        category: 'ui.layout',
        durationMs: 0,
        details: { pane: nextPane, mainWidth: Math.round(getMainLayoutWidth()), reason }
      });
      return true;
    }

    function scheduleCompactSplitEvaluation() {
      if (compactSplitRaf) cancelAnimationFrame(compactSplitRaf);
      compactSplitRaf = requestAnimationFrame(() => {
        compactSplitRaf = 0;
        reconcileCompactSplitLayout(getConfiguredLayoutMode(), { animate: false });
      });
    }

    function initializeCompactSplitObserver() {
      const main = document.querySelector('.main');
      if (!main || compactSplitObserver) return;
      if (typeof ResizeObserver === 'function') {
        compactSplitObserver = new ResizeObserver(scheduleCompactSplitEvaluation);
        compactSplitObserver.observe(main);
      } else {
        window.addEventListener('resize', scheduleCompactSplitEvaluation, { passive: true });
        compactSplitObserver = { disconnect: () => window.removeEventListener('resize', scheduleCompactSplitEvaluation) };
      }
      reconcileCompactSplitLayout(getConfiguredLayoutMode(), { animate: false });
    }

    function togglePane(pane) {
      if (typeof isHybridLayoutMode === 'function' && isHybridLayoutMode()) {
        setLayoutMode(pane === 'editor' ? 'preview' : 'both');
        return;
      }
      if (compactSplitActive && getConfiguredLayoutMode() === 'both') {
        const paneIsCollapsed = pane === 'editor' ? editorCollapsed : previewCollapsed;
        const nextPane = paneIsCollapsed ? pane : (pane === 'editor' ? 'preview' : 'editor');
        activateCompactSplitPane(nextPane, `toggle:${pane}`);
        return;
      }
      const previewWasCollapsed = previewCollapsed;
      if (pane === 'editor') {
        if (!editorCollapsed && previewCollapsed) return;
        editorCollapsed = !editorCollapsed;
      } else {
        if (!previewCollapsed && editorCollapsed) return;
        previewCollapsed = !previewCollapsed;
      }
      persistPaneCollapsedState();
      runLayoutTransition(() => applyPaneStates(true), 'panes');
      if (!previewCollapsed) {
        refreshPreviewAfterLayout?.({
          forceRender: previewWasCollapsed,
          reason: `pane:${pane}`
        });
      }
    }

    function applyPaneStates(immediateLayout = false) {
      const editorPane = document.querySelector('.editor-pane');
      const previewPane = document.querySelector('.preview-pane');
      const resizer = document.getElementById('resizer');
      editorPane.classList.toggle('collapsed', editorCollapsed);
      editorPane.classList.toggle('is-collapsed', editorCollapsed);
      previewPane.classList.toggle('collapsed', previewCollapsed);
      previewPane.classList.toggle('is-collapsed', previewCollapsed);
      resizer.classList.toggle('hidden', editorCollapsed || previewCollapsed);
      resizer.classList.toggle('is-hidden', editorCollapsed || previewCollapsed);

      const editorBtn = editorPane.querySelector('.collapse-btn');
      const previewBtn = previewPane.querySelector('.collapse-btn');

      const chevronLeft = '<svg class="icon icon-sm"><use href="/assets/icons.svg#icon-chevron-left"></use></svg>';
      const chevronRight = '<svg class="icon icon-sm"><use href="/assets/icons.svg#icon-chevron-right"></use></svg>';
      editorBtn.innerHTML = editorCollapsed ? chevronRight : chevronLeft;
      previewBtn.innerHTML = previewCollapsed ? chevronLeft : chevronRight;

      updateCollapseBtnLabels();

      applySplit(immediateLayout);
    }

    function applySplit(immediate = false) {
      const commit = () => {
        splitApplyRaf = 0;
        const started = performance.now();
        const editorPane = document.querySelector('.editor-pane');
        const previewPane = document.querySelector('.preview-pane');
        if (editorCollapsed || previewCollapsed) {
          editorPane.style.flex = '';
          previewPane.style.flex = '';
        } else {
          editorPane.style.flex = `0 0 ${editorRatio * 100}%`;
          previewPane.style.flex = '1 1 0';
        }
        invalidatePreviewAnchorMetrics();
        scheduleEditorMetricsRebuild(isResizing ? 180 : 90);
        window.markdownEditorPerf?.record('layout.commit-split', {
          category: 'ui.layout',
          durationMs: performance.now() - started,
          aggregate: true,
          details: { ratio: Number(editorRatio.toFixed(3)), resizing: isResizing }
        });
      };

      if (immediate) {
        if (splitApplyRaf) cancelAnimationFrame(splitApplyRaf);
        commit();
        return;
      }
      if (splitApplyRaf) return;
      splitApplyRaf = requestAnimationFrame(commit);
    }

    function getPointerClientX(event) {
      return event.touches ? event.touches[0]?.clientX : event.clientX;
    }

    function startSidebarResize(event) {
      if (!isSidebarEffectivelyVisible() || compactShellActive || window.matchMedia?.('(max-width: 768px)').matches) return;
      isSidebarResizing = true;
      sidebarResizeRect = document.querySelector('.workspace')?.getBoundingClientRect() || null;
      document.body.classList.add('resizing', 'sidebar-resizing', 'is-resizing', 'is-sidebar-resizing');
      document.getElementById('sidebar-resizer')?.classList.add('dragging', 'is-dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      event.preventDefault();
    }

    function onSidebarResizeMove(event) {
      if (!isSidebarResizing || !sidebarResizeRect) return;
      const clientX = getPointerClientX(event);
      if (!Number.isFinite(clientX)) return;
      sidebarWidth = normalizeSidebarWidth(clientX - sidebarResizeRect.left);
      applySidebarWidth();
      scheduleEditorMetricsRebuild(180);
      invalidatePreviewAnchorMetrics();
      event.preventDefault();
    }

    function stopSidebarResize() {
      if (!isSidebarResizing) return;
      isSidebarResizing = false;
      sidebarResizeRect = null;
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
      document.body.classList.remove('resizing', 'sidebar-resizing', 'is-resizing', 'is-sidebar-resizing');
      document.getElementById('sidebar-resizer')?.classList.remove('dragging', 'is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      scheduleEditorMetricsRebuild(40);
      invalidatePreviewAnchorMetrics();
    }

    function startResize(e) {
      isResizing = true;
      resizeRect = document.querySelector('.main').getBoundingClientRect();
      resizeStartedAt = performance.now();
      resizeMoveEvents = 0;
      resizeStartRatio = editorRatio;
      document.body.classList.add('resizing', 'is-resizing');
      const resizer = document.getElementById('resizer');
      resizer.classList.add('dragging', 'is-dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    }

    function stopResize() {
      if (!isResizing) return;
      isResizing = false;
      resizeRect = null;
      localStorage.setItem(RATIO_KEY, editorRatio);
      document.body.classList.remove('resizing', 'is-resizing');
      const resizer = document.getElementById('resizer');
      resizer.classList.remove('dragging', 'is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      scheduleEditorMetricsRebuild(40);
      invalidatePreviewAnchorMetrics();
      if (resizeMoveEvents > 0) {
        window.markdownEditorPerf?.record?.('layout.split-resize-burst', {
          category: 'ui.layout',
          durationMs: Math.max(0, performance.now() - resizeStartedAt),
          details: {
            events: resizeMoveEvents,
            startRatio: Number(resizeStartRatio.toFixed(4)),
            endRatio: Number(editorRatio.toFixed(4))
          }
        });
      }
      resizeStartedAt = 0;
      resizeMoveEvents = 0;
    }

    function onResizeMove(e) {
      if (!isResizing || !resizeRect) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      let ratio = (clientX - resizeRect.left) / resizeRect.width;
      ratio = Math.max(0.15, Math.min(0.85, ratio));
      editorRatio = ratio;
      resizeMoveEvents += 1;
      applySplit();
    }

    const sidebarResizer = document.getElementById('sidebar-resizer');
    sidebarResizer?.addEventListener('mousedown', startSidebarResize);
    sidebarResizer?.addEventListener('touchstart', startSidebarResize, { passive: false });

    const resizer = document.getElementById('resizer');
    resizer.addEventListener('mousedown', startResize);
    resizer.addEventListener('touchstart', startResize, { passive: false });
    window.addEventListener('mousemove', event => {
      onSidebarResizeMove(event);
      onResizeMove(event);
    });
    window.addEventListener('touchmove', event => {
      onSidebarResizeMove(event);
      onResizeMove(event);
    }, { passive: false });
    window.addEventListener('mouseup', () => {
      stopSidebarResize();
      stopResize();
    });
    window.addEventListener('touchend', () => {
      stopSidebarResize();
      stopResize();
    });
    window.addEventListener('resize', () => {
      const normalized = normalizeSidebarWidth(sidebarWidth);
      if (normalized !== sidebarWidth) {
        sidebarWidth = normalized;
        applySidebarWidth();
      }
    });

    // 平滑双向滚动、预览定位与选择同步
