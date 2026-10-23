/** Own explicit opt-in, lazy query construction and reversible global-slot installation.
 * Browser descriptors and environment reads are injected; construction is cold.
 */
export function createE2EBridge(options = {}) {
  const ports = {};
  for (const name of ['readEnvironment', 'readSlotDescriptor', 'defineSlot', 'deleteSlot']) {
    if (typeof options[name] !== 'function') throw new TypeError(`E2EBridge requires ${name}`);
    ports[name] = options[name];
  }
  let factory = null, owned = null, installing = false, destroyed = false, cleanupFailed = false;
  const unavailable = () => new Error('E2E bridge unavailable');
  function assertAvailable() { if (destroyed || cleanupFailed) throw unavailable(); }

  function isEnabled() {
    if (destroyed || cleanupFailed) return false;
    try {
      const environment = ports.readEnvironment();
      return environment?.testFlag === true
        || new URL(environment?.url || 'http://localhost/').searchParams.get('e2e') === '1';
    } catch (_) { return false; }
  }
  function sameDescriptor(left, right) {
    if (!left || !right) return !left && !right;
    return ['value', 'get', 'set', 'writable', 'configurable', 'enumerable'].every(key =>
      Object.hasOwn(left, key) === Object.hasOwn(right, key) && Object.is(left[key], right[key]));
  }
  function release(record) {
    if (!record.disposed) {
      record.disposed = true;
      try { record.dispose(); } catch (_) { cleanupFailed = true; }
    }
    try {
      const current = ports.readSlotDescriptor();
      // Never evaluate an accessor or overwrite a later external replacement.
      if (current && Object.hasOwn(current, 'value') && current.value === record.api) {
        if (record.previous) ports.defineSlot(record.previous);
        else if (ports.deleteSlot() !== true) throw unavailable();
        if (!sameDescriptor(ports.readSlotDescriptor(), record.previous)) throw unavailable();
      }
    } catch (_) { cleanupFailed = true; }
  }

  return Object.freeze({
    isEnabled,
    configure(createQuery) {
      assertAvailable();
      if (installing || owned) throw new Error('E2E bridge busy');
      if (!isEnabled()) { factory = null; return false; }
      assertAvailable();
      if (typeof createQuery !== 'function') throw new TypeError('E2EBridge requires a query factory');
      factory = createQuery;
      return true;
    },
    install() {
      assertAvailable();
      if (installing || owned) return null;
      if (!isEnabled()) { factory = null; return null; }
      if (!factory) throw new Error('E2E configuration unavailable');
      let record = null;
      installing = true;
      try {
        const descriptor = ports.readSlotDescriptor();
        if (descriptor && (!Object.hasOwn(descriptor, 'value') || descriptor.value || descriptor.configurable !== true)) return null;
        if (destroyed) throw unavailable();
        const api = factory();
        const dispose = api?.destroy;
        if (!api || typeof dispose !== 'function') throw unavailable();
        record = { api, dispose: () => dispose.call(api), previous: descriptor ? { ...descriptor } : undefined, disposed: false };
        if (destroyed) throw unavailable();
        // Factories may synchronously yield to host code: protect a replacement
        // that arrived after the first descriptor read.
        const beforePublish = ports.readSlotDescriptor();
        if (destroyed || !sameDescriptor(beforePublish, record.previous)) throw unavailable();
        owned = record;
        ports.defineSlot({ value: api, configurable: true, enumerable: false, writable: false });
        if (destroyed || !sameDescriptor(ports.readSlotDescriptor(), {
          value: api, configurable: true, enumerable: false, writable: false
        })) throw unavailable();
        factory = null;
        return api;
      } catch (_) {
        if (record) release(record);
        if (owned === record) owned = null;
        throw new Error('E2E installation unavailable');
      } finally { installing = false; }
    },
    destroy() {
      if (destroyed) return !cleanupFailed;
      destroyed = true;
      factory = null;
      const record = owned;
      owned = null;
      if (record) release(record);
      return !cleanupFailed;
    },
    getState: () => Object.freeze({ destroyed, cleanupFailed, installing, installed: owned !== null, configured: factory !== null })
  });
}
