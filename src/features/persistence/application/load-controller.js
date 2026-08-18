/**
 * Responsibility: Own persisted-document load orchestration across Documents metadata, the frozen DocumentModel/editor activation path and the SessionDocumentRepository.
 * Imports: None; Documents/domain normalization is injected so Persistence never imports another feature's internals.
 * State/side effects: Owns only terminal load-controller lifecycle and cancellation delegation; operation generation, document bodies, session records and storage remain owned by injected authorities.
 * Lifecycle: Explicit instance; destroy() is terminal, cancels pending repository load work and never destroys injected dependencies.
 */

function destroyedError() {
  const error = new Error('LOAD_CONTROLLER_DESTROYED');
  error.code = 'LOAD_CONTROLLER_DESTROYED';
  return error;
}

function activationOptions(restored = {}) {
  const options = { loaded: restored.loaded || null };
  if (Array.isArray(restored.chunks)) options.chunks = restored.chunks;
  else options.content = String(restored.content ?? '');
  return options;
}

export function createLoadController({
  documents,
  model,
  editor,
  repository,
  resolveRecord,
  assertGeneration
} = {}) {
  if (!documents || typeof documents.getRecord !== 'function' || typeof documents.updateRecord !== 'function' || typeof documents.setActive !== 'function') {
    throw new TypeError('Load Controller requires the Documents session boundary.');
  }
  if (!model || typeof model.activate !== 'function') {
    throw new TypeError('Load Controller requires the frozen DocumentModel.');
  }
  if (!editor || typeof editor.getTextLength !== 'function') {
    throw new TypeError('Load Controller requires the neutral editor read boundary.');
  }
  if (
    !repository
    || typeof repository.load !== 'function'
    || typeof repository.activate !== 'function'
    || typeof repository.persistSession !== 'function'
    || typeof repository.persistLegacyActiveTitle !== 'function'
    || typeof repository.materializeLoadedContent !== 'function'
  ) {
    throw new TypeError('Load Controller requires the SessionDocumentRepository load boundary.');
  }
  if (typeof resolveRecord !== 'function') {
    throw new TypeError('Load Controller requires a Documents record resolver.');
  }
  if (typeof assertGeneration !== 'function') {
    throw new TypeError('Load Controller requires a generation validator.');
  }

  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw destroyedError();
  };

  const assertCurrent = operation => {
    assertActive();
    assertGeneration(operation);
  };

  const activateLoaded = (record, restored, operation, {
    commitActive = true,
    commitMetadata = true,
    persist = true,
    reason = 'open'
  } = {}) => {
    assertCurrent(operation);
    const metadataPatch = restored?.metadataPatch || null;
    const effectiveRecord = metadataPatch
      ? resolveRecord(record, metadataPatch, { fallbackTitle: record.title || '未命名文档' })
      : record;

    // Generation is validated immediately before the only model/editor activation write.
    assertCurrent(operation);
    model.activate(effectiveRecord, activationOptions(restored));
    repository.activate(model, effectiveRecord, restored?.loaded || null);
    const editorCharacters = Math.max(0, Number(editor.getTextLength()) || 0);
    assertCurrent(operation);

    let committedRecord = effectiveRecord;
    if (commitMetadata && metadataPatch) {
      committedRecord = documents.updateRecord(record.id, metadataPatch, {
        fallbackTitle: record.title || '未命名文档',
        reason: 'native-loaded'
      });
    }
    if (commitActive) documents.setActive(committedRecord.id, { reason });
    if (persist) {
      repository.persistSession(documents.records, documents.activeId);
      repository.persistLegacyActiveTitle(committedRecord.title || '');
    }

    return Object.freeze({
      record: committedRecord,
      loaded: restored?.loaded || null,
      metadataPatch,
      editorCharacters
    });
  };

  const loadExisting = async (documentId, operation, options = {}) => {
    assertCurrent(operation);
    const id = String(documentId || '');
    const record = documents.getRecord(id);
    if (!record) throw new Error('目标文档不存在或已被删除');
    const restored = await repository.load(record);
    assertCurrent(operation);
    return activateLoaded(record, restored, operation, options);
  };

  const readContent = async (documentId, operation, { isolated = true } = {}) => {
    assertCurrent(operation);
    const record = documents.getRecord(String(documentId || ''));
    if (!record) return Object.freeze({ record: null, content: '', loaded: null });
    const restored = await repository.load(record, { isolated: Boolean(isolated) });
    assertCurrent(operation);
    return Object.freeze({
      record,
      content: repository.materializeLoadedContent(restored),
      loaded: restored?.loaded || null
    });
  };

  const cancelPending = () => {
    assertActive();
    repository.cancelPendingLoad?.();
  };

  return Object.freeze({
    get destroyed() { return destroyed; },
    loadExisting,
    readContent,
    cancelPending,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      repository.cancelPendingLoad?.();
    }
  });
}
