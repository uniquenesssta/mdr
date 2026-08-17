
/**
 * Responsibility: Temporary scoped Stage 10 bridge exposing SaveController commands to classic manual-save callers until Atomic 10.12 removes those callers.
 * Imports: None; the SaveController instance is injected and no status/model/session/platform state is copied here.
 * Exports: mountClassicSaveControllerPort().
 * State/side effects: Owns only one non-enumerable compatibility-host property and terminal bridge lifecycle.
 * Lifecycle: destroy() is idempotent, removes the host property and never destroys the injected SaveController.
 */
const PORT_PROPERTY = 'markdownEditorSaveControllerPort';

export function mountClassicSaveControllerPort(target, controller) {
  if (!target || typeof target !== 'object') throw new TypeError('Classic Save Controller port target must be an object.');
  if (!controller || typeof controller.save !== 'function') throw new TypeError('Classic Save Controller port requires a Save Controller.');
  if (Object.hasOwn(target, PORT_PROPERTY)) throw new Error('Classic Save Controller port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Classic Save Controller port is destroyed.');
  };

  const api = Object.freeze({
    save(options) {
      assertActive();
      return controller.save(options);
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
