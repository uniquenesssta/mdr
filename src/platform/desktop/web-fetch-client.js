function assertFunction(value, message) {
  if (typeof value !== 'function') throw new TypeError(message);
}

/**
 * Creates the desktop web-fetch command adapter.
 * Rust remains authoritative for URL normalization, redirects, timeout,
 * response validation and the FetchResponse payload.
 */
export function createWebFetchClient(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('web-fetch client options must be an object');
  }

  const invoke = options.invoke;
  assertFunction(invoke, 'web-fetch client requires an invoke function');

  async function fetchUrl(url) {
    return invoke('fetch_url', { url }, {
      inputLength: String(url || '').length
    });
  }

  return Object.freeze({ fetchUrl });
}
