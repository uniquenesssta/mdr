/** Scoped read-only File Import bridge for remaining classic callers; remove in 13.13/13.14. */
const PROPERTY = 'markdownEditorFileImportPort';
export function mountClassicFileImportPort(host, controller) {
  if (!host || typeof host !== 'object') throw new TypeError('File Import port requires a host.');
  if (!controller || typeof controller.readBrowserFile !== 'function' || typeof controller.readPath !== 'function') {
    throw new TypeError('File Import port requires a controller.');
  }
  if (Object.hasOwn(host, PROPERTY)) throw new Error('File Import port is already mounted.');
  let destroyed = false;
  const active = () => { if (destroyed) throw new Error('File Import port is destroyed.'); };
  const api = Object.freeze({
    readBrowserFile(file) { active(); return controller.readBrowserFile(file); },
    readPath(path) { active(); return controller.readPath(path); }
  });
  Object.defineProperty(host, PROPERTY, { configurable: true, enumerable: false, writable: false, value: api });
  return Object.freeze({ api, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PROPERTY] === api) delete host[PROPERTY];
  } });
}
