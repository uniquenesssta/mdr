/**
 * Responsibility: Expose the canonical SubmenuPositioner close operation to the remaining classic top-level menu close path.
 * Imports: None; geometry, timers, Menu Model and Recent Files data are forbidden.
 * Exports: mountClassicSubmenuPositionerPort().
 * State/side effects: Owns only one scoped compatibility-host property.
 * Lifecycle: Explicit destroy removes only the exact port instance it mounted.
 */

const PORT_NAME = 'markdownEditorSubmenuPositionerPort';

export function mountClassicSubmenuPositionerPort(host, positioner) {
  if (!host || typeof host !== 'object') throw new TypeError('Classic Submenu Positioner port requires a compatibility host.');
  if (!positioner || typeof positioner.closeAll !== 'function') throw new TypeError('Classic Submenu Positioner port requires SubmenuPositioner.');
  if (host[PORT_NAME]) throw new Error('Classic Submenu Positioner port is already mounted.');

  let destroyed = false;
  const api = Object.freeze({
    closeAll() {
      if (destroyed) throw new Error('Classic Submenu Positioner port is destroyed.');
      return positioner.closeAll();
    }
  });
  host[PORT_NAME] = api;

  return Object.freeze({
    api,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_NAME] === api) delete host[PORT_NAME];
    }
  });
}
