function resolveStorage(explicitStorage) {
  if (explicitStorage) return explicitStorage;
  const storage = globalThis.localStorage;
  if (!storage) throw new Error('Browser localStorage is unavailable');
  return storage;
}

function assertStorage(storage) {
  for (const method of ['getItem', 'setItem', 'removeItem', 'clear']) {
    if (typeof storage?.[method] !== 'function') {
      throw new TypeError(`Browser storage requires ${method}()`);
    }
  }
}

/** Browser string key/value persistence adapter with native storage errors preserved. */
export function createBrowserStorage(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('browser storage options must be an object');
  }

  const storage = resolveStorage(Object.hasOwn(options, 'storage') ? options.storage : null);
  assertStorage(storage);

  function get(key) {
    return storage.getItem(String(key));
  }

  function set(key, value) {
    return storage.setItem(String(key), String(value));
  }

  function remove(key) {
    return storage.removeItem(String(key));
  }

  function clear() {
    return storage.clear();
  }

  return Object.freeze({ get, set, remove, clear });
}
