
/**
 * Responsibility: Own one manual-save command boundary across document metadata, frozen-model version/snapshot reads, persistence delegation and final save status publication.
 * Imports: None; DocumentSessionController, frozen DocumentModel and SaveStatusStore are injected explicitly by the composition root.
 * Exports: createSaveController().
 * State/side effects: Owns only terminal lifecycle state and a monotonic request id; it stores no document body, path, session record or persistence result.
 * Lifecycle: destroy() is idempotent and terminal; in-flight completion after destroy is classified as cancellation and cannot publish late success/error state.
 */

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} is required.`);
  return value;
}

function assertMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') throw new TypeError(`${label} requires ${method}().`);
}

function normalizeVersion(value) {
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function errorMessage(error) {
  return String(error?.message || error || '未知错误');
}

function isDocumentStaleError(error) {
  return error?.code === 'DOCUMENT_OPERATION_STALE';
}

function freezeContinuation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? null;
  return Object.freeze({ ...value });
}

export function createSaveController({ documentController, model, statusStore } = {}) {
  assertObject(documentController, 'Save Controller document controller');
  assertMethod(documentController, 'saveActive', 'Save Controller document controller');
  assertMethod(documentController, 'getActiveRecord', 'Save Controller document controller');
  assertMethod(documentController, 'isCurrentGeneration', 'Save Controller document controller');
  assertObject(model, 'Save Controller frozen model');
  assertMethod(model, 'getDocumentVersion', 'Save Controller frozen model');
  assertMethod(model, 'createSnapshot', 'Save Controller frozen model');
  assertObject(statusStore, 'Save Controller status store');
  assertMethod(statusStore, 'setState', 'Save Controller status store');

  let destroyed = false;
  let requestSequence = 0;

  const assertActive = () => {
    if (destroyed) throw new Error('Save Controller is destroyed.');
  };

  const cancelledResult = ({ requestId, generation = null, reason, stale = false } = {}) => Object.freeze({
    requestId,
    generation,
    saved: false,
    completed: false,
    cancelled: true,
    stale: Boolean(stale),
    reason: String(reason || 'cancelled'),
    native: false,
    documentId: '',
    title: '',
    path: '',
    targetVersion: null,
    editorVersion: null,
    backendVersion: null,
    record: null,
    continuation: null
  });

  const publishFailure = ({ documentId, targetVersion, backendVersion, error }) => {
    statusStore.setState('error', {
      operation: 'save',
      documentId,
      message: '保存失败：' + errorMessage(error),
      targetVersion,
      backendVersion
    }, 'save-controller-error');
  };

  async function save(options = {}) {
    assertActive();
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Save Controller options must be an object.');
    }
    if (options.afterPersist !== undefined && typeof options.afterPersist !== 'function') {
      throw new TypeError('Save Controller afterPersist must be a function when provided.');
    }

    const requestId = ++requestSequence;
    const activeBefore = documentController.getActiveRecord();
    const documentId = String(activeBefore?.id || '');
    const targetVersion = normalizeVersion(model.getDocumentVersion());
    const initialBackendVersion = normalizeVersion(activeBefore?.nativeVersion);
    const title = String(options.title ?? activeBefore?.title ?? '');
    const fallbackTitle = String(options.fallbackTitle || '未命名文档');
    const statusMessage = String(options.statusMessage || '正在保存…');
    const snapshotReason = String(options.snapshotReason || 'document-storage');
    const contentReason = String(options.contentReason || 'manual-save-result');

    statusStore.setState('saving', {
      operation: 'save',
      documentId,
      message: statusMessage,
      targetVersion,
      backendVersion: initialBackendVersion
    }, 'save-controller-start');

    let persisted;
    try {
      persisted = await documentController.saveActive({
        title,
        fallbackTitle,
        forceSnapshot: Boolean(options.forceSnapshot),
        snapshotReason
      });
    } catch (error) {
      if (destroyed) return cancelledResult({ requestId, reason: 'controller-destroyed' });
      if (isDocumentStaleError(error)) {
        return cancelledResult({ requestId, reason: 'document-operation-stale', stale: true });
      }
      publishFailure({ documentId, targetVersion, backendVersion: initialBackendVersion, error });
      throw error;
    }

    const generation = Number.isSafeInteger(Number(persisted?.generation)) ? Number(persisted.generation) : null;
    if (destroyed) return cancelledResult({ requestId, generation, reason: 'controller-destroyed' });
    if (generation === null || !documentController.isCurrentGeneration(generation)) {
      return cancelledResult({ requestId, generation, reason: 'document-operation-stale', stale: true });
    }

    const record = persisted?.record || documentController.getActiveRecord() || null;
    const currentDocumentId = String(record?.id || documentId);
    const editorVersion = normalizeVersion(model.getDocumentVersion());
    const backendVersion = normalizeVersion(
      persisted?.result?.version
      ?? persisted?.result?.nativeVersion
      ?? record?.nativeVersion
    );
    const native = Boolean(persisted?.native ?? persisted?.result?.native);
    let continuation = null;

    if (typeof options.afterPersist === 'function') {
      const context = Object.freeze({
        requestId,
        generation,
        documentId: currentDocumentId,
        title: String(record?.title || title),
        path: String(record?.filePath || ''),
        targetVersion,
        editorVersion,
        backendVersion,
        native,
        record,
        content: model.createSnapshot(contentReason)
      });
      try {
        continuation = await options.afterPersist(context);
      } catch (error) {
        if (destroyed) return cancelledResult({ requestId, generation, reason: 'controller-destroyed' });
        if (!documentController.isCurrentGeneration(generation) || isDocumentStaleError(error)) {
          return cancelledResult({ requestId, generation, reason: 'document-operation-stale', stale: true });
        }
        publishFailure({ documentId: currentDocumentId, targetVersion, backendVersion, error });
        throw error;
      }
      if (destroyed) return cancelledResult({ requestId, generation, reason: 'controller-destroyed' });
      if (!documentController.isCurrentGeneration(generation)) {
        return cancelledResult({ requestId, generation, reason: 'document-operation-stale', stale: true });
      }
    }

    const continuationSnapshot = freezeContinuation(continuation);
    const cancelled = Boolean(continuationSnapshot?.cancelled);
    statusStore.setState('saved', {
      operation: 'save',
      documentId: currentDocumentId,
      targetVersion,
      backendVersion,
      snapshotCreated: Boolean(persisted?.result?.snapshotCreated)
    }, cancelled ? 'save-controller-post-persist-cancelled' : 'save-controller-complete');

    return Object.freeze({
      requestId,
      generation,
      saved: persisted?.saved !== false,
      completed: !cancelled,
      cancelled,
      stale: false,
      reason: cancelled ? String(continuationSnapshot?.reason || 'cancelled') : 'saved',
      native,
      documentId: currentDocumentId,
      title: String(record?.title || title),
      path: String(record?.filePath || ''),
      targetVersion,
      editorVersion,
      backendVersion,
      record,
      continuation: continuationSnapshot
    });
  }

  return Object.freeze({
    save,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      requestSequence += 1;
    }
  });
}
