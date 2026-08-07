function resolveDocument(explicitDocument) {
  const documentObject = explicitDocument ?? globalThis.document;
  if (!documentObject) throw new Error('Browser fullscreen document surface is unavailable');
  return documentObject;
}

/** Browser fullscreen adapter preserving standard and legacy WebKit surfaces. */
export function createBrowserFullscreen(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('browser fullscreen options must be an object');
  }

  const documentObject = resolveDocument(options.documentObject);
  const target = options.target ?? documentObject.documentElement;

  function isEnabled() {
    return Boolean(documentObject.fullscreenEnabled || documentObject.webkitFullscreenEnabled);
  }

  function isActive() {
    return Boolean(documentObject.fullscreenElement || documentObject.webkitFullscreenElement);
  }

  async function enter() {
    const request = target?.requestFullscreen || target?.webkitRequestFullscreen;
    if (typeof request !== 'function') throw new Error('Browser fullscreen enter is unavailable');
    return request.call(target);
  }

  async function exit() {
    if (!isActive()) return;
    const exitFullscreen = documentObject.exitFullscreen || documentObject.webkitExitFullscreen;
    if (typeof exitFullscreen !== 'function') throw new Error('Browser fullscreen exit is unavailable');
    return exitFullscreen.call(documentObject);
  }

  function subscribe(handler) {
    if (typeof handler !== 'function') throw new TypeError('fullscreen subscribe handler must be a function');
    if (typeof documentObject.addEventListener !== 'function' || typeof documentObject.removeEventListener !== 'function') {
      throw new Error('Browser fullscreen subscription is unavailable');
    }
    const listener = () => handler(isActive());
    const events = ['fullscreenchange', 'webkitfullscreenchange'];
    for (const eventName of events) documentObject.addEventListener(eventName, listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      for (const eventName of events) documentObject.removeEventListener(eventName, listener);
    };
  }

  return Object.freeze({ isEnabled, isActive, enter, exit, subscribe });
}
