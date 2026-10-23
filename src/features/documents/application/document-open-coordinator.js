/**
 * Responsibility: Activate new document bodies and durably prepare imports before committing Documents Session state.
 * State/side effects: No independent state; mutates only the injected model, session store and persistence port after generation validation. Persisted existing-document loads belong to Persistence LoadController.
 */
import { updateDocumentRecord } from '../domain/document-record.js';

function activationOptions(restored = {}) {
  const options = { loaded: restored.loaded || null };
  if (Array.isArray(restored.chunks)) options.chunks = restored.chunks;
  else options.content = String(restored.content ?? '');
  return options;
}

export function createDocumentOpenCoordinator({ session, model, repository, assertCurrent } = {}) {
  if (!session || typeof session.insertRecord !== 'function') {
    throw new TypeError('Document open coordinator requires a document session store.');
  }
  if (!model || typeof model.activate !== 'function') {
    throw new TypeError('Document open coordinator requires the frozen DocumentModel.');
  }
  if (!repository || typeof repository.activate !== 'function' || typeof repository.persistSession !== 'function') {
    throw new TypeError('Document open coordinator requires a session document repository.');
  }
  if (typeof assertCurrent !== 'function') {
    throw new TypeError('Document open coordinator requires a generation validator.');
  }

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Document open coordinator has been destroyed.');
  };

  const activateRuntime = (record, restored, operation, validate) => {
    assertActive();
    assertCurrent(operation);
    model.activate(record, activationOptions(restored));
    repository.activate(model, record, restored?.loaded || null);
    if (typeof validate === 'function') validate(record, restored);
    assertCurrent(operation);
  };

  const commitNew = (record, restored, { index = 0, reason = 'new', persistLegacySnapshot = false } = {}) => {
    let snapshot = '';
    if (!record.nativeBacked) {
      snapshot = model.createSnapshot?.('document-session-create') ?? restored?.content ?? '';
      repository.rememberContent(record.id, snapshot);
    }
    if (persistLegacySnapshot) {
      repository.persistLegacyActiveSnapshot({
        title: record.title || '',
        content: snapshot,
        nativeBacked: Boolean(record.nativeBacked)
      });
    } else {
      repository.persistLegacyActiveTitle(record.title || '');
    }
    const records = [...session.records];
    records.splice(index, 0, record);
    repository.persistSession(records, record.id);
    session.insertRecord(record, { index, activate: true, reason });
    return Object.freeze({ record: session.getRecord(record.id), loaded: restored?.loaded || null });
  };

  const activateNew = (record, restored, operation, options = {}) => {
    activateRuntime(record, restored, operation, options.validate);
    return commitNew(record, restored, options);
  };

  const activateImported = async (record, restored, operation, options = {}) => {
    try {
      activateRuntime(record, restored, operation, options.validate);
      const targetVersion = model.getDocumentVersion();
      const saved = await repository.save(model, record, { forceSnapshot: true, snapshotReason: 'document-import' });
      assertActive();
      assertCurrent(operation);
      if (typeof options.validate === 'function') options.validate(record, restored);
      const committedVersion = Number(saved?.editorVersion ?? targetVersion);
      if (model.getDocumentVersion() !== committedVersion || model.title !== (saved?.editorTitle ?? record.title)) {
        throw Object.assign(new Error('DOCUMENT_CHANGED_DURING_SAVE'), { code: 'DOCUMENT_CHANGED_DURING_SAVE' });
      }
      const committedRecord = saved?.native ? updateDocumentRecord(record, {
        nativeBacked: true, nativeVersion: Number(saved.nativeVersion ?? saved.version) || 0
      }) : record;
      const opened = commitNew(committedRecord, restored, { ...options, persistLegacySnapshot: true });
      model.markPersisted(committedVersion, committedRecord.nativeVersion || 0);
      if (saved?.native) repository.forgetContent(record.id);
      return opened;
    } catch (error) {
      if (!session.getRecord(record.id)) {
        try { await repository.remove(record.id); }
        catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'Imported document cleanup failed.');
        }
      }
      throw error;
    }
  };

  return Object.freeze({
    activateNew,
    activateImported,
    destroy() {
      if (destroyed) return;
      destroyed = true;
    }
  });
}
