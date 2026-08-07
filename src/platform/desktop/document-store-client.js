function assertFunction(value, message) {
  if (typeof value !== 'function') throw new TypeError(message);
}

/**
 * Creates the desktop document-store command adapter.
 * It preserves the existing Rust command names, camelCase payload fields and
 * chunk transport semantics without owning persistence lifecycle, retry policy or document state.
 */
export function createDocumentStoreClient(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('document-store client options must be an object');
  }

  const invoke = options.invoke;
  assertFunction(invoke, 'document-store client requires an invoke function');

  async function save(request) {
    return invoke('save_document_state', { request }, {
      documentId: request?.documentId || '',
      baseVersion: request?.baseVersion || 0,
      nextVersion: request?.nextVersion || 0,
      transactions: request?.transactions?.length || 0,
      fullSnapshot: typeof request?.fullContent === 'string'
    });
  }

  async function beginSnapshotUpload(documentId, uploadId) {
    return invoke('begin_document_snapshot_upload', { documentId, uploadId }, {
      documentId,
      uploadId
    });
  }

  async function appendSnapshotChunk(documentId, uploadId, chunk, chunkIndex = 0) {
    const content = String(chunk ?? '');
    return invoke('append_document_snapshot_chunk', {
      documentId,
      uploadId,
      chunk: content
    }, {
      documentId,
      uploadId,
      chunkIndex,
      characters: content.length
    });
  }

  async function commitSnapshotUpload(request, uploadId) {
    return invoke('commit_document_snapshot_upload', { request, uploadId }, {
      documentId: request?.documentId || '',
      uploadId,
      baseVersion: request?.baseVersion || 0,
      nextVersion: request?.nextVersion || 0
    });
  }

  async function abortSnapshotUpload(documentId, uploadId) {
    return invoke('abort_document_snapshot_upload', { documentId, uploadId }, {
      documentId,
      uploadId
    });
  }

  async function load(documentId) {
    return invoke('load_document_state', { documentId }, { documentId });
  }

  async function loadManifest(documentId) {
    return invoke('load_document_manifest', { documentId }, { documentId });
  }

  async function readChunk(documentId, byteOffset, maxBytes = 512 * 1024) {
    return invoke('read_document_chunk', {
      documentId,
      byteOffset: Math.max(0, Number(byteOffset) || 0),
      maxBytes: Math.max(16 * 1024, Number(maxBytes) || 512 * 1024)
    }, { documentId, byteOffset, maxBytes });
  }

  async function search(request) {
    return invoke('search_document_state', { request }, {
      documentId: request?.documentId || '',
      queryLength: String(request?.query || '').length,
      from: Number(request?.from) || 0
    });
  }

  async function remove(documentId) {
    return invoke('delete_document_state', { documentId }, { documentId });
  }

  return Object.freeze({
    save,
    beginSnapshotUpload,
    appendSnapshotChunk,
    commitSnapshotUpload,
    abortSnapshotUpload,
    load,
    loadManifest,
    readChunk,
    search,
    remove
  });
}
