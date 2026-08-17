/**
 * Responsibility: Temporary scoped Stage 10 bridge exposing AutosaveController scheduling/cancellation to remaining classic callers until Atomic 10.12 removes those callers.
 * Imports: None; the AutosaveController instance is injected and no timer/settings/save state is copied here.
 * Exports: mountClassicAutosaveControllerPort().
 * State/side effects: Owns only one non-enumerable compatibility-host property and terminal bridge lifecycle.
 * Lifecycle: destroy() is idempotent, removes the host property and never destroys the injected AutosaveController.
 */
const PORT_PROPERTY = 'markdownEditorAutosaveControllerPort';

export function mountClassicAutosaveControllerPort(target, controller) {
  if (!target || typeof target !== 'object') throw new TypeError('Classic Autosave Controller port target must be an object.');
  if (!controller || typeof controller.schedule !== 'function' || typeof controller.cancelPending !== 'function') {
    throw new TypeError('Classic Autosave Controller port requires an Autosave Controller.');
  }
  if (Object.hasOwn(target, PORT_PROPERTY)) throw new Error('Classic Autosave Controller port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Classic Autosave Controller port is destroyed.');
  };

  const api = Object.freeze({
    schedule(options) {
      assertActive();
      return controller.schedule(options);
    },
    cancelPending(reason) {
      assertActive();
      return controller.cancelPending(reason);
    }
  });

  Object.defineProperty(target, PORT_PROPERTY, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api
  });

  return Object.freeze({
    api,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (target[PORT_PROPERTY] === api) delete target[PORT_PROPERTY];
      if (typeof target.removeAttribute === 'function') target.removeAttribute(PORT_PROPERTY);
    }
  });
}
