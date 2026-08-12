/**
 * Responsibility: Expose only CloseSavePort handler registration to remaining classic application code.
 * Imports: None.
 * Exports: mountClassicCloseSavePort().
 * State/side effects: Owns one host property and the registration disposer it creates.
 * Lifecycle: Explicit terminal destroy removes only its own host property and registration.
 */

const PROPERTY = 'markdownEditorCloseSavePort';

export function mountClassicCloseSavePort(host, closeSavePort) {
  if (!host || typeof host !== 'object') throw new TypeError('Classic CloseSavePort host is required.');
  if (!closeSavePort || typeof closeSavePort.register !== 'function') {
    throw new TypeError('Classic CloseSavePort requires register().');
  }
  if (Object.hasOwn(host, PROPERTY)) throw new Error('Classic CloseSavePort is already mounted.');

  let destroyed = false;
  let unregister = null;
  const exposed = Object.freeze({
    register(handler) {
      if (destroyed) throw new Error('Classic CloseSavePort is destroyed.');
      if (unregister) throw new Error('Classic CloseSavePort handler is already registered.');
      unregister = closeSavePort.register(handler);
      return true;
    }
  });
  host[PROPERTY] = exposed;

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unregister?.();
      unregister = null;
      if (host[PROPERTY] === exposed) delete host[PROPERTY];
    }
  });
}
