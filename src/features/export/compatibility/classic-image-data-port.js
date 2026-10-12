const PORT_KEY = 'markdownEditorImageDataPort';

/** Read-only byte conversion capability; owns only its terminal mount lifetime. */
export function mountClassicImageDataPort(host, encode) {
  if (!host || typeof host !== 'object' || typeof encode !== 'function') throw new TypeError('Image data host and encoder are required.');
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Image data port is already mounted.');
  let destroyed = false;
  const port = Object.freeze({ encode(dataUrl) {
    if (destroyed) throw new Error('Image data port is destroyed.');
    return encode(dataUrl);
  } });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({ port, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PORT_KEY] === port) delete host[PORT_KEY];
  } });
}
