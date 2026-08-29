/**
 * Responsibility: Expose MenuCommandBindings execution to staged runtime modules through one scoped compatibility host property.
 * Imports: None; business state, Documents data, DOM rendering and persistence are forbidden.
 * Exports: mountClassicMenuCommandPort().
 * State/side effects: Owns only one host property lifecycle and command error/close orchestration.
 * Lifecycle: Explicit idempotent destroy; never destroys the injected bindings.
 */
const PORT_NAME = 'markdownEditorMenuCommandPort';

export function mountClassicMenuCommandPort(host, bindings, {
  closeMenus = () => {},
  reportError = (message, error) => console.error(message, error)
} = {}) {
  if (!host || typeof host !== 'object') throw new TypeError('Menu command compatibility host is required.');
  if (!bindings || typeof bindings.execute !== 'function' || typeof bindings.has !== 'function') {
    throw new TypeError('Menu command compatibility port requires MenuCommandBindings.');
  }
  if (typeof closeMenus !== 'function' || typeof reportError !== 'function') {
    throw new TypeError('Menu command compatibility callbacks must be functions.');
  }
  if (host[PORT_NAME]) throw new Error('Menu command compatibility port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Menu command compatibility port has been destroyed.');
  };
  const report = (commandId, error) => {
    try { reportError(`Menu command failed: ${commandId}.`, error); }
    catch (reportingError) { console.error('Menu command error reporter failed:', reportingError, error); }
  };

  const api = Object.freeze({
    has(commandId) {
      assertActive();
      return bindings.has(commandId);
    },
    execute(commandId, payload) {
      assertActive();
      const id = String(commandId || '');
      let execution;
      try {
        execution = bindings.execute(id, payload);
      } catch (error) {
        report(id, error);
        return false;
      }
      if (execution.closeMenu) {
        try { closeMenus(); } catch (error) { report(id, error); }
      }
      if (execution.result && typeof execution.result.then === 'function') {
        execution.result.catch(error => report(id, error));
      }
      return execution.result;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_NAME] === api) delete host[PORT_NAME];
    }
  });

  host[PORT_NAME] = api;
  return api;
}
