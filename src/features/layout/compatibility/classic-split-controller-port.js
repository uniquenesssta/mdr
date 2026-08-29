/**
 * Responsibility: Scoped migration bridge from remaining classic layout-mode callers to the authoritative Stage 6 Split controllers.
 * Imports: None; controllers are injected.
 * Exports: mountClassicSplitControllerPort().
 * State/side effects: Owns one non-enumerable compatibility-host property and no layout state/DOM behavior.
 * Lifecycle: Explicit destroy removes the scoped host property.
 */
const PORT_PROPERTY = 'markdownEditorSplitControllerPort';

export function mountClassicSplitControllerPort(target, { paneController, compactController } = {}) {
  if (!target || typeof target !== 'object') throw new TypeError('Classic Split Controller port target must be an object.');
  if (typeof paneController?.applyMode !== 'function') throw new TypeError('Classic Split Controller port requires SplitPaneController.');
  if (typeof compactController?.reconcile !== 'function') throw new TypeError('Classic Split Controller port requires CompactSplitController.');
  if (Object.hasOwn(target, PORT_PROPERTY)) throw new Error('Classic Split Controller port is already mounted.');
  let destroyed = false;
  const assertActive = () => { if (destroyed) throw new Error('Classic Split Controller port is destroyed.'); };
  const api = Object.freeze({
    applyMode(mode, options = {}) {
      assertActive();
      paneController.applyMode(mode, options);
      compactController.reconcile(mode, { resetPane: Boolean(options.resetCompactPane) });
    }
  });
  Object.defineProperty(target, PORT_PROPERTY, { configurable: true, enumerable: false, writable: false, value: api });
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
