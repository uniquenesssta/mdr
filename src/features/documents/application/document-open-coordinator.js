/**
 * Responsibility: Atomically activate existing or newly created document bodies before committing session activation.
 * State/side effects: No independent state; mutates only the injected model, session store and persistence port after generation validation.
 */
import { updateDocumentRecord } from '../domain/document-record.js';

function activationOptions(restored = {}) {
  const options = { loaded: restored.loaded || null };
  if (Array.isArray(restored.chunks)) options.chunks = restored.chunks;
  else options.content = String(restored.content ?? '');
  return options;
}

function withLoadedMetadata(record, restored) {
  if (!restored?.metadataPatch) return record;
  return updateDocumentRecord(record, restored.metadataPatch, { fallbackTitle: record.title || '未命名文档' });
}

export function createDocumentOpenCoordinator({ session, model, repository, assertCurrent } = {}) {
  if (!session || typeof session.getRecord !== 'function' || typeof session.setActive !== 'function') {
    throw new TypeError('Document open coordinator requires a document session store.');
  }
  if (!model || typeof model.activate !== 'function') {
    throw new TypeError('Document open coordinator requires the frozen DocumentModel.');
  }
  if (!repository || typeof repository.load !== 'function' || typeof repository.persistSession !== 'function') {
    throw new TypeError('Document open coordinator requires a session document repository.');
  }
  if (typeof assertCurrent !== 'function') {
    throw new TypeError('Document open coordinator requires a generation validator.');
  }

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Document open coordinator has been destroyed.');
  };

  const activateLoaded = (record, restored, operation, {
    commitActive = true,
    commitMetadata = true,
    persist = true,
    reason = 'open'
  } = {}) => {
    assertActive();
    assertCurrent(operation);
    const effectiveRecord = withLoadedMetadata(record, restored);
    model.activate(effectiveRecord, activationOptions(restored));
    repository.activate(model, effectiveRecord, restored?.loaded || null);
    assertCurrent(operation);

    let committedRecord = effectiveRecord;
    if (commitMetadata && restored?.metadataPatch) {
      committedRecord = session.updateRecord(record.id, restored.metadataPatch, {
        fallbackTitle: record.title || '未命名文档',
        reason: 'native-loaded'
      });
    }
    if (commitActive) session.setActive(committedRecord.id, { reason });
    if (persist) {
      repository.persistSession(session.records, session.activeId);
      repository.persistLegacyActiveTitle(committedRecord.title || '');
    }
    return Object.freeze({ record: committedRecord, loaded: restored?.loaded || null });
  };

  const openExisting = async (documentId, operation, { reason = 'open' } = {}) => {
    assertActive();
    assertCurrent(operation);
    const record = session.getRecord(documentId);
    if (!record) throw new Error('目标文档不存在或已被删除');
    const restored = await repository.load(record);
    assertCurrent(operation);
    return activateLoaded(record, restored, operation, {
      commitActive: true,
      commitMetadata: true,
      persist: true,
      reason
    });
  };

  const activateNew = (record, restored, operation, {
    index = 0,
    reason = 'new',
    validate = null,
    persistLegacySnapshot = false
  } = {}) => {
    assertActive();
    assertCurrent(operation);
    model.activate(record, activationOptions(restored));
    repository.activate(model, record, restored?.loaded || null);
    if (typeof validate === 'function') validate(record, restored);
    assertCurrent(operation);
    session.insertRecord(record, { index, activate: true, reason });
    const snapshot = model.createSnapshot?.('document-session-create') ?? restored?.content ?? '';
    repository.rememberContent(record.id, snapshot);
    repository.persistSession(session.records, session.activeId);
    if (persistLegacySnapshot) {
      repository.persistLegacyActiveSnapshot({
        title: record.title || '',
        content: snapshot,
        nativeBacked: false
      });
    } else {
      repository.persistLegacyActiveTitle(record.title || '');
    }
    return Object.freeze({ record: session.getRecord(record.id), loaded: restored?.loaded || null });
  };

  return Object.freeze({
    openExisting,
    activateLoaded,
    activateNew,
    destroy() {
      if (destroyed) return;
      destroyed = true;
    }
  });
}
