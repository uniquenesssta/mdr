const PORT_KEY = 'markdownEditorPdfExportPort';

/** Scoped PDF command bridge; the public exporter owns preparation and printing. */
export function mountClassicPdfExportPort(host, exporter) {
  if (!host || typeof host !== 'object' || typeof exporter?.export !== 'function') throw new TypeError('PDF export host and exporter are required.');
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('PDF export port is already mounted.');
  let destroyed = false;
  const port = Object.freeze({ export(options) {
    if (destroyed) throw new Error('PDF export port has been destroyed.');
    return exporter.export(options);
  } });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({ port, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PORT_KEY] === port) delete host[PORT_KEY];
  } });
}
