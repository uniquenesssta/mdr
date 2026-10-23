/**
 * Responsibility: Present document lifecycle and cached indexes over the existing Document Controller.
 * Imports: Explicit caller capabilities and application lifetime management.
 * Exports: createDocumentWorkspace.
 * State/side effects: Owns only this feature's projections, listeners and pending UI work.
 * Lifecycle: Explicit construction, rollback on failure and idempotent destroy.
 */
import { createApplicationLifetime } from '../../../bootstrap/application-lifetime.js';

export function createDocumentWorkspace({ document, window, editor, documentModel, filenameInput, localStorage, navigator, prompt, confirm, nativeStore, publishStatistics, t, showToast, corePlatformPort, coreExportRequestPort, coreMarkdownExportPort, coreExportTaskPort, coreSettingsStorePort, coreDocumentSessionPort, coreDocumentControllerPort, coreRecentFilesPort, coreDocumentUiCommandPort, coreEditorUiCommandPort, coreSidebarControllerPort, coreOutlineControllerPort, coreFolderTreeControllerPort, corePreviewCommandPort, coreTaskSchedulerPort, coreSaveStatusStorePort }) {
  const lifetime = createApplicationLifetime();
  const setTimeout = lifetime.setTimeout, clearTimeout = lifetime.clearTimeout;
  try {
const getSessionDocuments = () => coreDocumentSessionPort.records;
    const getActiveDocumentId = () => coreDocumentSessionPort.activeId;
    const DOCUMENT_INDEX_KEY_PREFIX = 'md_editor_document_index_v1:';
    let cachedDocumentStatistics = null;
    const pendingIndexes = new Set();
    lifetime.own(() => { for (const key of pendingIndexes) coreTaskSchedulerPort?.cancel?.(key); pendingIndexes.clear(); });
    function addRecentFile(path, name = '') {
      const result = coreRecentFilesPort.add(path, {
        name,
        fallbackName: '未命名文件'
      });
      return Boolean(result.added);
    }

    function updateDocumentStatistics(statistics) {
      cachedDocumentStatistics = statistics && typeof statistics === 'object' ? { ...statistics } : null;
      publishStatistics(cachedDocumentStatistics);
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
        coreOutlineControllerPort.replaceIndex(parsed.headings, {
          version: editor.virtualEditor?.getDocumentVersion?.(),
          documentKey: doc.id,
          reason: 'persisted-document-index'
        });
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
      const key = 'document-index-' + doc.id;
      const save = () => {
        pendingIndexes.delete(key);
        if (!lifetime.alive) return;
        try {
          localStorage.setItem(getDocumentIndexStorageKey(doc.id), JSON.stringify(payload));
        } catch (error) {
          console.debug('Document index cache skipped:', error?.message || error);
        }
      };
      const scheduler = coreTaskSchedulerPort;
      if (scheduler?.schedule) { pendingIndexes.add(key); scheduler.schedule(key, save, { priority: 'idle', timeout: 1000 }); }
      else setTimeout(save, 0);
    }

    function clearDocumentIndex(documentId) {
      coreTaskSchedulerPort?.cancel?.('document-index-' + documentId);
      try {
        localStorage.removeItem(getDocumentIndexStorageKey(documentId));
      } catch (_) {}
    }

    async function applyDocumentLifecycleUi(result, options = {}) {
      if (!lifetime.alive || !result || !coreDocumentControllerPort.isCurrentGeneration(result.generation)) return false;
      const doc = options.record === undefined
        ? (result.record || coreDocumentControllerPort.getActiveRecord())
        : options.record;
      const loaded = result.loaded || null;
      filenameInput.value = doc?.title || t('filenameDefault');
      const restoredCachedIndex = restoreDocumentIndex(doc);
      if (Array.isArray(loaded?.headings)) {
        coreOutlineControllerPort.replaceIndex(loaded.headings, {
          version: documentModel?.getDocumentVersion?.() ?? 0,
          documentKey: doc?.id || '',
          changedHint: true,
          reason: 'document-load-index'
        });
        updateDocumentStatistics({
          characters: Number(loaded.textLength) || editor.textLength,
          lines: Number(loaded.lineCount) || editor.lineCount,
          blocks: Number(cachedDocumentStatistics?.blocks) || 0,
          headings: loaded.headings.length,
          nonWhitespaceCount: Number(loaded.nonWhitespaceCount) || 0,
          nativeIndex: true
        });
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
      if (!lifetime.alive || !coreDocumentControllerPort.isCurrentGeneration(result.generation)) return false;
      await corePreviewCommandPort.reset();
      if (!lifetime.alive || !coreDocumentControllerPort.isCurrentGeneration(result.generation)) return false;
      corePreviewCommandPort.updateCount();
      syncCurrentDocumentFileTree();
      return true;
    }

    async function setupDocuments() {
      const storedDocuments = coreDocumentControllerPort.getLegacySessionRecords();
      for (const storedDocument of storedDocuments) {
        if (storedDocument?.filePath) addRecentFile(storedDocument.filePath, storedDocument.title);
        if (storedDocument?.id) clearDocumentIndex(storedDocument.id);
      }
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

    function normalizeWorkspaceFilePath(path) {
      const value = String(path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
      if (!value) return '';
      return (/^[a-z]:\//i.test(value) || value.startsWith('//')) ? value.toLocaleLowerCase() : value;
    }

    async function openDocument(id) {
      if (id === coreDocumentControllerPort.activeId) return;
      try {
        coreDocumentUiCommandPort.invoke('prepareDocumentTransition', 'document-open');
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
        coreDocumentUiCommandPort.invoke('prepareDocumentTransition', 'document-new');
        const index = getSessionDocuments().length + 1;
        const result = await coreDocumentControllerPort.newDocument({
          title: '未命名文档-' + index + '.md',
          content: '',
          currentTitle: filenameInput.value,
          fallbackTitle: t('filenameDefault')
        });
        if (!await applyDocumentLifecycleUi(result)) return;
        if (!lifetime.alive || !coreDocumentControllerPort.isCurrentGeneration(result.generation)) return;
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
        if (!lifetime.alive || !coreDocumentControllerPort.isCurrentGeneration(result.generation)) return;
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
          coreEditorUiCommandPort.invoke('requestDocumentPersistence', 'document-rename');
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
      const saveState = coreSaveStatusStorePort.snapshot.state;
      return !coreSettingsStorePort.get('autoSaveEnabled') || saveState === 'queued' || saveState === 'error';
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
          coreDocumentUiCommandPort.invoke('prepareDocumentTransition', 'document-close');
          if (shouldSaveBeforeClose) {
            const saved = await coreEditorUiCommandPort.invoke('saveCurrentFile');
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

    function syncCurrentDocumentFileTree() {
      coreFolderTreeControllerPort.syncCurrentDocument({
        filePath: coreDocumentSessionPort.getActiveRecord()?.filePath || ''
      });
    }

    async function exportContextDocument(documentId) {
      try {
        const targetId = documentId === undefined ? getActiveDocumentId() : documentId;
        const doc = coreDocumentSessionPort.getRecord(targetId);
        const request = coreExportRequestPort.createRequest({ format: 'markdown', documentId: targetId, name: doc?.title || '', directory: coreSettingsStorePort.get('exportDirectory') });
        const result = await coreMarkdownExportPort.export({ request, snapshotReason: 'context-export' });
        if (result.status === 'busy') showToast('当前导出正在生成文件，请稍候');
        if (['written', 'downloaded'].includes(result.status)) showToast('已导出 Markdown');
      } catch (error) {
        if (!coreExportTaskPort.isCancelled(error) && !coreDocumentControllerPort.isStaleError(error)) showToast(error?.message || String(error));
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

    function simpleHash(text) {
      let hash = 0;
      for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
      return Math.abs(hash).toString(36);
    }
    const openFolderTreeFile = async path => {
      const normalizedPath = normalizeWorkspaceFilePath(path);
      if (!normalizedPath) return false;
      const existing = getSessionDocuments().find(item => normalizeWorkspaceFilePath(item?.filePath) === normalizedPath);
      if (existing) {
        if (existing.id !== getActiveDocumentId()) await openDocument(existing.id);
        void coreSidebarControllerPort.select('files');
        return true;
      }
      const opened = await coreDocumentUiCommandPort.invoke('openImportPath', path);
      if (opened) void coreSidebarControllerPort.select('files');
      return opened;
    };


    lifetime.own(coreDocumentUiCommandPort.register({ applyDocumentLifecycleUi, openDocument, closeDocument, renameDocument, duplicateDocument, exportDocument: exportContextDocument, copyDocumentTitle: copyContextDocumentTitle, newDocument, duplicateActiveDocument: () => duplicateDocument(coreDocumentSessionPort.activeId), openFolderTreeFile, updateTitleDraft(value) { const result = coreDocumentControllerPort.updateActiveTitleDraft(value); coreEditorUiCommandPort.invoke('requestDocumentPersistence', 'title-draft'); syncCurrentDocumentFileTree(); return result; } }));
    lifetime.own(coreEditorUiCommandPort.register({ updateDocumentStatistics, persistCurrentDocumentIndex }));
    lifetime.own(nativeStore?.subscribe?.(event => {
      if (!lifetime.alive || !event || event.documentId !== getActiveDocumentId() || event.state !== 'manifest') return;
      const manifest = event.manifest || {};
      if (!Array.isArray(manifest.headings)) return;
      coreOutlineControllerPort.replaceIndex(manifest.headings, { version: 0, documentKey: event.documentId, changedHint: true, reason: 'native-manifest' });
      updateDocumentStatistics({ characters: Number(manifest.textLength) || 0, lines: Number(manifest.lineCount) || 1, blocks: 0, headings: manifest.headings.length, nonWhitespaceCount: Number(manifest.nonWhitespaceCount) || 0, nativeIndex: true });
    }));
    return Object.freeze({ setupDocuments, getCurrentDocument, ensureCurrentDocumentForEditing, newDocument, renameCurrentDocument, destroy: lifetime.destroy });
  } catch (error) { lifetime.destroy(); throw error; }
}
