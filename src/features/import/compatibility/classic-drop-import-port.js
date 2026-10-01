/** Scoped registration/path commands for classic consumers until 13.13/13.14; no routing state. */
const PROPERTY = 'markdownEditorDropImportPort';
export function mountClassicDropImportPort(host, controller) {
  if (!host || typeof host !== 'object') throw new TypeError('Drop Import port requires a host.');
  if (typeof controller?.start !== 'function' || typeof controller?.openPath !== 'function') throw new TypeError('Drop Import port requires a controller.');
  if (Object.hasOwn(host, PROPERTY)) throw new Error('Drop Import port is already mounted.');
  let destroyed = false;
  const active = () => { if (destroyed) throw new Error('Drop Import port is destroyed.'); };
  const api = Object.freeze({
    register(callbacks) { active(); return controller.start(callbacks); },
    openPath(path) { active(); return controller.openPath(path); }
  });
  Object.defineProperty(host, PROPERTY, { configurable: true, enumerable: false, writable: false, value: api });
  return Object.freeze({ api, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PROPERTY] === api) delete host[PROPERTY];
  } });
}
