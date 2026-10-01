/** Scoped web-fetch access and input-listener lifetime for classic UI until 13.12/13.14. */
const PROPERTY = 'markdownEditorWebFetchPort';
export function mountClassicWebFetchPort(host, coordinator) {
  if (!host || typeof host !== 'object') throw new TypeError('Web Fetch port requires a host.');
  for (const method of ['fetchUrl', 'cancel', 'isCurrent', 'manualHtml']) {
    if (typeof coordinator?.[method] !== 'function') throw new TypeError('Web Fetch port requires a coordinator.');
  }
  if (Object.hasOwn(host, PROPERTY)) throw new Error('Web Fetch port is already mounted.');
  let destroyed = false;
  const listeners = [];
  const assertActive = () => { if (destroyed) throw new Error('Web Fetch port is destroyed.'); };
  const api = Object.freeze({
    fetchUrl(url, options) { assertActive(); return coordinator.fetchUrl(url, options); },
    manualHtml(html) { assertActive(); return coordinator.manualHtml(html); },
    isCurrent(value) { return !destroyed && coordinator.isCurrent(value); },
    cancel() { coordinator.cancel(); },
    watchInputs(targets, onInvalidate) {
      assertActive();
      if (typeof onInvalidate !== 'function' || targets.some(target => !target?.addEventListener)) throw new TypeError('Invalid Web Fetch input binding.');
      const invalidate = () => { coordinator.cancel(); onInvalidate(); };
      for (const target of targets) for (const type of ['input', 'change']) {
        target.addEventListener(type, invalidate);
        listeners.push(() => target.removeEventListener(type, invalidate));
      }
    }
  });
  Object.defineProperty(host, PROPERTY, { configurable: true, enumerable: false, writable: false, value: api });
  return Object.freeze({ api, destroy() {
    if (destroyed) return;
    destroyed = true;
    coordinator.cancel();
    for (const remove of listeners.splice(0)) remove();
    if (host[PROPERTY] === api) delete host[PROPERTY];
  } });
}
