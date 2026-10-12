const PORT_KEY = 'markdownEditorImageExportPort';

/** Scoped read-only command/cache capability; all image workflow state stays in the exporter. */
export function mountClassicImageExportPort(host, exporter) {
  if (!host || typeof host !== 'object' || !['render','save','getPreview'].every(key => typeof exporter?.[key] === 'function')) throw new TypeError('Image exporter and host are required.');
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Image export port is already mounted.');
  let destroyed = false;
  const alive = () => { if (destroyed) throw new Error('Image export port is destroyed.'); };
  const port = Object.freeze({ render(options) { alive(); return exporter.render(options); },
    save(options) { alive(); return exporter.save(options); }, getPreview() { alive(); return exporter.getPreview(); } });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({ port, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PORT_KEY] === port) delete host[PORT_KEY];
  } });
}
