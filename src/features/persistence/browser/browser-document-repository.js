const DOCS_KEY = 'md_editor_documents';
const CURRENT_DOC_KEY = 'md_editor_current_document';
const EMPTY_DOCUMENTS_KEY = 'md_editor_documents_intentionally_empty';
const STORAGE_KEY = 'md_editor_content';
const FILENAME_KEY = 'md_editor_filename';

function normalizeStoredRecords(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(record => record && record.id).map(record => ({ ...record }));
}

function createDestroyedError() {
  const error = new Error('BROWSER_DOCUMENT_REPOSITORY_DESTROYED');
  error.code = 'BROWSER_DOCUMENT_REPOSITORY_DESTROYED';
  return error;
}

/**
 * Responsibility: Own browser-fallback document body cache plus Web Storage
 * session/legacy metadata and body reads/writes. Native-backed records are
 * metadata-only and never serialize a duplicate full document body.
 */
export function createBrowserDocumentRepository({
  storage,
  reportError = (message, error) => console.warn(message, error)
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
    throw new TypeError('Browser document repository requires a Web Storage compatible object.');
  }
  if (typeof reportError !== 'function') throw new TypeError('Browser document repository error reporter must be a function.');

  const bodyCache = new Map();
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw createDestroyedError();
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

  const hasContent = documentId => {
    assertActive();
    return bodyCache.has(String(documentId || ''));
  };

  const readContent = documentId => {
    assertActive();
    return bodyCache.get(String(documentId || '')) || '';
  };

  const readLegacySession = () => {
    assertActive();
    try {
      const records = normalizeStoredRecords(JSON.parse(storage.getItem(DOCS_KEY) || '[]'));
      for (const record of records) {
        const id = String(record?.id || '');
        if (!id) continue;
        if (record.nativeBacked) bodyCache.delete(id);
        else if (typeof record.content === 'string') bodyCache.set(id, record.content);
      }
      return records;
    } catch (_) {
      return [];
    }
  };

  const persistSession = (records, activeId) => {
    assertActive();
    try {
      const normalizedRecords = Array.from(records || []);
      const serialized = normalizedRecords.map(record => {
        const stored = { ...record };
        delete stored.content;
        const id = String(record?.id || '');
        if (!record?.nativeBacked) {
          const content = bodyCache.get(id);
          if (typeof content === 'string') stored.content = content;
        }
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

  const resetLegacySession = () => {
    assertActive();
    bodyCache.clear();
    try {
      storage.removeItem(DOCS_KEY);
      storage.removeItem(CURRENT_DOC_KEY);
      storage.removeItem(EMPTY_DOCUMENTS_KEY);
      storage.removeItem(STORAGE_KEY);
      storage.removeItem(FILENAME_KEY);
      return true;
    } catch (error) {
      reportError('Legacy document session cleanup failed:', error);
      return false;
    }
  };

  const persistLegacyActiveTitle = title => {
    assertActive();
    try {
      if (title) storage.setItem(FILENAME_KEY, String(title));
      else storage.removeItem(FILENAME_KEY);
      return true;
    } catch (error) {
      reportError('Legacy filename storage failed:', error);
      return false;
    }
  };

  const persistLegacyActiveSnapshot = ({ title = '', content = '', nativeBacked = false } = {}) => {
    assertActive();
    try {
      if (nativeBacked) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, String(content ?? ''));
      if (title) storage.setItem(FILENAME_KEY, String(title));
      else storage.removeItem(FILENAME_KEY);
      return true;
    } catch (error) {
      reportError('Legacy active document storage failed:', error);
      return false;
    }
  };

  const clearLegacyActiveSnapshot = () => {
    assertActive();
    try {
      storage.removeItem(STORAGE_KEY);
      storage.removeItem(FILENAME_KEY);
      return true;
    } catch (error) {
      reportError('Legacy active document cleanup failed:', error);
      return false;
    }
  };

  return Object.freeze({
    get destroyed() { return destroyed; },
    get cachedBodyCount() { assertActive(); return bodyCache.size; },
    readLegacySession,
    resetLegacySession,
    rememberContent,
    forgetContent,
    hasContent,
    readContent,
    persistSession,
    persistLegacyActiveTitle,
    persistLegacyActiveSnapshot,
    clearLegacyActiveSnapshot,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      bodyCache.clear();
    }
  });
}
