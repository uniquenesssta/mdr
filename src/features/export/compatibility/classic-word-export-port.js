const PORT_KEY = 'markdownEditorWordExportPort';

/** Temporary scoped command bridge; Word owns tasks, serialization and output. */
export function mountClassicWordExportPort(host, exporter) {
  if (!host || typeof host !== 'object' || typeof exporter?.export !== 'function') throw new TypeError('Word export host and exporter are required.');
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Word export port is already mounted.');
  let destroyed = false;
  const port = Object.freeze({ export(options) {
    if (destroyed) throw new Error('Word export port has been destroyed.');
    return exporter.export(options);
  } });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({ port, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PORT_KEY] === port) delete host[PORT_KEY];
  } });
}
