function assertFunction(value, message) {
  if (typeof value !== 'function') throw new TypeError(message);
}

/**
 * Creates the desktop external-link command adapter.
 * The client preserves the legacy trim and telemetry fields while Rust remains
 * authoritative for supported schemes and operating-system launch behavior.
 */
export function createLinkClient(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('link client options must be an object');
  }

  const invoke = options.invoke;
  assertFunction(invoke, 'link client requires an invoke function');

  async function openExternal(url) {
    const value = String(url || '').trim();
    return invoke('open_external_url', { url: value }, {
      scheme: value.split(':', 1)[0].toLowerCase(),
      inputLength: value.length
    });
  }

  return Object.freeze({ openExternal });
}
