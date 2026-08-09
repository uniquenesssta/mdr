import { normalizeDocumentNativeMetadata } from '../features/documents/index.js';

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

function createSession(documentId) {
  return {
    documentId,
    backendVersion: 0,
    lastEditorVersion: 0,
    lastTitle: '',
    initialized: false,
    running: false,
    waiters: [],
    forceSnapshot: false,
    source: null,
    document: null
  };
}

export class NativeDocumentStore {
  constructor({ documentStore, available = false } = {}) {
    this.documentStore = documentStore;
    this.nativeAvailable = Boolean(available);
    this.sessions = new Map();
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
      session = createSession(documentId);
      this.sessions.set(documentId, session);
    }
    return session;
  }

  activateDocument(source, document, loaded = null) {
    if (!document?.id) return;
    this.activeDocumentId = document.id;
    const session = this.getSession(document.id);
    session.source = source;
    session.document = document;
    session.lastEditorVersion = currentDocumentVersion(source);
    source?.registerConsumer?.('storage', session.lastEditorVersion);
    session.lastTitle = document.title || '';
    if (loaded) {
      session.backendVersion = Math.max(0, Number(loaded.version) || 0);
      session.initialized = true;
    } else if (!document.nativeBacked) {
      session.backendVersion = 0;
      session.initialized = false;
    } else {
      session.backendVersion = Math.max(0, Number(document.nativeVersion) || 0);
      session.initialized = session.backendVersion > 0;
    }
  }

  async load(documentId) {
    if (!this.available || !documentId) return null;
    const loadToken = ++this.loadSequence;
    const ensureCurrentLoad = () => {
      if (loadToken !== this.loadSequence) throw new Error('DOCUMENT_LOAD_CANCELLED');
    };
    const supportsSegmentedLoad = Boolean(
      this.documentStore?.loadManifest
      && this.documentStore?.readChunk
    );
    if (!supportsSegmentedLoad) {
      const loaded = await this.documentStore.load(documentId);
      ensureCurrentLoad();
      if (!loaded) return null;
      const session = this.getSession(documentId);
      session.backendVersion = Math.max(0, Number(loaded.version) || 0);
      session.initialized = true;
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
      const session = this.getSession(documentId);
      session.backendVersion = Math.max(0, Number(loaded.version) || 0);
      session.initialized = true;
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

  async saveSnapshotInChunks(session, request, content) {
    const uploadId = `upload_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await this.documentStore.beginSnapshotUpload(session.document.id, uploadId);
    try {
      let offset = 0;
      let chunkIndex = 0;
      while (offset < content.length) {
        const end = getSafeSnapshotChunkEnd(content, offset);
        await this.documentStore.appendSnapshotChunk(
          session.document.id,
          uploadId,
          content.slice(offset, end),
          chunkIndex
        );
        offset = end;
        chunkIndex += 1;
        this.emit({
          state: 'saving',
          documentId: session.document.id,
          targetVersion: currentDocumentVersion(session.source),
          backendVersion: session.backendVersion,
          uploadedChars: offset,
          totalChars: content.length,
          progress: content.length > 0 ? offset / content.length : 1,
          pending: session.waiters.length
        });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return await this.documentStore.commitSnapshotUpload(request, uploadId);
    } catch (error) {
      try {
        await this.documentStore.abortSnapshotUpload?.(session.document.id, uploadId);
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
    session.source = source;
    session.document = document;
    session.forceSnapshot = session.forceSnapshot || Boolean(options.forceSnapshot);
    const targetVersion = currentDocumentVersion(source);
    const forceSnapshot = Boolean(options.forceSnapshot);
    if (
      session.initialized
      && !session.running
      && !session.waiters.length
      && !forceSnapshot
      && targetVersion <= session.lastEditorVersion
      && (document.title || '') === session.lastTitle
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
      session.waiters.push({ targetVersion, forceSnapshot: Boolean(options.forceSnapshot), resolve, reject });
      this.emit({
        state: 'queued',
        documentId: document.id,
        targetVersion,
        pending: session.waiters.length
      });
      this.pump(session);
    });
  }

  async pump(session) {
    if (session.running || !session.source || !session.document) return;
    session.running = true;
    try {
      while (session.waiters.length) {
        if (session.source?.documentId && session.source.documentId !== session.document.id) {
          throw new Error('DOCUMENT_SOURCE_MISMATCH');
        }
        const editorVersion = currentDocumentVersion(session.source);
        const changes = getDocumentChanges(session.source, session.lastEditorVersion);
        const mustReset = !session.initialized || !Array.isArray(changes);
        const baseVersion = session.backendVersion;
        const nextVersion = baseVersion + 1;
        const forceSnapshot = session.forceSnapshot || session.waiters.some(waiter => waiter.forceSnapshot);
        session.forceSnapshot = false;
        const snapshotContent = mustReset ? createDocumentSnapshot(session.source) : null;
        const useChunkedSnapshot = mustReset
          && snapshotContent.length >= SNAPSHOT_UPLOAD_THRESHOLD
          && this.supportsChunkedSnapshots;
        const request = {
          documentId: session.document.id,
          title: session.document.title || '',
          baseVersion,
          nextVersion,
          fullContent: useChunkedSnapshot ? null : snapshotContent,
          transactions: mustReset ? [] : changes,
          updatedAt: session.document.updatedAt || Date.now(),
          forceSnapshot
        };

        let response;
        this.emit({
          state: 'saving',
          documentId: session.document.id,
          targetVersion: editorVersion,
          backendVersion: baseVersion,
          pending: session.waiters.length
        });
        try {
          response = useChunkedSnapshot
            ? await this.saveSnapshotInChunks(session, request, snapshotContent)
            : await this.documentStore.save(request);
        } catch (error) {
          const message = error?.message || String(error);
          if (!mustReset && message.includes('VERSION_MISMATCH')) {
            session.initialized = false;
            continue;
          }
          throw error;
        }

        session.backendVersion = Math.max(nextVersion, Number(response?.version) || 0);
        session.lastEditorVersion = editorVersion;
        session.initialized = true;
        session.lastTitle = session.document.title || '';
        const native = normalizeDocumentNativeMetadata({
          nativeBacked: true,
          nativeVersion: session.backendVersion
        });
        session.source?.markPersisted?.(editorVersion, session.backendVersion);
        session.source?.acknowledge?.('storage', editorVersion);

        const completed = [];
        const pending = [];
        for (const waiter of session.waiters) {
          if (waiter.targetVersion <= editorVersion) completed.push(waiter);
          else pending.push(waiter);
        }
        session.waiters = pending;
        completed.forEach(waiter => waiter.resolve({ native: true, ...response, ...native }));
        this.emit({
          state: 'saved',
          documentId: session.document.id,
          version: session.backendVersion,
          snapshotCreated: Boolean(response?.snapshotCreated),
          journalEntries: Number(response?.journalEntries) || 0,
          pending: session.waiters.length
        });
      }
    } catch (error) {
      const waiters = session.waiters.splice(0);
      this.emit({
        state: 'error',
        documentId: session.document?.id || session.documentId,
        message: error?.message || String(error)
      });
      waiters.forEach(waiter => waiter.reject(error));
    } finally {
      session.running = false;
      if (session.waiters.length) queueMicrotask(() => this.pump(session));
    }
  }

  async delete(documentId) {
    this.sessions.delete(documentId);
    if (this.activeDocumentId === documentId) this.activeDocumentId = '';
    if (!this.available || !documentId) return;
    await this.documentStore.remove(documentId);
  }
}

export function createNativeDocumentStore(options = {}) {
  return new NativeDocumentStore(options);
}
