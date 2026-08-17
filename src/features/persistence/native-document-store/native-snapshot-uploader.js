/**
 * Responsibility: Own native snapshot upload chunk boundaries, surrogate-pair safety, begin/append/commit/abort sequencing, cancellation and terminal lifecycle.
 * Imports: None; the runtime-neutral documentStore transport, progress sink, upload-id factory and yield capability are injected.
 * Exports: createNativeSnapshotUploader().
 * State/side effects: Owns only active upload metadata per document. Document body is transient call input and is never retained in uploader state.
 * Lifecycle: cancel(documentId) aborts one active upload; destroy() is idempotent and terminal, aborting every active upload and rejecting later work.
 */

const SNAPSHOT_UPLOAD_THRESHOLD = 512 * 1024;
const SNAPSHOT_UPLOAD_CHUNK_CHARS = 256 * 1024;

function createUploaderDestroyedError() {
  const error = new Error('NATIVE_SNAPSHOT_UPLOADER_DESTROYED');
  error.code = 'NATIVE_SNAPSHOT_UPLOADER_DESTROYED';
  return error;
}

function createUploadCancelledError(documentId, reason = 'cancelled') {
  const error = new Error('NATIVE_SNAPSHOT_UPLOAD_CANCELLED');
  error.code = 'NATIVE_SNAPSHOT_UPLOAD_CANCELLED';
  error.documentId = documentId;
  error.reason = String(reason || 'cancelled');
  return error;
}

function createActiveUploadError(documentId) {
  const error = new Error('NATIVE_SNAPSHOT_UPLOAD_ACTIVE');
  error.code = 'NATIVE_SNAPSHOT_UPLOAD_ACTIVE';
  error.documentId = documentId;
  return error;
}

function createAbortFailure(originalError, abortError, documentId) {
  const failure = new AggregateError(
    [originalError, abortError],
    'NATIVE_SNAPSHOT_UPLOAD_ABORT_FAILED'
  );
  failure.code = 'NATIVE_SNAPSHOT_UPLOAD_ABORT_FAILED';
  failure.documentId = documentId;
  failure.cause = originalError;
  return failure;
}

function defaultUploadId() {
  return `upload_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeSnapshotChunkEnd(content, start) {
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

export function createNativeSnapshotUploader({
  documentStore = null,
  notify = () => {},
  createUploadId = defaultUploadId,
  yieldControl = async () => {}
} = {}) {
  if (typeof notify !== 'function') throw new TypeError('Native Snapshot Uploader notify must be a function.');
  if (typeof createUploadId !== 'function') throw new TypeError('Native Snapshot Uploader createUploadId must be a function.');
  if (typeof yieldControl !== 'function') throw new TypeError('Native Snapshot Uploader yieldControl must be a function.');

  let destroyed = false;
  let generation = 0;
  const activeUploads = new Map();

  const hasTransport = () => Boolean(
    documentStore?.beginSnapshotUpload
    && documentStore?.appendSnapshotChunk
    && documentStore?.commitSnapshotUpload
    && documentStore?.abortSnapshotUpload
  );

  const assertActive = () => {
    if (destroyed) throw createUploaderDestroyedError();
  };

  const ensureCurrent = record => {
    if (destroyed) throw createUploaderDestroyedError();
    if (activeUploads.get(record.documentId) !== record || record.cancelled) {
      throw record.cancellationError || createUploadCancelledError(record.documentId);
    }
  };

  async function abortRecord(record, originalError) {
    if (!record.abortPromise) {
      record.abortPromise = Promise.resolve().then(() => (
        documentStore.abortSnapshotUpload(record.documentId, record.uploadId)
      ));
    }
    try {
      await record.abortPromise;
    } catch (abortError) {
      throw createAbortFailure(originalError, abortError, record.documentId);
    }
  }

  async function upload({
    request,
    content,
    getTargetVersion = () => 0,
    backendVersion = 0,
    getPendingCount = () => 0
  } = {}) {
    assertActive();
    if (!hasTransport()) throw new Error('NATIVE_SNAPSHOT_UPLOAD_UNSUPPORTED');
    if (!request || typeof request !== 'object') throw new TypeError('Native Snapshot Uploader request is required.');
    const documentId = String(request.documentId || '');
    if (!documentId) throw new TypeError('Native Snapshot Uploader document id is required.');
    if (activeUploads.has(documentId)) throw createActiveUploadError(documentId);
    if (typeof getTargetVersion !== 'function') throw new TypeError('Native Snapshot Uploader getTargetVersion must be a function.');
    if (typeof getPendingCount !== 'function') throw new TypeError('Native Snapshot Uploader getPendingCount must be a function.');

    const body = String(content ?? '');
    const uploadId = String(createUploadId(documentId, ++generation) || '');
    if (!uploadId) throw new TypeError('Native Snapshot Uploader upload id is required.');
    const record = {
      documentId,
      uploadId,
      generation,
      cancelled: false,
      cancellationError: null,
      abortPromise: null
    };
    activeUploads.set(documentId, record);

    try {
      await documentStore.beginSnapshotUpload(documentId, uploadId);
      ensureCurrent(record);

      let offset = 0;
      let chunkIndex = 0;
      while (offset < body.length) {
        ensureCurrent(record);
        const end = safeSnapshotChunkEnd(body, offset);
        await documentStore.appendSnapshotChunk(
          documentId,
          uploadId,
          body.slice(offset, end),
          chunkIndex
        );
        ensureCurrent(record);
        offset = end;
        chunkIndex += 1;
        notify(Object.freeze({
          state: 'saving',
          documentId,
          targetVersion: Math.max(0, Number(getTargetVersion()) || 0),
          backendVersion: Math.max(0, Number(backendVersion) || 0),
          uploadedChars: offset,
          totalChars: body.length,
          progress: body.length > 0 ? offset / body.length : 1,
          pending: Math.max(0, Number(getPendingCount()) || 0)
        }));
        await yieldControl();
        ensureCurrent(record);
      }

      ensureCurrent(record);
      const response = await documentStore.commitSnapshotUpload(request, uploadId);
      ensureCurrent(record);
      return response;
    } catch (error) {
      const failure = record.cancellationError || error;
      await abortRecord(record, failure);
      throw failure;
    } finally {
      if (activeUploads.get(documentId) === record) activeUploads.delete(documentId);
    }
  }

  async function cancel(documentId, reason = 'cancelled') {
    assertActive();
    const id = String(documentId || '');
    const record = activeUploads.get(id);
    if (!record) return false;
    if (!record.cancelled) {
      record.cancelled = true;
      record.cancellationError = createUploadCancelledError(id, reason);
    }
    await abortRecord(record, record.cancellationError);
    return true;
  }

  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    const records = [...activeUploads.values()];
    const failures = [];
    for (const record of records) {
      record.cancelled = true;
      record.cancellationError = createUploaderDestroyedError();
      try {
        await abortRecord(record, record.cancellationError);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'NATIVE_SNAPSHOT_UPLOADER_DESTROY_FAILED');
  }

  return Object.freeze({
    get supported() {
      return !destroyed && hasTransport();
    },
    get activeCount() {
      return activeUploads.size;
    },
    get destroyed() {
      return destroyed;
    },
    shouldUpload(content) {
      assertActive();
      return hasTransport() && String(content ?? '').length >= SNAPSHOT_UPLOAD_THRESHOLD;
    },
    upload,
    cancel,
    destroy
  });
}
