const PORT_KEY = 'markdownEditorExportEnhancementPort';

/** Scoped complete-body enhancement capability; state and lifecycle remain with its Export owner. */
export function mountClassicExportEnhancementPort(host, enhancer) {
  if (!host || typeof host !== 'object' || typeof enhancer?.enhance !== 'function') throw new TypeError('Export enhancer host and owner are required.');
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Export enhancement port is already mounted.');
  let destroyed = false;
  const port = Object.freeze({ enhance(options) {
    if (destroyed) throw new Error('Export enhancement port is destroyed.');
    return enhancer.enhance(options);
  } });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({ port, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PORT_KEY] === port) delete host[PORT_KEY];
  } });
}
