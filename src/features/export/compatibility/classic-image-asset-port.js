const PORT_KEY = 'markdownEditorImageAssetPort';

/** A scoped image capability; unmount is independent of preloader ownership. */
export function mountClassicImageAssetPort(host, preloader) {
  if (!host || typeof host !== 'object' || typeof preloader?.prepare !== 'function'
    || typeof preloader.placeholder !== 'string') throw new TypeError('Image asset host and preloader are required.');
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Image asset port is already mounted.');
  let destroyed = false;
  const port = Object.freeze({ placeholder: preloader.placeholder, prepare(input) {
    if (destroyed) throw new Error('Image asset port is destroyed.');
    return preloader.prepare(input);
  } });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({ port, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PORT_KEY] === port) delete host[PORT_KEY];
  } });
}
