/**
 * Responsibility: Coordinate document title/path metadata changes across Session Store, DocumentModel and session persistence.
 * State/side effects: No independent document state; writes only through injected authorities.
 */

export function createDocumentTitleController({ session, model, repository, now = Date.now } = {}) {
  if (!session || typeof session.updateRecord !== 'function') {
    throw new TypeError('Document title controller requires a document session store.');
  }
  if (!model || typeof model.updateTitle !== 'function') {
    throw new TypeError('Document title controller requires the frozen DocumentModel.');
  }
  if (!repository || typeof repository.persistSession !== 'function') {
    throw new TypeError('Document title controller requires a session document repository.');
  }
  if (typeof now !== 'function') throw new TypeError('Document title controller clock must be a function.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Document title controller has been destroyed.');
  };

  const rename = (documentId, title, { fallbackTitle = '未命名文档' } = {}) => {
    assertActive();
    const id = String(documentId || session.activeId || '');
    const record = session.getRecord(id);
    if (!record) return null;
    const updated = session.updateRecord(record.id, {
      title,
      updatedAt: now()
    }, { fallbackTitle, reason: 'rename' });
    if (updated.id === session.activeId) {
      model.updateTitle(updated.title);
      repository.persistLegacyActiveTitle(updated.title);
    }
    repository.persistSession(session.records, session.activeId);
    return Object.freeze({ record: updated, active: updated.id === session.activeId });
  };

  const bindFilePath = (documentId, filePath, { title = '', fallbackTitle = '未命名文档' } = {}) => {
    assertActive();
    const id = String(documentId || session.activeId || '');
    const record = session.getRecord(id);
    if (!record) return null;
    const patch = { filePath, updatedAt: now() };
    if (title) patch.title = title;
    const updated = session.updateRecord(record.id, patch, {
      fallbackTitle,
      reason: 'bind-file-path'
    });
    if (updated.id === session.activeId && title) {
      model.updateTitle(updated.title);
      repository.persistLegacyActiveTitle(updated.title);
    }
    repository.persistSession(session.records, session.activeId);
    return Object.freeze({ record: updated, active: updated.id === session.activeId });
  };

  return Object.freeze({
    rename,
    bindFilePath,
    destroy() {
      if (destroyed) return;
      destroyed = true;
    }
  });
}
