const PORT_KEY = 'markdownEditorHtmlExportPort';

/** Temporary scoped command bridge; HTML owns tasks, serialization and output. */
export function mountClassicHtmlExportPort(host, exporter) {
  if (!host || typeof host !== 'object' || typeof exporter?.export !== 'function') throw new TypeError('HTML export host and exporter are required.');
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('HTML export port is already mounted.');
  let destroyed = false;
  const port = Object.freeze({ export(options) {
    if (destroyed) throw new Error('HTML export port has been destroyed.');
    return exporter.export(options);
  } });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({ port, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PORT_KEY] === port) delete host[PORT_KEY];
  } });
}
