/**
 * Responsibility: Mount Preview Recovery View on the scoped classic compatibility host during Stage 7 migration.
 * Imports: None.
 * Exports: mountClassicPreviewRecoveryViewPort().
 * State/side effects: Owns only one compatibility-host property; recovery DOM remains owned by Preview Recovery View.
 * Lifecycle: destroy() removes only the property mounted by this adapter.
 */
const PORT_KEY = 'markdownEditorPreviewRecoveryViewPort';
const METHODS = Object.freeze(['inspect', 'recover', 'isRecoveryBody']);

export function mountClassicPreviewRecoveryViewPort(host, view) {
  if (!host || typeof host !== 'object') throw new TypeError('Classic Preview Recovery View Port requires a host.');
  if (!view || typeof view !== 'object') throw new TypeError('Classic Preview Recovery View Port requires Preview Recovery View.');
  if (host[PORT_KEY]) throw new Error('Classic Preview Recovery View Port is already mounted.');
  for (const method of METHODS) {
    if (typeof view[method] !== 'function') {
      throw new TypeError(`Classic Preview Recovery View Port requires view.${method}().`);
    }
  }

  let destroyed = false;
  const port = Object.freeze(Object.fromEntries(METHODS.map(method => [
    method,
    (...args) => {
      if (destroyed) throw new Error('Classic Preview Recovery View Port is destroyed.');
      return view[method](...args);
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
