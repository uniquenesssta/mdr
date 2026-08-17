import { normalizeDocumentNativeMetadata } from '../features/documents/index.js';
import { createNativeSaveQueue, createNativeSaveSession, createNativeSnapshotUploader } from '../features/persistence/index.js';

const NATIVE_DOCUMENT_THRESHOLD = 100000;
const DOCUMENT_CHUNK_BYTES = 512 * 1024;

function currentDocumentVersion(source) {
  return Math.max(0, Number(source?.getDocumentVersion?.() ?? source?.virtualEditor?.getDocumentVersion?.()) || 0);
}

function getDocumentLength(source) {
  return Math.max(0, Number(source?.getTextLength?.() ?? source?.textLength) || 0);
}

function getDocumentChanges(source, version) {
  if (typeof source?.getChangesSince === 'function') return source.getChangesSince(version, 'storage');
  return source?.virtualEditor?.getDocumentChangesSince?.(version);
}

function createDocumentSnapshot(source) {
  if (typeof source?.createSnapshot === 'function') return source.createSnapshot('native-storage-reset');
  return String(source?.value ?? '');
}

function createSaveRequestContext(document) {
  return Object.freeze({
    documentId: String(document?.id || ''),
    title: String(document?.title || ''),
    updatedAt: Number(document?.updatedAt) || Date.now()
  });
}

export class NativeDocumentStore {
  constructor({ documentStore, available = false } = {}) {
    this.documentStore = documentStore;
    this.nativeAvailable = Boolean(available);
    this.sessions = new Map();
    this.saveQueues = new Map();
    this.activeDocumentId = '';
    this.listeners = new Set();
    this.snapshotUploader = createNativeSnapshotUploader({
      documentStore: this.documentStore,
      notify: event => this.emit(event),
      yieldControl: () => new Promise(resolve => setTimeout(resolve, 0))
    });
    this.loadSequence = 0;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(state) {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (error) {
        console.error('Document store listener failed:', error);
      }
    }
  }

  get available() {
    return Boolean(this.nativeAvailable && this.documentStore?.save);
  }

  get supportsChunkedSnapshots() {
    return this.snapshotUploader.supported;
  }

  shouldUse(document, contentLength) {
    return this.available && (Boolean(document?.nativeBacked) || Number(contentLength) >= NATIVE_DOCUMENT_THRESHOLD);
  }

  getSession(documentId) {
    let session = this.sessions.get(documentId);
    if (!session) {
      session = createNativeSaveSession(documentId);
      this.sessions.set(documentId, session);
    }
    return session;
  }

  getSaveQueue(documentId) {
    let queue = this.saveQueues.get(documentId);
    if (!queue) {
      const session = this.getSession(documentId);
      queue = createNativeSaveQueue(documentId, {
        executeBatch: batch => this.executeSaveBatch(session, batch),
        notify: event => this.emit(event)
      });
      this.saveQueues.set(documentId, queue);
    }
    return queue;
  }

  activateDocument(source, document, loaded = null) {
    if (!document?.id) return;
    this.activeDocumentId = document.id;
    const session = this.getSession(document.id);
    session.activate({
      source,
      editorVersion: currentDocumentVersion(source),
      title: document.title || '',
      loaded: Boolean(loaded),
      loadedVersion: loaded?.version,
      nativeBacked: Boolean(document.nativeBacked),
      nativeVersion: document.nativeVersion
    });
  }

  async load(documentId, options = {}) {
    if (!this.available || !documentId) return null;
    const cancelPrevious = options.cancelPrevious !== false;
    const loadToken = cancelPrevious ? ++this.loadSequence : null;
    const ensureCurrentLoad = () => {
      if (cancelPrevious && loadToken !== this.loadSequence) throw new Error('DOCUMENT_LOAD_CANCELLED');
    };
    const supportsSegmentedLoad = Boolean(
      this.documentStore?.loadManifest
      && this.documentStore?.readChunk
    );
    if (!supportsSegmentedLoad) {
      const loaded = await this.documentStore.load(documentId);
      ensureCurrentLoad();
      if (!loaded) return null;
      this.getSession(documentId).recordLoaded(loaded.version);
      return loaded;
    }

    this.emit({ state: 'loading-index', documentId, progress: 0 });
    try {
      const manifest = await this.documentStore.loadManifest(documentId);
      ensureCurrentLoad();
      if (!manifest) return null;
      this.emit({ state: 'manifest', documentId, progress: 0, manifest });
      const chunks = [];
      const totalBytes = Math.max(0, Number(manifest.contentBytes) || 0);
      let byteOffset = 0;
      while (byteOffset < totalBytes) {
        const chunk = await this.documentStore.readChunk(documentId, byteOffset, DOCUMENT_CHUNK_BYTES);
        ensureCurrentLoad();
        if (!chunk || Number(chunk.nextByteOffset) <= byteOffset) {
          throw new Error('后台文档分段读取未前进');
        }
        chunks.push(String(chunk.content || ''));
        byteOffset = Number(chunk.nextByteOffset) || totalBytes;
        this.emit({
          state: 'loading',
          documentId,
          loadedBytes: byteOffset,
          totalBytes,
          progress: totalBytes > 0 ? byteOffset / totalBytes : 1
        });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const loaded = {
        ...manifest,
        contentChunks: chunks,
        segmented: true
      };
      this.getSession(documentId).recordLoaded(loaded.version);
      this.emit({ state: 'loaded', documentId, progress: 1, totalBytes });
      return loaded;
    } catch (error) {
      if (error?.message === 'DOCUMENT_LOAD_CANCELLED') throw error;
      this.emit({
        state: 'load-error',
        documentId,
        message: error?.message || String(error)
      });
      throw error;
    }
  }

  cancelLoad() {
    this.loadSequence += 1;
  }

  async search(documentId, query, from = 0, wrap = true) {
    if (!this.available || !documentId || !query || !this.documentStore?.search) return null;
    return this.documentStore.search({
      documentId,
      query: String(query),
      from: Math.max(0, Number(from) || 0),
      wrap: wrap !== false
    });
  }

  save(source, document, options = {}) {
    if (source?.documentId && source.documentId !== document?.id) {
      return Promise.reject(new Error('DOCUMENT_SOURCE_MISMATCH'));
    }
    if (!document?.id || !this.shouldUse(document, getDocumentLength(source))) {
      return Promise.resolve({ native: false });
    }
    const session = this.getSession(document.id);
    const queue = this.getSaveQueue(document.id);
    session.attachSource(source);
    const targetVersion = currentDocumentVersion(source);
    const forceSnapshot = Boolean(options.forceSnapshot);
    if (
      session.initialized
      && queue.idle
      && !forceSnapshot
      && targetVersion <= session.lastEditorVersion
      && (document.title || '') === session.title
    ) {
      const native = normalizeDocumentNativeMetadata({ nativeBacked: true, nativeVersion: session.backendVersion });
      const result = { native: true, version: session.backendVersion, ...native, skipped: true };
      this.emit({
        state: 'saved',
        documentId: document.id,
        version: session.backendVersion,
        skipped: true,
        pending: 0
      });
      return Promise.resolve(result);
    }
    return queue.enqueue({
      targetVersion,
      forceSnapshot,
      context: createSaveRequestContext(document)
    });
  }

  async executeSaveBatch(session, batch) {
    const document = batch.context || Object.freeze({ documentId: batch.documentId, title: '', updatedAt: Date.now() });
    const source = session.source;
    if (source?.documentId && source.documentId !== document.documentId) {
      throw new Error('DOCUMENT_SOURCE_MISMATCH');
    }

    while (true) {
      const editorVersion = currentDocumentVersion(source);
      const changes = getDocumentChanges(source, session.lastEditorVersion);
      const mustReset = !session.initialized || !Array.isArray(changes);
      const baseVersion = session.backendVersion;
      const nextVersion = baseVersion + 1;
      const snapshotContent = mustReset ? createDocumentSnapshot(source) : null;
      const useChunkedSnapshot = mustReset
        && this.snapshotUploader.shouldUpload(snapshotContent);
      const request = {
        documentId: document.documentId,
        title: document.title,
        baseVersion,
        nextVersion,
        fullContent: useChunkedSnapshot ? null : snapshotContent,
        transactions: mustReset ? [] : changes,
        updatedAt: document.updatedAt,
        forceSnapshot: batch.forceSnapshot
      };

      let response;
      this.emit({
        state: 'saving',
        documentId: document.documentId,
        targetVersion: editorVersion,
        backendVersion: baseVersion,
        pending: batch.getPendingCount()
      });
      try {
        response = useChunkedSnapshot
          ? await this.snapshotUploader.upload({
              request,
              content: snapshotContent,
              getTargetVersion: () => currentDocumentVersion(session.source),
              backendVersion: session.backendVersion,
              getPendingCount: batch.getPendingCount
            })
          : await this.documentStore.save(request);
      } catch (error) {
        const message = error?.message || String(error);
        if (!mustReset && message.includes('VERSION_MISMATCH')) {
          session.invalidateInitialization();
          continue;
        }
        throw error;
      }

      const committedBackendVersion = Math.max(nextVersion, Number(response?.version) || 0);
      session.commit({
        editorVersion,
        backendVersion: committedBackendVersion,
        title: document.title
      });
      const native = normalizeDocumentNativeMetadata({
        nativeBacked: true,
        nativeVersion: session.backendVersion
      });
      return Object.freeze({
        completedVersion: editorVersion,
        completedTitle: document.title,
        forceSnapshotApplied: Boolean(batch.forceSnapshot),
        version: session.backendVersion,
        snapshotCreated: Boolean(response?.snapshotCreated),
        journalEntries: Number(response?.journalEntries) || 0,
        value: Object.freeze({ native: true, ...response, ...native })
      });
    }
  }

  async delete(documentId) {
    const queue = this.saveQueues.get(documentId);
    queue?.destroy();
    this.saveQueues.delete(documentId);

    let cancellationError = null;
    try {
      await this.snapshotUploader.cancel(documentId, 'document-deleted');
    } catch (error) {
      cancellationError = error;
    }

    const session = this.sessions.get(documentId);
    session?.destroy();
    this.sessions.delete(documentId);
    if (this.activeDocumentId === documentId) this.activeDocumentId = '';

    let removeError = null;
    if (this.available && documentId) {
      try {
        await this.documentStore.remove(documentId);
      } catch (error) {
        removeError = error;
      }
    }
    if (cancellationError && removeError) {
      throw new AggregateError([cancellationError, removeError], 'DOCUMENT_DELETE_CLEANUP_FAILED');
    }
    if (cancellationError) throw cancellationError;
    if (removeError) throw removeError;
  }
}

export function createNativeDocumentStore(options = {}) {
  return new NativeDocumentStore(options);
}
