const PORT_KEY = 'markdownEditorExportStylePort';

/** Scoped style capability; unmounting the bridge never destroys its owner. */
export function mountClassicExportStylePort(host, styles) {
  if (!host || typeof host !== 'object' || typeof styles?.getCss !== 'function' || typeof styles?.apply !== 'function') throw new TypeError('Export stylesheet host and owner are required.');
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Export style port is already mounted.');
  let destroyed = false;
  const port = Object.freeze({
    getCss(format) { if (destroyed) throw new Error('Export style port is destroyed.'); return styles.getCss(format); },
    apply(root, format) { if (destroyed) throw new Error('Export style port is destroyed.'); return styles.apply(root, format); }
  });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({ port, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PORT_KEY] === port) delete host[PORT_KEY];
  } });
}
