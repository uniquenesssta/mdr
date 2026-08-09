/**
 * Responsibility: Own document lifecycle orchestration and operation generation across Session Store, frozen DocumentModel and persistence.
 * State/side effects: Owns only lifecycle generation/destroy state; document metadata belongs to Session Store and body belongs to DocumentModel/repository persistence.
 */
import { createDocumentRecord } from '../domain/document-record.js';
import { createDocumentOpenCoordinator } from './document-open-coordinator.js';
import { createDocumentCloseCoordinator } from './document-close-coordinator.js';
import { createDocumentTitleController } from './document-title-controller.js';

export class DocumentOperationStaleError extends Error {
  constructor(operation, currentGeneration) {
    super('DOCUMENT_OPERATION_STALE');
    this.name = 'DocumentOperationStaleError';
    this.code = 'DOCUMENT_OPERATION_STALE';
    this.operation = operation || null;
    this.currentGeneration = currentGeneration;
  }
}

function frozenResult(operation, value = {}) {
  return Object.freeze({ generation: operation.generation, operation: operation.kind, ...value });
}

export function createDocumentSessionController({
  session,
  model,
  repository,
  now = Date.now,
  random = Math.random
} = {}) {
  if (!session || typeof session.getActiveRecord !== 'function' || typeof session.insertRecord !== 'function') {
    throw new TypeError('Document session controller requires a document session store.');
  }
  if (!model || typeof model.activate !== 'function' || typeof model.createSnapshot !== 'function') {
    throw new TypeError('Document session controller requires the frozen DocumentModel.');
  }
  if (!repository || typeof repository.load !== 'function' || typeof repository.save !== 'function') {
    throw new TypeError('Document session controller requires a session document repository.');
  }
  if (typeof now !== 'function' || typeof random !== 'function') {
    throw new TypeError('Document session controller requires clock and random functions.');
  }

  let destroyed = false;
  let generation = 0;

  const assertActive = () => {
    if (destroyed) throw new Error('Document session controller has been destroyed.');
  };

  const isCurrentGeneration = operationOrGeneration => {
    if (destroyed) return false;
    const value = typeof operationOrGeneration === 'object'
      ? Number(operationOrGeneration?.generation)
      : Number(operationOrGeneration);
    return Number.isFinite(value) && value === generation;
  };

  const assertCurrent = operation => {
    assertActive();
    if (!isCurrentGeneration(operation)) throw new DocumentOperationStaleError(operation, generation);
  };

  const captureOperation = (kind = 'background') => Object.freeze({ generation, kind: String(kind || 'background') });

  const beginOperation = kind => {
    assertActive();
    generation += 1;
    repository.cancelPendingLoad?.();
    return Object.freeze({ generation, kind: String(kind || 'document') });
  };

  const openCoordinator = createDocumentOpenCoordinator({ session, model, repository, assertCurrent });
  const titleController = createDocumentTitleController({ session, model, repository, now });
  const closeCoordinator = createDocumentCloseCoordinator({
    session,
    model,
    repository,
    openCoordinator,
    assertCurrent
  });

  const createRecord = ({ title, filePath = '', fallbackTitle = '未命名文档' } = {}) => createDocumentRecord({
    title: title || fallbackTitle,
    filePath,
    fallbackTitle
  }, { now, random });

  const runtimeMatchesSession = () => String(model.documentId || '') === String(session.activeId || '');

  const restoreRuntimeForSession = async operation => {
    assertCurrent(operation);
    if (runtimeMatchesSession()) return;
    const activeRecord = session.getActiveRecord();
    if (!activeRecord) {
      model.activate(null, { content: '' });
      repository.persistSession(session.records, session.activeId);
      repository.clearLegacyActiveSnapshot();
      return;
    }
    const restored = await repository.load(activeRecord);
    assertCurrent(operation);
    openCoordinator.activateLoaded(activeRecord, restored, operation, {
      commitActive: true,
      commitMetadata: true,
      persist: true,
      reason: 'operation-rollback'
    });
  };

  const rollbackRuntimeOnFailure = async (operation, error) => {
    if (error instanceof DocumentOperationStaleError || error?.code === 'DOCUMENT_OPERATION_STALE') throw error;
    if (!isCurrentGeneration(operation) || runtimeMatchesSession()) throw error;
    try {
      await restoreRuntimeForSession(operation);
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], 'Document operation failed and runtime rollback was incomplete.');
    }
    throw error;
  };

  const saveActive = async ({
    operation = captureOperation('save'),
    title,
    fallbackTitle = '未命名文档',
    forceSnapshot = false,
    snapshotReason = 'document-storage'
  } = {}) => {
    assertCurrent(operation);
    let record = session.getActiveRecord();
    const runtimeDocumentId = String(model.documentId || '');
    if (runtimeDocumentId && record?.id !== runtimeDocumentId) {
      const runtimeRecord = session.getRecord(runtimeDocumentId);
      if (runtimeRecord) {
        session.setActive(runtimeRecord.id, { reason: 'runtime-reconciled' });
        record = runtimeRecord;
      }
    }
    if (!record) return frozenResult(operation, { saved: false, native: false, record: null });

    const patch = { updatedAt: now() };
    if (title !== undefined) patch.title = title;
    record = session.updateRecord(record.id, patch, { fallbackTitle, reason: 'save-metadata' });
    model.updateTitle(record.title);
    repository.persistSession(session.records, session.activeId);
    repository.persistLegacyActiveTitle(record.title);

    const saveResult = await repository.save(model, record, { forceSnapshot, snapshotReason });
    assertCurrent(operation);
    if (saveResult?.native) {
      record = session.updateRecord(record.id, {
        nativeBacked: true,
        nativeVersion: Number(saveResult.nativeVersion ?? saveResult.version) || 0
      }, { fallbackTitle, reason: 'native-saved' });
      repository.persistLegacyActiveSnapshot({ title: record.title, nativeBacked: true });
    }
    repository.persistSession(session.records, session.activeId);
    return frozenResult(operation, {
      saved: true,
      native: Boolean(saveResult?.native),
      record,
      result: saveResult || { native: false }
    });
  };

  const initializeEmptySession = ({ legacyRecords = [] } = {}) => {
    const operation = beginOperation('initialize');
    repository.resetLegacySession(legacyRecords);
    assertCurrent(operation);
    session.reset({ reason: 'startup-reset' });
    model.activate(null, { content: '' });
    repository.persistSession(session.records, session.activeId);
    repository.clearLegacyActiveSnapshot();
    return frozenResult(operation, { records: session.records, activeId: session.activeId });
  };

  const ensureActiveForEditing = ({ title = '未命名文档', fallbackTitle = title } = {}) => {
    assertActive();
    const existing = session.getActiveRecord();
    if (existing) return Object.freeze({ generation, operation: 'lazy-create', created: false, record: existing });
    const operation = beginOperation('lazy-create');
    const record = createRecord({ title, fallbackTitle });
    assertCurrent(operation);
    model.adoptDocument(record);
    session.insertRecord(record, { index: 0, activate: true, reason: 'lazy-create' });
    repository.rememberContent(record.id, model.createSnapshot('lazy-document-create'));
    repository.activate(model, record, null);
    repository.persistSession(session.records, session.activeId);
    repository.persistLegacyActiveTitle(record.title);
    return frozenResult(operation, { created: true, record: session.getRecord(record.id) });
  };

  const openDocument = async (documentId, options = {}) => {
    const operation = beginOperation('open');
    const id = String(documentId || '');
    if (id && id === session.activeId) {
      return frozenResult(operation, { opened: false, record: session.getActiveRecord() });
    }
    try {
      await saveActive({
        operation,
        title: options.currentTitle,
        fallbackTitle: options.fallbackTitle,
        snapshotReason: 'document-switch'
      });
      assertCurrent(operation);
      const opened = await openCoordinator.openExisting(id, operation, { reason: 'open' });
      assertCurrent(operation);
      return frozenResult(operation, { opened: true, record: opened.record, loaded: opened.loaded });
    } catch (error) {
      return rollbackRuntimeOnFailure(operation, error);
    }
  };

  const newDocument = async ({
    title,
    content = '',
    filePath = '',
    currentTitle,
    fallbackTitle = '未命名文档'
  } = {}) => {
    const operation = beginOperation('new');
    try {
      await saveActive({ operation, title: currentTitle, fallbackTitle, snapshotReason: 'document-new' });
      assertCurrent(operation);
      const record = createRecord({ title: title || fallbackTitle, filePath, fallbackTitle });
      const opened = openCoordinator.activateNew(record, { content: String(content ?? ''), chunks: null, loaded: null }, operation, {
        index: 0,
        reason: 'new'
      });
      return frozenResult(operation, { created: true, record: opened.record });
    } catch (error) {
      return rollbackRuntimeOnFailure(operation, error);
    }
  };

  const openExternalDocument = async ({
    title,
    filePath = '',
    loadContent,
    currentTitle,
    fallbackTitle = '未命名文档',
    expectedTextLength = null
  } = {}) => {
    if (typeof loadContent !== 'function') throw new TypeError('External document open requires a content loader.');
    const operation = beginOperation('import');
    try {
      await saveActive({ operation, title: currentTitle, fallbackTitle, snapshotReason: 'document-import' });
      assertCurrent(operation);
      const content = String(await loadContent() ?? '');
      assertCurrent(operation);
      const expectedLengthValue = typeof expectedTextLength === 'function'
        ? expectedTextLength(content)
        : expectedTextLength;
      const expectedLength = Number(expectedLengthValue);
      const record = createRecord({ title: title || fallbackTitle, filePath, fallbackTitle });
      const opened = openCoordinator.activateNew(record, { content, chunks: null, loaded: null }, operation, {
        index: 0,
        reason: 'import',
        persistLegacySnapshot: true,
        validate: () => {
          if (Number.isFinite(expectedLength) && model.getTextLength() !== expectedLength) {
            throw new Error(`导入文档长度校验失败：期望 ${expectedLength}，实际 ${model.getTextLength()}`);
          }
          if (model.documentId && model.documentId !== record.id) {
            throw new Error('导入文档状态未正确激活');
          }
        }
      });
      return frozenResult(operation, {
        opened: true,
        record: opened.record,
        sourceCharacters: content.length,
        editorCharacters: model.getTextLength()
      });
    } catch (error) {
      return rollbackRuntimeOnFailure(operation, error);
    }
  };

  const duplicateDocument = async (documentId, {
    currentTitle,
    fallbackTitle = '未命名文档',
    copySuffix = ' 副本.md'
  } = {}) => {
    const operation = beginOperation('duplicate');
    try {
      await saveActive({ operation, title: currentTitle, fallbackTitle, snapshotReason: 'document-duplicate' });
      assertCurrent(operation);
      const source = session.getRecord(documentId) || session.getActiveRecord();
      if (!source) return frozenResult(operation, { duplicated: false, record: null });

      let content;
      if (source.id === session.activeId) {
        content = model.createSnapshot('duplicate-document');
      } else {
        const restored = await repository.load(source, { isolated: true });
        assertCurrent(operation);
        content = repository.materializeLoadedContent(restored);
      }
      const baseName = source.title.replace(/\.(md|markdown|txt)$/i, '');
      const record = createRecord({ title: baseName + copySuffix, fallbackTitle });
      const sourceIndex = session.records.findIndex(item => item.id === source.id);
      const opened = openCoordinator.activateNew(record, { content, chunks: null, loaded: null }, operation, {
        index: sourceIndex >= 0 ? sourceIndex + 1 : session.records.length,
        reason: 'duplicate'
      });
      return frozenResult(operation, { duplicated: true, record: opened.record });
    } catch (error) {
      return rollbackRuntimeOnFailure(operation, error);
    }
  };

  const renameDocument = (documentId, title, options = {}) => {
    const operation = beginOperation('rename');
    const renamed = titleController.rename(documentId, title, options);
    assertCurrent(operation);
    return frozenResult(operation, { renamed: Boolean(renamed), ...(renamed || {}) });
  };

  const updateActiveTitleDraft = title => {
    const operation = beginOperation('title-draft');
    const record = session.getActiveRecord();
    if (record && String(model.documentId || '') === record.id) model.updateTitle(String(title ?? ''));
    return frozenResult(operation, { record, title: String(title ?? '') });
  };

  const bindDocumentFilePath = (documentId, filePath, options = {}) => {
    const operation = beginOperation('bind-file-path');
    const bound = titleController.bindFilePath(documentId, filePath, options);
    assertCurrent(operation);
    return frozenResult(operation, { bound: Boolean(bound), ...(bound || {}) });
  };

  const closeDocument = async (documentId, {
    currentTitle,
    fallbackTitle = '未命名文档',
    persistDirty = true
  } = {}) => {
    const operation = beginOperation('close');
    try {
      const id = String(documentId || '');
      if (session.activeId === id && persistDirty && model.dirty) {
        await saveActive({ operation, title: currentTitle, fallbackTitle, snapshotReason: 'document-close' });
        assertCurrent(operation);
      }
      const closed = await closeCoordinator.close(id, operation);
      return frozenResult(operation, closed);
    } catch (error) {
      return rollbackRuntimeOnFailure(operation, error);
    }
  };

  const readDocumentContent = async documentId => {
    const operation = captureOperation('read');
    assertCurrent(operation);
    const record = session.getRecord(documentId);
    if (!record) return frozenResult(operation, { record: null, content: '' });
    if (record.id === session.activeId && String(model.documentId || '') === record.id) {
      return frozenResult(operation, { record, content: model.createSnapshot('document-read') });
    }
    const restored = await repository.load(record, { isolated: true });
    assertCurrent(operation);
    return frozenResult(operation, { record, content: repository.materializeLoadedContent(restored), loaded: restored.loaded || null });
  };

  return Object.freeze({
    get generation() { assertActive(); return generation; },
    get records() { assertActive(); return session.records; },
    get activeId() { assertActive(); return session.activeId; },
    getActiveRecord() { assertActive(); return session.getActiveRecord(); },
    getRecord(documentId) { assertActive(); return session.getRecord(documentId); },
    getLegacySessionRecords() { assertActive(); return repository.readLegacySession(); },
    captureOperation,
    isCurrentGeneration,
    initializeEmptySession,
    ensureActiveForEditing,
    saveActive,
    openDocument,
    newDocument,
    openExternalDocument,
    duplicateDocument,
    renameDocument,
    updateActiveTitleDraft,
    bindDocumentFilePath,
    closeDocument,
    readDocumentContent,
    persistLegacyActiveSnapshot(options) { assertActive(); return repository.persistLegacyActiveSnapshot(options); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      repository.cancelPendingLoad?.();
      closeCoordinator.destroy();
      titleController.destroy();
      openCoordinator.destroy();
    }
  });
}
