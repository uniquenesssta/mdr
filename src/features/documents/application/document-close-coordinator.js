/**
 * Responsibility: Close one session document and, when needed, activate the deterministic neighbour without exposing an async half-switched session.
 * State/side effects: No independent document state; coordinates the injected model/session/repository and validates lifecycle generation around async load.
 */

export function createDocumentCloseCoordinator({ session, model, repository, openCoordinator, assertCurrent } = {}) {
  if (!session || typeof session.removeRecord !== 'function' || typeof session.getRecord !== 'function') {
    throw new TypeError('Document close coordinator requires a document session store.');
  }
  if (!model || typeof model.activate !== 'function') {
    throw new TypeError('Document close coordinator requires the frozen DocumentModel.');
  }
  if (!repository || typeof repository.load !== 'function' || typeof repository.remove !== 'function') {
    throw new TypeError('Document close coordinator requires a session document repository.');
  }
  if (!openCoordinator || typeof openCoordinator.activateLoaded !== 'function') {
    throw new TypeError('Document close coordinator requires the document open coordinator.');
  }
  if (typeof assertCurrent !== 'function') {
    throw new TypeError('Document close coordinator requires a generation validator.');
  }

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Document close coordinator has been destroyed.');
  };

  const close = async (documentId, operation) => {
    assertActive();
    assertCurrent(operation);
    const id = String(documentId || '');
    const record = session.getRecord(id);
    if (!record) return Object.freeze({ closed: false, record: null, activeRecord: session.getActiveRecord() });

    const records = session.records;
    const closingActive = session.activeId === id;
    const index = records.findIndex(item => item.id === id);
    const remaining = records.filter(item => item.id !== id);
    const next = closingActive
      ? remaining[Math.max(0, Math.min(index, remaining.length - 1))] || null
      : session.getActiveRecord();

    let activatedNext = next;
    let nextLoaded = null;
    let nextMetadataPatch = null;
    if (closingActive && next) {
      const restored = await repository.load(next);
      nextLoaded = restored.loaded || null;
      assertCurrent(operation);
      const activated = openCoordinator.activateLoaded(next, restored, operation, {
        commitActive: false,
        commitMetadata: false,
        persist: false,
        reason: 'close-next'
      });
      activatedNext = activated.record;
      nextMetadataPatch = restored.metadataPatch || null;
    } else if (closingActive) {
      assertCurrent(operation);
      model.activate(null, { content: '' });
      assertCurrent(operation);
    }

    assertCurrent(operation);
    session.removeRecord(id, {
      ...(closingActive ? { activeId: activatedNext?.id || null } : {}),
      reason: 'close'
    });
    if (closingActive && nextMetadataPatch && activatedNext?.id) {
      activatedNext = session.updateRecord(activatedNext.id, nextMetadataPatch, {
        fallbackTitle: activatedNext.title || '未命名文档',
        reason: 'native-loaded'
      });
    }
    repository.forgetContent(id);
    repository.persistSession(session.records, session.activeId);
    if (closingActive) {
      if (activatedNext) repository.persistLegacyActiveTitle(activatedNext.title || '');
      else repository.clearLegacyActiveSnapshot();
    }

    // Backend deletion is cleanup for the already committed close. It must finish even if a later lifecycle operation starts.
    await repository.remove(id);
    return Object.freeze({
      closed: true,
      record,
      closingActive,
      activeRecord: closingActive ? activatedNext : session.getActiveRecord(),
      loaded: closingActive ? nextLoaded : null
    });
  };

  return Object.freeze({
    close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
    }
  });
}
