/**
 * Responsibility: Coordinate the transitional document persistence contract by
 * delegating browser fallback body/metadata persistence and native document I/O.
 * State/side effects: Owns no document body cache, session records, activeId, DOM or editor state.
 */

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

function materializeLoadedContent(restored) {
  if (typeof restored?.content === 'string' && restored.content.length) return restored.content;
  if (Array.isArray(restored?.chunks)) return restored.chunks.join('');
  if (Array.isArray(restored?.loaded?.contentChunks)) return restored.loaded.contentChunks.join('');
  return String(restored?.content || '');
}

const REQUIRED_BROWSER_METHODS = Object.freeze([
  'readLegacySession',
  'resetLegacySession',
  'rememberContent',
  'forgetContent',
  'hasContent',
  'readContent',
  'persistSession',
  'persistLegacyActiveTitle',
  'persistLegacyActiveSnapshot',
  'clearLegacyActiveSnapshot'
]);

export function createSessionDocumentRepository({
  browserRepository,
  nativeStore = null,
  scheduleCleanup = task => setTimeout(task, 0),
  reportError = (message, error) => console.warn(message, error)
} = {}) {
  if (!browserRepository || typeof browserRepository !== 'object') {
    throw new TypeError('Session document repository requires a BrowserDocumentRepository.');
  }
  for (const method of REQUIRED_BROWSER_METHODS) {
    if (typeof browserRepository[method] !== 'function') {
      throw new TypeError(`BrowserDocumentRepository.${method}() is required.`);
    }
  }
  if (typeof scheduleCleanup !== 'function') throw new TypeError('Session document repository cleanup scheduler must be a function.');
  if (typeof reportError !== 'function') throw new TypeError('Session document repository error reporter must be a function.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Session document repository has been destroyed.');
  };

  const readLegacySession = () => {
    assertActive();
    return browserRepository.readLegacySession();
  };

  const resetLegacySession = records => {
    assertActive();
    const staleDocumentIds = Array.from(new Set(
      Array.from(records || []).map(record => String(record?.id || '')).filter(Boolean)
    ));
    browserRepository.resetLegacySession();
    if (!nativeStore?.available || typeof nativeStore.delete !== 'function' || !staleDocumentIds.length) return;
    scheduleCleanup(() => Promise.allSettled(staleDocumentIds.map(documentId => nativeStore.delete(documentId))));
  };

  const rememberContent = (documentId, content) => {
    assertActive();
    return browserRepository.rememberContent(documentId, content);
  };

  const forgetContent = documentId => {
    assertActive();
    return browserRepository.forgetContent(documentId);
  };

  const persistSession = (records, activeId) => {
    assertActive();
    return browserRepository.persistSession(records, activeId);
  };

  const load = async (record, options = {}) => {
    assertActive();
    if (!record?.id) return { content: '', chunks: null, loaded: null, metadataPatch: null };
    let loaded = null;
    if (record.nativeBacked && nativeStore?.available) {
      loaded = await nativeStore.load(record.id, { cancelPrevious: options.isolated !== true });
    }
    if (loaded) {
      browserRepository.forgetContent(record.id);
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
    if (record.nativeBacked && !browserRepository.hasContent(record.id)) {
      throw new Error('无法恢复后台文档快照，为避免覆盖原内容已停止打开');
    }
    return {
      content: browserRepository.readContent(record.id),
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
      browserRepository.rememberContent(record.id, createSnapshot(source, options.snapshotReason || 'document-storage'));
    }
    if (!useNative) {
      source?.markPersisted?.(getDocumentVersion(source), 0);
      return { native: false };
    }
    const result = await nativeStore.save(source, record, { forceSnapshot: Boolean(options.forceSnapshot) });
    if (result?.native) browserRepository.forgetContent(record.id);
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
    browserRepository.forgetContent(id);
    if (id) await nativeStore?.delete?.(id);
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
    persistLegacyActiveTitle(title) {
      assertActive();
      return browserRepository.persistLegacyActiveTitle(title);
    },
    persistLegacyActiveSnapshot(options) {
      assertActive();
      return browserRepository.persistLegacyActiveSnapshot(options);
    },
    clearLegacyActiveSnapshot() {
      assertActive();
      return browserRepository.clearLegacyActiveSnapshot();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      nativeStore?.cancelLoad?.();
    }
  });
}
