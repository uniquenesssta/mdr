/**
 * Responsibility: Atomically activate newly created/imported document bodies before committing Documents Session state.
 * State/side effects: No independent state; mutates only the injected model, session store and persistence port after generation validation. Persisted existing-document loads belong to Persistence LoadController.
 */

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
    activateNew,
    destroy() {
      if (destroyed) return;
      destroyed = true;
    }
  });
}
