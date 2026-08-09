/**
 * Responsibility: Persist document-session metadata/body compatibility data and delegate native document content I/O.
 * State/side effects: Owns only the non-native body cache plus storage/native I/O. Never owns session records, activeId, DOM or editor state.
 */

const DOCS_KEY = 'md_editor_documents';
const CURRENT_DOC_KEY = 'md_editor_current_document';
const EMPTY_DOCUMENTS_KEY = 'md_editor_documents_intentionally_empty';
const STORAGE_KEY = 'md_editor_content';
const FILENAME_KEY = 'md_editor_filename';

function getDocumentLength(source) {
  return Math.max(0, Number(source?.getTextLength?.() ?? source?.textLength) || 0);
}

function getDocumentVersion(source) {
  return Math.max(0, Number(source?.getDocumentVersion?.() ?? source?.virtualEditor?.getDocumentVersion?.()) || 0);
}

function createSnapshot(source, reason) {
  if (typeof source?.createSnapshot === 'function') return source.createSnapshot(reason);
  return String(source?.value ?? '');
}

function normalizeStoredRecords(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(record => record && record.id).map(record => ({ ...record }));
}

function materializeLoadedContent(restored) {
  if (typeof restored?.content === 'string' && restored.content.length) return restored.content;
  if (Array.isArray(restored?.chunks)) return restored.chunks.join('');
  if (Array.isArray(restored?.loaded?.contentChunks)) return restored.loaded.contentChunks.join('');
  return String(restored?.content || '');
}

export function createSessionDocumentRepository({
  storage,
  nativeStore = null,
  scheduleCleanup = task => setTimeout(task, 0),
  reportError = (message, error) => console.warn(message, error)
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
    throw new TypeError('Session document repository requires a Web Storage compatible object.');
  }
  if (typeof scheduleCleanup !== 'function') throw new TypeError('Session document repository cleanup scheduler must be a function.');
  if (typeof reportError !== 'function') throw new TypeError('Session document repository error reporter must be a function.');

  let destroyed = false;
  const bodyCache = new Map();

  const assertActive = () => {
    if (destroyed) throw new Error('Session document repository has been destroyed.');
  };

  const rememberContent = (documentId, content) => {
    assertActive();
    const id = String(documentId || '');
    if (!id) throw new Error('Document id is required to cache document content.');
    bodyCache.set(id, String(content ?? ''));
  };

  const forgetContent = documentId => {
    assertActive();
    bodyCache.delete(String(documentId || ''));
  };

  const persistSession = (records, activeId) => {
    assertActive();
    try {
      const normalizedRecords = Array.from(records || []);
      const serialized = normalizedRecords.map(record => {
        const stored = { ...record };
        if (record?.nativeBacked && nativeStore?.available) return stored;
        const content = bodyCache.get(String(record?.id || ''));
        if (typeof content === 'string') stored.content = content;
        return stored;
      });
      storage.setItem(DOCS_KEY, JSON.stringify(serialized));
      if (normalizedRecords.length) storage.removeItem(EMPTY_DOCUMENTS_KEY);
      else storage.setItem(EMPTY_DOCUMENTS_KEY, 'true');
      if (activeId) storage.setItem(CURRENT_DOC_KEY, String(activeId));
      else storage.removeItem(CURRENT_DOC_KEY);
      return true;
    } catch (error) {
      reportError('Document session storage failed:', error);
      return false;
    }
  };

  const readLegacySession = () => {
    assertActive();
    try {
      return normalizeStoredRecords(JSON.parse(storage.getItem(DOCS_KEY) || '[]'));
    } catch (_) {
      return [];
    }
  };

  const resetLegacySession = records => {
    assertActive();
    const staleDocumentIds = Array.from(new Set(
      Array.from(records || []).map(record => String(record?.id || '')).filter(Boolean)
    ));
    bodyCache.clear();
    try {
      storage.removeItem(DOCS_KEY);
      storage.removeItem(CURRENT_DOC_KEY);
      storage.removeItem(EMPTY_DOCUMENTS_KEY);
      storage.removeItem(STORAGE_KEY);
      storage.removeItem(FILENAME_KEY);
    } catch (error) {
      reportError('Legacy document session cleanup failed:', error);
    }

    if (!nativeStore?.available || typeof nativeStore.delete !== 'function' || !staleDocumentIds.length) return;
    scheduleCleanup(() => Promise.allSettled(staleDocumentIds.map(documentId => nativeStore.delete(documentId))));
  };

  const load = async (record, options = {}) => {
    assertActive();
    if (!record?.id) return { content: '', chunks: null, loaded: null, metadataPatch: null };
    let loaded = null;
    if (record.nativeBacked && nativeStore?.available) {
      loaded = await nativeStore.load(record.id, { cancelPrevious: options.isolated !== true });
    }
    if (loaded) {
      bodyCache.delete(record.id);
      return {
        content: typeof loaded.content === 'string' ? loaded.content : '',
        chunks: Array.isArray(loaded.contentChunks) ? loaded.contentChunks.slice() : null,
        loaded,
        metadataPatch: {
          title: loaded.title || record.title,
          updatedAt: Math.max(Number(record.updatedAt) || 0, Number(loaded.updatedAt) || 0),
          nativeBacked: true,
          nativeVersion: Number(loaded.version) || 0
        }
      };
    }
    if (record.nativeBacked && !bodyCache.has(record.id)) {
      throw new Error('无法恢复后台文档快照，为避免覆盖原内容已停止打开');
    }
    return {
      content: bodyCache.get(record.id) || '',
      chunks: null,
      loaded: null,
      metadataPatch: null
    };
  };

  const save = async (source, record, options = {}) => {
    assertActive();
    if (!record?.id) return { native: false };
    const contentLength = getDocumentLength(source);
    const useNative = Boolean(nativeStore?.shouldUse?.(record, contentLength));
    const wasNativeBacked = Boolean(record.nativeBacked);
    if (!useNative || !wasNativeBacked) {
      rememberContent(record.id, createSnapshot(source, options.snapshotReason || 'document-storage'));
    }
    if (!useNative) {
      source?.markPersisted?.(getDocumentVersion(source), 0);
      return { native: false };
    }
    const result = await nativeStore.save(source, record, { forceSnapshot: Boolean(options.forceSnapshot) });
    if (result?.native) bodyCache.delete(record.id);
    return result;
  };

  const activate = (source, record, loaded = null) => {
    assertActive();
    nativeStore?.activateDocument?.(source, record, loaded);
  };

  const cancelPendingLoad = () => {
    assertActive();
    nativeStore?.cancelLoad?.();
  };

  const remove = async documentId => {
    assertActive();
    const id = String(documentId || '');
    bodyCache.delete(id);
    if (id) await nativeStore?.delete?.(id);
  };

  const persistLegacyActiveTitle = title => {
    assertActive();
    try {
      if (title) storage.setItem(FILENAME_KEY, String(title));
      else storage.removeItem(FILENAME_KEY);
    } catch (error) {
      reportError('Legacy filename storage failed:', error);
    }
  };

  const persistLegacyActiveSnapshot = ({ title = '', content = '', nativeBacked = false } = {}) => {
    assertActive();
    try {
      if (nativeBacked && nativeStore?.available) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, String(content ?? ''));
      if (title) storage.setItem(FILENAME_KEY, String(title));
      else storage.removeItem(FILENAME_KEY);
    } catch (error) {
      reportError('Legacy active document storage failed:', error);
    }
  };

  const clearLegacyActiveSnapshot = () => {
    assertActive();
    try {
      storage.removeItem(STORAGE_KEY);
      storage.removeItem(FILENAME_KEY);
    } catch (error) {
      reportError('Legacy active document cleanup failed:', error);
    }
  };

  return Object.freeze({
    readLegacySession,
    resetLegacySession,
    rememberContent,
    forgetContent,
    persistSession,
    load,
    save,
    activate,
    cancelPendingLoad,
    remove,
    materializeLoadedContent,
    persistLegacyActiveTitle,
    persistLegacyActiveSnapshot,
    clearLegacyActiveSnapshot,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      bodyCache.clear();
      nativeStore?.cancelLoad?.();
    }
  });
}
