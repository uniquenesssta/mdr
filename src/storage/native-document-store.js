import { normalizeDocumentNativeMetadata } from '../features/documents/index.js';
import { createNativeSaveSession } from '../features/persistence/index.js';

const NATIVE_DOCUMENT_THRESHOLD = 100000;
const DOCUMENT_CHUNK_BYTES = 512 * 1024;
const SNAPSHOT_UPLOAD_THRESHOLD = 512 * 1024;
const SNAPSHOT_UPLOAD_CHUNK_CHARS = 256 * 1024;

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

function getSafeSnapshotChunkEnd(content, start) {
  let end = Math.min(content.length, start + SNAPSHOT_UPLOAD_CHUNK_CHARS);
  if (end < content.length) {
    const previous = content.charCodeAt(end - 1);
    const next = content.charCodeAt(end);
    if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
      end -= 1;
    }
  }
  return Math.max(start + 1, end);
}

// Atomic 10.5 migrates this queue/runtime responsibility. Atomic 10.4 intentionally
// leaves it here so NativeSaveSession owns only per-document persistence metadata.
function createSaveRuntime(documentId) {
  return {
    documentId,
    document: null,
    running: false,
    waiters: [],
    forceSnapshot: false
  };
}

export class NativeDocumentStore {
  constructor({ documentStore, available = false } = {}) {
    this.documentStore = documentStore;
    this.nativeAvailable = Boolean(available);
    this.sessions = new Map();
    this.saveRuntimes = new Map();
    this.activeDocumentId = '';
    this.listeners = new Set();
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
    return Boolean(
      this.documentStore?.beginSnapshotUpload
      && this.documentStore?.appendSnapshotChunk
      && this.documentStore?.commitSnapshotUpload
    );
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

  getSaveRuntime(documentId) {
    let runtime = this.saveRuntimes.get(documentId);
    if (!runtime) {
      runtime = createSaveRuntime(documentId);
      this.saveRuntimes.set(documentId, runtime);
    }
    return runtime;
  }

  activateDocument(source, document, loaded = null) {
    if (!document?.id) return;
    this.activeDocumentId = document.id;
    const session = this.getSession(document.id);
    const runtime = this.getSaveRuntime(document.id);
    runtime.document = document;
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

  async saveSnapshotInChunks(session, runtime, request, content) {
    const documentId = runtime.document?.id || session.documentId;
    const uploadId = `upload_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await this.documentStore.beginSnapshotUpload(documentId, uploadId);
    try {
      let offset = 0;
      let chunkIndex = 0;
      while (offset < content.length) {
        const end = getSafeSnapshotChunkEnd(content, offset);
        await this.documentStore.appendSnapshotChunk(
          documentId,
          uploadId,
          content.slice(offset, end),
          chunkIndex
        );
        offset = end;
        chunkIndex += 1;
        this.emit({
          state: 'saving',
          documentId,
          targetVersion: currentDocumentVersion(session.source),
          backendVersion: session.backendVersion,
          uploadedChars: offset,
          totalChars: content.length,
          progress: content.length > 0 ? offset / content.length : 1,
          pending: runtime.waiters.length
        });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return await this.documentStore.commitSnapshotUpload(request, uploadId);
    } catch (error) {
      try {
        await this.documentStore.abortSnapshotUpload?.(documentId, uploadId);
      } catch (_) {}
      throw error;
    }
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
    const runtime = this.getSaveRuntime(document.id);
    session.attachSource(source);
    runtime.document = document;
    runtime.forceSnapshot = runtime.forceSnapshot || Boolean(options.forceSnapshot);
    const targetVersion = currentDocumentVersion(source);
    const forceSnapshot = Boolean(options.forceSnapshot);
    if (
      session.initialized
      && !runtime.running
      && !runtime.waiters.length
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
    return new Promise((resolve, reject) => {
      runtime.waiters.push({ targetVersion, forceSnapshot: Boolean(options.forceSnapshot), resolve, reject });
      this.emit({
        state: 'queued',
        documentId: document.id,
        targetVersion,
        pending: runtime.waiters.length
      });
      this.pump(session, runtime);
    });
  }

  async pump(session, runtime) {
    if (runtime.running || !session.source || !runtime.document) return;
    runtime.running = true;
    try {
      while (runtime.waiters.length) {
        if (session.source?.documentId && session.source.documentId !== runtime.document.id) {
          throw new Error('DOCUMENT_SOURCE_MISMATCH');
        }
        const editorVersion = currentDocumentVersion(session.source);
        const changes = getDocumentChanges(session.source, session.lastEditorVersion);
        const mustReset = !session.initialized || !Array.isArray(changes);
        const baseVersion = session.backendVersion;
        const nextVersion = baseVersion + 1;
        const forceSnapshot = runtime.forceSnapshot || runtime.waiters.some(waiter => waiter.forceSnapshot);
        runtime.forceSnapshot = false;
        const snapshotContent = mustReset ? createDocumentSnapshot(session.source) : null;
        const useChunkedSnapshot = mustReset
          && snapshotContent.length >= SNAPSHOT_UPLOAD_THRESHOLD
          && this.supportsChunkedSnapshots;
        const request = {
          documentId: runtime.document.id,
          title: runtime.document.title || '',
          baseVersion,
          nextVersion,
          fullContent: useChunkedSnapshot ? null : snapshotContent,
          transactions: mustReset ? [] : changes,
          updatedAt: runtime.document.updatedAt || Date.now(),
          forceSnapshot
        };

        let response;
        this.emit({
          state: 'saving',
          documentId: runtime.document.id,
          targetVersion: editorVersion,
          backendVersion: baseVersion,
          pending: runtime.waiters.length
        });
        try {
          response = useChunkedSnapshot
            ? await this.saveSnapshotInChunks(session, runtime, request, snapshotContent)
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
          title: runtime.document.title || ''
        });
        const native = normalizeDocumentNativeMetadata({
          nativeBacked: true,
          nativeVersion: session.backendVersion
        });

        const completed = [];
        const pending = [];
        for (const waiter of runtime.waiters) {
          if (waiter.targetVersion <= editorVersion) completed.push(waiter);
          else pending.push(waiter);
        }
        runtime.waiters = pending;
        completed.forEach(waiter => waiter.resolve({ native: true, ...response, ...native }));
        this.emit({
          state: 'saved',
          documentId: runtime.document.id,
          version: session.backendVersion,
          snapshotCreated: Boolean(response?.snapshotCreated),
          journalEntries: Number(response?.journalEntries) || 0,
          pending: runtime.waiters.length
        });
      }
    } catch (error) {
      const waiters = runtime.waiters.splice(0);
      this.emit({
        state: 'error',
        documentId: runtime.document?.id || runtime.documentId,
        message: error?.message || String(error)
      });
      waiters.forEach(waiter => waiter.reject(error));
    } finally {
      runtime.running = false;
      if (runtime.waiters.length) queueMicrotask(() => this.pump(session, runtime));
    }
  }

  async delete(documentId) {
    const session = this.sessions.get(documentId);
    session?.destroy();
    this.sessions.delete(documentId);
    this.saveRuntimes.delete(documentId);
    if (this.activeDocumentId === documentId) this.activeDocumentId = '';
    if (!this.available || !documentId) return;
    await this.documentStore.remove(documentId);
  }
}

export function createNativeDocumentStore(options = {}) {
  return new NativeDocumentStore(options);
}
