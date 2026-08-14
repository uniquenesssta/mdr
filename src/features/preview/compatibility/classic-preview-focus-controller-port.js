/**
 * Responsibility: Mount Preview Focus Controller on the scoped classic compatibility host during Stage 7 migration.
 * Imports: None.
 * Exports: mountClassicPreviewFocusControllerPort().
 * State/side effects: Owns only one host property; focus generations and scheduling remain owned by Preview Focus Controller.
 * Lifecycle: destroy() removes only the property mounted by this adapter.
 */
const PORT_KEY = 'markdownEditorPreviewFocusControllerPort';
const METHODS = Object.freeze(['connect', 'scheduleCursorFocus', 'focusLine', 'cancel']);

export function mountClassicPreviewFocusControllerPort(host, controller) {
  if (!host || typeof host !== 'object') throw new TypeError('Classic Preview Focus Controller Port requires a host.');
  if (!controller || typeof controller !== 'object') {
    throw new TypeError('Classic Preview Focus Controller Port requires Preview Focus Controller.');
  }
  if (host[PORT_KEY]) throw new Error('Classic Preview Focus Controller Port is already mounted.');
  for (const method of METHODS) {
    if (typeof controller[method] !== 'function') {
      throw new TypeError(`Classic Preview Focus Controller Port requires controller.${method}().`);
    }
  }

  let destroyed = false;
  const port = Object.freeze(Object.fromEntries(METHODS.map(method => [
    method,
    (...args) => {
      if (destroyed) throw new Error('Classic Preview Focus Controller Port is destroyed.');
      return controller[method](...args);
    }
  ])));
  host[PORT_KEY] = port;

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_KEY] === port) delete host[PORT_KEY];
    }
  });
}
