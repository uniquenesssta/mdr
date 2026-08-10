/**
 * Responsibility: Provide the Stage 5.9 application history boundary by delegating undo, redo and history isolation to the injected neutral editor adapter.
 * Imports: None; receives the neutral EditorAdapter contract by dependency injection and must not import CodeMirror, document, UI or persistence internals.
 * Exports: createEditorHistoryAdapter.
 * State/side effects: Owns only terminal lifecycle state; document text and transaction history remain solely owned by CodeMirror through the injected adapter.
 * Lifecycle: Explicit instance lifecycle; destroy() is idempotent and makes later history operations terminal without destroying the injected adapter.
 */
function assertHistoryAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('Editor History Adapter requires an editor adapter.');
  for (const method of ['undo', 'redo', 'isolateHistory']) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`Editor History Adapter requires adapter.${method}().`);
    }
  }
}

export function createEditorHistoryAdapter({ adapter } = {}) {
  assertHistoryAdapter(adapter);
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Editor History Adapter has been destroyed.');
  };
  const call = method => (...args) => {
    assertActive();
    return adapter[method](...args);
  };

  return Object.freeze({
    undo: call('undo'),
    redo: call('redo'),
    isolate: call('isolateHistory'),
    destroy() {
      if (destroyed) return;
      destroyed = true;
    }
  });
}
