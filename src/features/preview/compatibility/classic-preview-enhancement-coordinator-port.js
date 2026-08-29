/**
 * Responsibility: Mount Preview Enhancement Coordinator on the scoped classic compatibility host during Stage 7 migration.
 * Imports: None.
 * Exports: mountClassicPreviewEnhancementCoordinatorPort().
 * State/side effects: Owns only one host property; scheduling, generations and enhancement work remain owned by the coordinator.
 * Lifecycle: destroy() removes only the property mounted by this adapter.
 */
const PORT_KEY = 'markdownEditorPreviewEnhancementCoordinatorPort';
const METHODS = Object.freeze([
  'connect',
  'begin',
  'setPriorityRange',
  'enqueue',
  'schedulePostprocess',
  'cancel',
  'getStats'
]);

export function mountClassicPreviewEnhancementCoordinatorPort(host, coordinator) {
  if (!host || typeof host !== 'object') throw new TypeError('Classic Preview Enhancement Coordinator Port requires a host.');
  if (!coordinator || typeof coordinator !== 'object') {
    throw new TypeError('Classic Preview Enhancement Coordinator Port requires Preview Enhancement Coordinator.');
  }
  if (host[PORT_KEY]) throw new Error('Classic Preview Enhancement Coordinator Port is already mounted.');
  for (const method of METHODS) {
    if (typeof coordinator[method] !== 'function') {
      throw new TypeError(`Classic Preview Enhancement Coordinator Port requires coordinator.${method}().`);
    }
  }

  let destroyed = false;
  const port = Object.freeze(Object.fromEntries(METHODS.map(method => [
    method,
    (...args) => {
      if (destroyed) throw new Error('Classic Preview Enhancement Coordinator Port is destroyed.');
      return coordinator[method](...args);
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
