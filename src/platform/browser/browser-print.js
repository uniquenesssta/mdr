function resolveWindow(explicitWindow) {
  const windowObject = explicitWindow ?? globalThis.window;
  if (!windowObject || typeof windowObject.print !== 'function') {
    throw new Error('Browser print is unavailable');
  }
  return windowObject;
}

/** Browser print adapter. Print preparation and after-print restoration remain with callers. */
export function createBrowserPrint(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('browser print options must be an object');
  }

  const windowObject = resolveWindow(options.windowObject);

  function print() {
    return windowObject.print();
  }

  return Object.freeze({ print });
}
