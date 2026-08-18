/**
 * Responsibility: Close one session document and, when needed, commit the deterministic neighbour after Persistence LoadController prepares its body/runtime activation.
 * State/side effects: No independent document/load state; owns only close orchestration around the injected Documents session, model, repository cleanup and LoadController.
 */

export function createDocumentCloseCoordinator({ session, model, repository, loadController, assertCurrent } = {}) {
  if (!session || typeof session.removeRecord !== 'function' || typeof session.getRecord !== 'function') {
    throw new TypeError('Document close coordinator requires a document session store.');
  }
  if (!model || typeof model.activate !== 'function') {
    throw new TypeError('Document close coordinator requires the frozen DocumentModel.');
  }
  if (!repository || typeof repository.remove !== 'function' || typeof repository.persistSession !== 'function') {
    throw new TypeError('Document close coordinator requires a session document repository.');
  }
  if (!loadController || typeof loadController.loadExisting !== 'function') {
    throw new TypeError('Document close coordinator requires the Persistence LoadController.');
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
      const activated = await loadController.loadExisting(next.id, operation, {
        commitActive: false,
        commitMetadata: false,
        persist: false,
        reason: 'close-next'
      });
      assertCurrent(operation);
      activatedNext = activated.record;
      nextLoaded = activated.loaded || null;
      nextMetadataPatch = activated.metadataPatch || null;
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
