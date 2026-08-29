/**
 * Responsibility: Own one manual-save command boundary across document metadata, frozen-model version/snapshot reads, persistence delegation and final save status publication.
 * Imports: None; DocumentSessionController, frozen DocumentModel and SaveStatusStore are injected explicitly by the composition root.
 * Exports: createSaveController() exposing save(), saveCurrentFile() and saveAsMarkdown().
 * State/side effects: Owns only terminal lifecycle/request sequencing and manual-save orchestration; document body/path/session state remain owned by the injected model/documents authorities and file writes are delegated.
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

export function createSaveController({
  documentController,
  model,
  statusStore,
  writeText = null,
  chooseSaveFile = null,
  persistentFileSystem = false,
  normalizeTitle = null
} = {}) {
  assertObject(documentController, 'Save Controller document controller');
  assertMethod(documentController, 'saveActive', 'Save Controller document controller');
  assertMethod(documentController, 'getActiveRecord', 'Save Controller document controller');
  assertMethod(documentController, 'isCurrentGeneration', 'Save Controller document controller');
  assertObject(model, 'Save Controller frozen model');
  assertMethod(model, 'getDocumentVersion', 'Save Controller frozen model');
  assertMethod(model, 'createSnapshot', 'Save Controller frozen model');
  assertObject(statusStore, 'Save Controller status store');
  assertMethod(statusStore, 'setState', 'Save Controller status store');
  if (writeText !== null && typeof writeText !== 'function') throw new TypeError('Save Controller writeText must be a function when provided.');
  if (chooseSaveFile !== null && typeof chooseSaveFile !== 'function') throw new TypeError('Save Controller chooseSaveFile must be a function when provided.');
  if (normalizeTitle !== null && typeof normalizeTitle !== 'function') throw new TypeError('Save Controller normalizeTitle must be a function when provided.');

  let destroyed = false;
  let requestSequence = 0;

  const assertActive = () => {
    if (destroyed) throw new Error('Save Controller is destroyed.');
  };

  const cancelledResult = ({ requestId, generation = null, reason, stale = false, documentId = '' } = {}) => Object.freeze({
    requestId,
    generation,
    saved: false,
    completed: false,
    cancelled: true,
    stale: Boolean(stale),
    reason: String(reason || 'cancelled'),
    native: false,
    documentId: String(documentId || ''),
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
      if (destroyed) return cancelledResult({ requestId, reason: 'controller-destroyed', documentId });
      if (isDocumentStaleError(error)) {
        return cancelledResult({ requestId, reason: 'document-operation-stale', stale: true, documentId });
      }
      publishFailure({ documentId, targetVersion, backendVersion: initialBackendVersion, error });
      throw error;
    }

    const generation = Number.isSafeInteger(Number(persisted?.generation)) ? Number(persisted.generation) : null;
    if (destroyed) return cancelledResult({ requestId, generation, reason: 'controller-destroyed', documentId });
    if (generation === null || !documentController.isCurrentGeneration(generation)) {
      return cancelledResult({ requestId, generation, reason: 'document-operation-stale', stale: true, documentId });
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
        if (destroyed) return cancelledResult({ requestId, generation, reason: 'controller-destroyed', documentId: currentDocumentId });
        if (!documentController.isCurrentGeneration(generation) || isDocumentStaleError(error)) {
          return cancelledResult({ requestId, generation, reason: 'document-operation-stale', stale: true, documentId: currentDocumentId });
        }
        publishFailure({ documentId: currentDocumentId, targetVersion, backendVersion, error });
        throw error;
      }
      if (destroyed) return cancelledResult({ requestId, generation, reason: 'controller-destroyed', documentId: currentDocumentId });
      if (!documentController.isCurrentGeneration(generation)) {
        return cancelledResult({ requestId, generation, reason: 'document-operation-stale', stale: true, documentId: currentDocumentId });
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

  const requireFileWriter = () => {
    if (typeof writeText !== 'function') throw new Error('Save Controller file writer is unavailable.');
  };

  const normalizeMarkdownTitle = (value, fallbackTitle = '未命名文档') => {
    if (typeof normalizeTitle !== 'function') throw new Error('Save Controller title normalizer is unavailable.');
    return String(normalizeTitle(value, fallbackTitle));
  };

  const fileNameFromPath = path => String(path || '').split(/[\\/]/).pop() || '';

  const markdownSaveDialogOptions = Object.freeze({
    title: '另存为 Markdown',
    extension: 'md',
    extensions: Object.freeze(['md', 'markdown']),
    filterName: 'Markdown 文档'
  });

  const writeMarkdown = (path, content, reason, extension = 'md') => {
    requireFileWriter();
    return writeText(path, content, {
      extension: String(extension || 'md'),
      reason: String(reason || 'save-as-markdown'),
      mimeType: 'text/markdown;charset=utf-8'
    });
  };

  async function chooseMarkdownDestination(preferredName) {
    if (!persistentFileSystem) {
      return Object.freeze({ cancelled: false, path: preferredName, bindPath: false });
    }
    if (typeof chooseSaveFile !== 'function') throw new Error('Save Controller save-file picker is unavailable.');
    const path = await chooseSaveFile(preferredName, markdownSaveDialogOptions);
    if (!path) return Object.freeze({ cancelled: true, path: '', bindPath: false });
    return Object.freeze({ cancelled: false, path: String(path), bindPath: true });
  }

  async function saveCurrentFile(options = {}) {
    assertActive();
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Save Controller current-file options must be an object.');
    }
    requireFileWriter();
    const active = documentController.getActiveRecord();
    if (!active) throw new Error('当前没有可保存的文档');
    const fallbackTitle = String(options.fallbackTitle || '未命名文档');
    const title = String(options.title ?? active.title ?? fallbackTitle);
    const result = await save({
      title,
      fallbackTitle,
      forceSnapshot: true,
      snapshotReason: String(options.snapshotReason || 'document-storage'),
      statusMessage: String(options.statusMessage || '正在保存文件…'),
      contentReason: String(options.contentReason || 'save-current-file'),
      async afterPersist(context) {
        const record = context.record;
        if (!record) throw new Error('当前没有可保存的文档');
        if (persistentFileSystem && context.path) {
          const extension = String(record.title || '').split('.').pop() || 'md';
          await writeMarkdown(context.path, context.content, 'save-current-file', extension);
          return Object.freeze({ path: context.path, bindPath: false });
        }
        const preferredName = normalizeMarkdownTitle(context.title || title, fallbackTitle);
        const destination = await chooseMarkdownDestination(preferredName);
        if (destination.cancelled) return Object.freeze({ cancelled: true, reason: 'file-picker-cancelled' });
        if (!documentController.isCurrentGeneration(context.generation)) {
          return Object.freeze({ cancelled: true, stale: true, reason: 'document-operation-stale' });
        }
        await writeMarkdown(destination.path, context.content, 'save-current-file', 'md');
        return Object.freeze({
          path: destination.bindPath ? destination.path : '',
          fileName: preferredName,
          bindPath: destination.bindPath,
          browserDownload: !persistentFileSystem
        });
      }
    });
    if (result?.cancelled || result?.stale || result?.completed === false) return result;
    const continuation = result?.continuation || null;
    if (!continuation?.bindPath || !continuation.path) return result;
    assertMethod(documentController, 'bindDocumentFilePath', 'Save Controller document controller');
    const bound = documentController.bindDocumentFilePath(result.documentId, continuation.path, {
      title: fileNameFromPath(continuation.path),
      fallbackTitle
    });
    return Object.freeze({
      ...result,
      generation: Number.isSafeInteger(Number(bound?.generation)) ? Number(bound.generation) : result.generation,
      path: continuation.path,
      record: bound?.record || result.record
    });
  }

  async function saveAsMarkdown(options = {}) {
    assertActive();
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Save Controller save-as options must be an object.');
    }
    requireFileWriter();
    assertMethod(documentController, 'captureOperation', 'Save Controller document controller');

    const requestId = ++requestSequence;
    const operation = documentController.captureOperation('save-as-markdown');
    const operationGeneration = Number.isSafeInteger(Number(operation?.generation)) ? Number(operation.generation) : null;
    const active = documentController.getActiveRecord();
    const targetId = String(options.documentId || active?.id || '');
    const record = targetId && typeof documentController.getRecord === 'function'
      ? (documentController.getRecord(targetId) || (active?.id === targetId ? active : null))
      : active;
    if (!record) throw new Error('当前没有可另存的文档');

    const fallbackTitle = String(options.fallbackTitle || '未命名文档');
    const preferredName = normalizeMarkdownTitle(options.title ?? record.title, fallbackTitle);
    const destination = await chooseMarkdownDestination(preferredName);
    if (destination.cancelled) {
      return Object.freeze({
        requestId,
        generation: operationGeneration,
        saved: false,
        completed: false,
        cancelled: true,
        stale: false,
        reason: 'file-picker-cancelled',
        documentId: record.id,
        path: '',
        record
      });
    }
    if (destroyed) {
      return cancelledResult({ requestId, generation: operationGeneration, reason: 'controller-destroyed', documentId: record.id });
    }
    if (operationGeneration === null || !documentController.isCurrentGeneration(operationGeneration)) {
      return cancelledResult({ requestId, generation: operationGeneration, reason: 'document-operation-stale', stale: true, documentId: record.id });
    }

    let content;
    if (record.id === active?.id && String(model.documentId || record.id) === record.id) {
      content = model.createSnapshot(String(options.snapshotReason || 'save-as-markdown'));
    } else {
      assertMethod(documentController, 'readDocumentContent', 'Save Controller document controller');
      const contentResult = await documentController.readDocumentContent(record.id);
      const contentGeneration = Number.isSafeInteger(Number(contentResult?.generation)) ? Number(contentResult.generation) : null;
      if (destroyed) {
        return cancelledResult({ requestId, generation: operationGeneration, reason: 'controller-destroyed', documentId: record.id });
      }
      if (contentGeneration !== operationGeneration || !documentController.isCurrentGeneration(operationGeneration)) {
        return cancelledResult({ requestId, generation: operationGeneration, reason: 'document-operation-stale', stale: true, documentId: record.id });
      }
      content = String(contentResult?.content ?? '');
    }

    if (!documentController.isCurrentGeneration(operationGeneration)) {
      return cancelledResult({ requestId, generation: operationGeneration, reason: 'document-operation-stale', stale: true, documentId: record.id });
    }
    await writeMarkdown(destination.path, content, String(options.writeReason || 'save-as-markdown'), 'md');
    if (destroyed) {
      return cancelledResult({ requestId, generation: operationGeneration, reason: 'controller-destroyed', documentId: record.id });
    }
    if (!documentController.isCurrentGeneration(operationGeneration)) {
      return cancelledResult({ requestId, generation: operationGeneration, reason: 'document-operation-stale', stale: true, documentId: record.id });
    }

    let generation = operationGeneration;
    let bound = null;
    if (destination.bindPath) {
      assertMethod(documentController, 'bindDocumentFilePath', 'Save Controller document controller');
      bound = documentController.bindDocumentFilePath(record.id, destination.path, {
        title: fileNameFromPath(destination.path),
        fallbackTitle
      });
      generation = Number.isSafeInteger(Number(bound?.generation)) ? Number(bound.generation) : generation;
    }
    return Object.freeze({
      requestId,
      saved: true,
      completed: true,
      cancelled: false,
      stale: false,
      reason: 'saved-as-markdown',
      generation,
      documentId: record.id,
      path: destination.bindPath ? destination.path : '',
      record: bound?.record || record,
      browserDownload: !persistentFileSystem
    });
  }

  return Object.freeze({
    save,
    saveCurrentFile,
    saveAsMarkdown,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      requestSequence += 1;
    }
  });
}
