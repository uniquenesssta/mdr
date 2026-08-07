const HOST_API_PROPERTY = 'markdownEditorPlatformPort';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readCapability(capabilities, capability) {
  const path = String(capability || '').trim().split('.').filter(Boolean);
  if (!path.length) return false;
  let current = capabilities;
  for (const segment of path) {
    if (!isObject(current) || !Object.hasOwn(current, segment)) return false;
    current = current[segment];
  }
  return Boolean(current);
}

function requireHost(host) {
  if (!host || typeof host !== 'object' || typeof host.removeAttribute !== 'function') {
    throw new TypeError('classic platform port requires a DOM host');
  }
  return host;
}

function requirePlatform(platform) {
  if (!isObject(platform) || !isObject(platform.capabilities)) {
    throw new TypeError('classic platform port requires a Platform object');
  }
  return platform;
}

/**
 * Exposes only call/supports on the dedicated compatibility ports host so
 * classic scripts can consume Platform without a window-global Platform/native
 * facade or shared classic lexical dependency. The bridge is deleted on destroy.
 */
export function mountClassicPlatformPort(host, platform) {
  const target = requireHost(host);
  const source = requirePlatform(platform);
  if (Object.hasOwn(target, HOST_API_PROPERTY)) {
    throw new Error('classic platform port is already mounted');
  }

  let destroyed = false;
  const api = Object.freeze({
    supports(capability) {
      if (destroyed) return false;
      return readCapability(source.capabilities, capability);
    },
    call(portName, methodName, ...args) {
      if (destroyed) throw new Error('classic platform port has been destroyed');
      const port = source[String(portName || '')];
      const method = port?.[String(methodName || '')];
      if (typeof method !== 'function') {
        throw new TypeError(`Unknown Platform method: ${String(portName || '')}.${String(methodName || '')}`);
      }
      return method(...args);
    }
  });

  Object.defineProperty(target, HOST_API_PROPERTY, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api
  });

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      delete target[HOST_API_PROPERTY];
    }
  });
}
