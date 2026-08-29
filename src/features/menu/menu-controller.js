/**
 * Responsibility: Orchestrate Menu command activation from selector state through command bindings.
 * Imports: None; Menu State, View and command bindings are injected and business functions are forbidden.
 * Exports: createMenuController().
 * State/side effects: Owns Menu View subscription/start lifecycle and command error reporting only.
 * Lifecycle: Explicit idempotent start/destroy; destroy prevents future command dispatch.
 */
export function createMenuController({ state, bindings, view, closeMenus = () => {}, reportError = () => {} }) {
  if (!state || typeof state.isEnabled !== 'function' || typeof state.isVisible !== 'function' || typeof state.subscribe !== 'function') {
    throw new TypeError('MenuController requires MenuState.');
  }
  if (!bindings || typeof bindings.execute !== 'function') throw new TypeError('MenuController requires MenuCommandBindings.');
  if (!view || typeof view.bindDeclaration !== 'function' || typeof view.setCommandState !== 'function' || typeof view.start !== 'function') {
    throw new TypeError('MenuController requires MenuView.');
  }
  if (typeof closeMenus !== 'function' || typeof reportError !== 'function') throw new TypeError('MenuController callbacks must be functions.');

  let destroyed = false;
  let started = false;
  let unsubscribe = null;

  const assertActive = () => {
    if (destroyed) throw new Error('MenuController is destroyed.');
  };

  function projectState() {
    for (const item of state.declaration) {
      view.setCommandState(item.commandId, {
        enabled: state.isEnabled(item.commandId),
        visible: state.isVisible(item.commandId)
      });
    }
  }

  function report(commandId, error) {
    try { reportError(`Menu command failed: ${commandId}.`, error); }
    catch (reportErrorFailure) { console.error('Menu command error reporter failed:', reportErrorFailure, error); }
  }

  function execute(commandId, payload) {
    assertActive();
    const id = String(commandId || '');
    if (!state.isVisible(id) || !state.isEnabled(id)) return false;
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
  }

  return Object.freeze({
    execute,
    start() {
      assertActive();
      if (started) return false;
      view.bindDeclaration(state.declaration);
      projectState();
      unsubscribe = state.subscribe(() => projectState());
      view.start(({ commandId, event, element }) => execute(commandId, Object.freeze({ event, element })));
      started = true;
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const dispose = unsubscribe;
      unsubscribe = null;
      try { dispose?.(); } finally { view.destroy?.(); }
      started = false;
    }
  });
}
