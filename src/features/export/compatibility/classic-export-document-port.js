const PORT_KEY = 'markdownEditorExportDocumentPort';

/** Scoped build capability only; lifecycle and all construction remain with Document Builder. */
export function mountClassicExportDocumentPort(host, builder) {
  if (!host || typeof host !== 'object' || typeof builder?.build !== 'function' || typeof builder?.getSourceContext !== 'function') {
    throw new TypeError('Export document host and builder are required.');
  }
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Export document port is already mounted.');
  let destroyed = false;
  const port = Object.freeze({
    build(options) {
      if (destroyed) throw new Error('Export document port is destroyed.');
      return builder.build(options);
    },
    getSourceContext(body) {
      if (destroyed) throw new Error('Export document port is destroyed.');
      return builder.getSourceContext(body);
    }
  });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({ port, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PORT_KEY] === port) delete host[PORT_KEY];
  } });
}
