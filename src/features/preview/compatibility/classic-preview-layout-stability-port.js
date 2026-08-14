/**
 * Responsibility: Mount Preview Layout Stability on the scoped classic compatibility host during Stage 7 migration.
 * Imports: None.
 * Exports: mountClassicPreviewLayoutStabilityPort().
 * State/side effects: Owns only one host property; stability state, observer and scheduling remain owned by Preview Layout Stability.
 * Lifecycle: destroy() removes only the property mounted by this adapter.
 */
const PORT_KEY = 'markdownEditorPreviewLayoutStabilityPort';
const METHODS = Object.freeze(['connect', 'start', 'requestRefresh', 'cancel']);

export function mountClassicPreviewLayoutStabilityPort(host, stability) {
  if (!host || typeof host !== 'object') throw new TypeError('Classic Preview Layout Stability Port requires a host.');
  if (!stability || typeof stability !== 'object') {
    throw new TypeError('Classic Preview Layout Stability Port requires Preview Layout Stability.');
  }
  if (host[PORT_KEY]) throw new Error('Classic Preview Layout Stability Port is already mounted.');
  for (const method of METHODS) {
    if (typeof stability[method] !== 'function') {
      throw new TypeError(`Classic Preview Layout Stability Port requires stability.${method}().`);
    }
  }

  let destroyed = false;
  const port = Object.freeze(Object.fromEntries(METHODS.map(method => [
    method,
    (...args) => {
      if (destroyed) throw new Error('Classic Preview Layout Stability Port is destroyed.');
      return stability[method](...args);
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
