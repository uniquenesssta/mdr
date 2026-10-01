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

  async function fetchUrl(url, { signal } = {}) {
    const abortError = () => Object.assign(new Error('网页抓取已取消'), { name: 'AbortError', code: 'WEB_FETCH_CANCELLED' });
    if (signal?.aborted) throw abortError();
    if (!signal) {
      return invoke('fetch_url', { url }, { inputLength: String(url || '').length });
    }
    const requestId = `${Date.now()}-${globalThis.crypto.randomUUID()}`;
    let rejectCancellation;
    const cancelled = new Promise((_, reject) => { rejectCancellation = reject; });
    const onAbort = () => {
      Promise.resolve().then(() => invoke('cancel_fetch_url', { requestId }, {})).then(
        () => rejectCancellation(abortError()),
        error => rejectCancellation(error)
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const pending = Promise.resolve().then(() => invoke('fetch_url', { url, requestId }, {
        inputLength: String(url || '').length
      })).then(result => {
        if (signal.aborted) throw abortError();
        return result;
      }, error => {
        if (signal.aborted && (error === 'WEB_FETCH_CANCELLED' || error?.code === 'WEB_FETCH_CANCELLED')) {
          throw abortError();
        }
        throw error;
      });
      return await Promise.race([pending, cancelled]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  return Object.freeze({ fetchUrl });
}
