/**
 * Responsibility: Define the application CloseSavePort used by Window close orchestration.
 * Imports: None.
 * Exports: createCloseSavePort().
 * State/side effects: Owns exactly one registered close-save handler; owns no document or window state.
 * Lifecycle: Registration disposer and destroy are idempotent; destroy is terminal.
 */

export function createCloseSavePort() {
  let handler = null;
  let destroyed = false;

  function assertActive() {
    if (destroyed) throw new Error('CloseSavePort is destroyed.');
  }

  const port = {
    get registered() {
      assertActive();
      return handler !== null;
    },
    register(nextHandler) {
      assertActive();
      if (typeof nextHandler !== 'function') throw new TypeError('CloseSavePort handler must be a function.');
      if (handler) throw new Error('CloseSavePort handler is already registered.');
      handler = nextHandler;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        if (handler === nextHandler) handler = null;
      };
    },
    async prepareClose() {
      assertActive();
      if (!handler) throw new Error('CloseSavePort handler is unavailable.');
      const result = await handler();
      if (typeof result !== 'boolean') {
        throw new TypeError('CloseSavePort handler must resolve to a boolean.');
      }
      return result;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      handler = null;
    }
  };
  return Object.freeze(port);
}
