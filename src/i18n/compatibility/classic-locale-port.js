const HOST_API_PROPERTY = 'markdownEditorLocalePort';

function requireHost(host) {
  if (!host || typeof host !== 'object' || typeof host.removeAttribute !== 'function') {
    throw new TypeError('classic locale port requires a DOM host');
  }
  return host;
}

function requireRegistry(registry) {
  if (!registry || typeof registry.has !== 'function' || typeof registry.get !== 'function') {
    throw new TypeError('classic locale port requires a locale registry');
  }
  return registry;
}

export function mountClassicLocalePort(host, registry) {
  const target = requireHost(host);
  const source = requireRegistry(registry);
  if (Object.hasOwn(target, HOST_API_PROPERTY)) throw new Error('classic locale port is already mounted');
  let destroyed = false;
  const api = Object.freeze({
    defaultLocale: source.defaultLocale,
    hasLocale(locale) { return !destroyed && source.has(locale); },
    getLocale(locale) {
      if (destroyed) throw new Error('classic locale port has been destroyed');
      return source.get(locale);
    }
  });
  Object.defineProperty(target, HOST_API_PROPERTY, { configurable: true, enumerable: false, writable: false, value: api });
  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      delete target[HOST_API_PROPERTY];
    }
  });
}
