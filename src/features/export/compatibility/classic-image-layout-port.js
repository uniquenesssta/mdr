const PORT_KEY = 'markdownEditorImageLayoutPort';

/** Scoped layout capability. Unmount does not destroy the owner or its active leases. */
export function mountClassicImageLayoutPort(host, layout) {
  if (!host || typeof host !== 'object' || typeof layout?.mount !== 'function') throw new TypeError('Image layout host and owner are required.');
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Image layout port is already mounted.');
  let destroyed = false;
  const port = Object.freeze({ mount(input) {
    if (destroyed) throw new Error('Image layout port is destroyed.');
    return layout.mount(input);
  } });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({ port, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PORT_KEY] === port) delete host[PORT_KEY];
  } });
}
