/**
 * Responsibility: Bridge the frozen DocumentModel and neutral editor adapter so committed editor changes become one application transaction stream.
 * State/side effects: Owns transaction listeners and adapter subscription lifecycle only; document body/version authority remains in DocumentModel.
 */
function freezeChanges(changes) {
  return Object.freeze(Array.from(changes || []).map(change => Object.freeze({
    from: Math.max(0, Number(change?.from) || 0),
    to: Math.max(0, Number(change?.to) || 0),
    insert: String(change?.insert ?? '')
  })));
}

function freezeState(state) {
  return Object.freeze({ ...(state || {}) });
}

export function createEditorController({ model, adapter, reportError = (message, error) => console.error(message, error) } = {}) {
  if (!model || typeof model.getDocumentVersion !== 'function' || typeof model.getState !== 'function'
    || typeof model.getTextLength !== 'function' || typeof model.replaceRange !== 'function') {
    throw new TypeError('Editor Controller requires a DocumentModel contract.');
  }
  if (!adapter || typeof adapter.getDocumentVersion !== 'function' || typeof adapter.subscribeDocumentChanges !== 'function') {
    throw new TypeError('Editor Controller requires a document-change adapter contract.');
  }
  if (typeof reportError !== 'function') throw new TypeError('Editor Controller reportError must be a function.');
  if (Number(model.getDocumentVersion()) !== Number(adapter.getDocumentVersion())) {
    throw new Error('Editor Controller requires Model and adapter versions to be synchronized at construction.');
  }

  const listeners = new Set();
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Editor Controller has been destroyed.');
  };

  const report = (message, error) => {
    try {
      reportError(message, error);
    } catch (reportingError) {
      console.error(message, error, reportingError);
    }
  };

  const publishTransaction = entry => {
    if (destroyed || !entry) return;
    const entryVersion = Math.max(0, Number(entry.version) || 0);
    const modelVersion = Math.max(0, Number(model.getDocumentVersion()) || 0);
    if (entryVersion !== modelVersion) {
      const error = new Error('Editor transaction version mismatch: adapter=' + entryVersion + ', model=' + modelVersion);
      error.code = 'EDITOR_TRANSACTION_VERSION_MISMATCH';
      report('Editor Controller rejected an out-of-sync transaction.', error);
      return;
    }

    const state = model.getState();
    const transaction = Object.freeze({
      type: 'transaction',
      documentId: String(state.documentId || ''),
      generation: Math.max(0, Number(state.generation) || 0),
      version: modelVersion,
      changes: freezeChanges(entry.changes),
      length: Math.max(0, Number(state.length) || 0),
      lines: Math.max(1, Number(state.lines) || 1),
      nonWhitespaceCount: Math.max(0, Number(model.getNonWhitespaceCount?.() ?? entry.nonWhitespaceCount) || 0),
      interactive: entry.suppressed !== true
    });

    for (const listener of listeners) {
      try {
        listener(transaction);
      } catch (error) {
        report('Editor Controller transaction listener failed.', error);
      }
    }
  };

  const unsubscribeAdapter = adapter.subscribeDocumentChanges(publishTransaction);

  return Object.freeze({
    get state() {
      assertActive();
      return freezeState(model.getState());
    },
    subscribeTransactions(listener) {
      assertActive();
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    setText(value) {
      assertActive();
      model.replaceRange(String(value ?? ''), 0, model.getTextLength(), 'end');
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeAdapter?.();
      listeners.clear();
    }
  });
}
