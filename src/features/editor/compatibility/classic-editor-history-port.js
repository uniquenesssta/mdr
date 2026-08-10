/**
 * Responsibility: Expose the Stage 5.9 Editor History Adapter to remaining classic editing callers through the scoped compatibility host.
 * Imports: None; receives the application History Adapter by dependency injection and must not access CodeMirror or document state directly.
 * Exports: mountClassicEditorHistoryPort.
 * State/side effects: Owns one compatibility-host property lifecycle only; it does not own document text or history entries.
 * Lifecycle: Explicit instance lifecycle; destroy() removes only its own host property and is idempotent and terminal.
 */
const PORT_NAME = 'markdownEditorEditorHistoryPort';

export function mountClassicEditorHistoryPort(host, historyAdapter) {
  if (!host || typeof host !== 'object') throw new TypeError('Editor History compatibility host is required.');
  if (!historyAdapter || typeof historyAdapter.undo !== 'function' || typeof historyAdapter.redo !== 'function' || typeof historyAdapter.isolate !== 'function') {
    throw new TypeError('Editor History Adapter is required.');
  }
  if (host[PORT_NAME]) throw new Error('Editor History compatibility port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Editor History compatibility port has been destroyed.');
  };
  const call = method => (...args) => {
    assertActive();
    return historyAdapter[method](...args);
  };

  const api = Object.freeze({
    undo: call('undo'),
    redo: call('redo'),
    isolate: call('isolate'),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_NAME] === api) delete host[PORT_NAME];
    }
  });

  host[PORT_NAME] = api;
  return api;
}
