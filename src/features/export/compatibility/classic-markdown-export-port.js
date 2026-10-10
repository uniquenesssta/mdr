const PORT_KEY = 'markdownEditorMarkdownExportPort';

/** Scoped command bridge; raw content, tasks and I/O remain owned by Markdown Exporter. */
export function mountClassicMarkdownExportPort(host, exporter) {
  if (!host || typeof host !== 'object' || typeof exporter?.export !== 'function') {
    throw new TypeError('Markdown export host and exporter are required.');
  }
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Markdown export port is already mounted.');
  let destroyed = false;
  const port = Object.freeze({
    export(options) {
      if (destroyed) throw new Error('Markdown export port has been destroyed.');
      return exporter.export(options);
    }
  });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({
    port,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_KEY] === port) delete host[PORT_KEY];
    }
  });
}
