/**
 * Responsibility: Temporary scoped bridge exposing the canonical SaveStatusStore snapshot/subscription plus legacy save-workflow status intents to remaining classic scripts.
 * Imports: None; the Store instance is injected and no persistence/UI implementation may be imported.
 * Exports: mountClassicSaveStatusStorePort().
 * State/side effects: Owns only one non-enumerable compatibility-host property; it never copies status state or subscribes on behalf of callers.
 * Lifecycle: Explicit idempotent destroy() removes the scoped property and makes the bridge terminal without destroying the injected Store.
 */
const PORT_PROPERTY = 'markdownEditorSaveStatusStorePort';

function assertMountTarget(target) {
  if (!target || typeof target !== 'object') throw new TypeError('Classic Save Status Store port target must be an object.');
}

function assertStore(store) {
  if (!store || typeof store !== 'object') throw new TypeError('Classic Save Status Store port requires a Save Status Store.');
  for (const method of ['setState', 'reset', 'subscribe']) {
    if (typeof store[method] !== 'function') throw new TypeError(`Classic Save Status Store port requires ${method}().`);
  }
  if (!('snapshot' in store)) throw new TypeError('Classic Save Status Store port requires snapshot access.');
}

function normalizeLegacyDetails(value) {
  if (value === undefined) return {};
  if (typeof value === 'string') return { message: value };
  return value;
}

export function mountClassicSaveStatusStorePort(target, store) {
  assertMountTarget(target);
  assertStore(store);
  if (Object.hasOwn(target, PORT_PROPERTY)) throw new Error('Classic Save Status Store port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Classic Save Status Store port is destroyed.');
  };

  const api = Object.freeze({
    get snapshot() {
      assertActive();
      return store.snapshot;
    },
    subscribe(listener) {
      assertActive();
      return store.subscribe(listener);
    },
    setState(state, details) {
      assertActive();
      return store.setState(state, normalizeLegacyDetails(details), 'classic-workflow');
    },
    reset(reason) {
      assertActive();
      return store.reset(reason || 'classic-reset');
    }
  });

  Object.defineProperty(target, PORT_PROPERTY, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api
  });

  return Object.freeze({
    api,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (target[PORT_PROPERTY] === api) delete target[PORT_PROPERTY];
      if (typeof target.removeAttribute === 'function') target.removeAttribute(PORT_PROPERTY);
    }
  });
}
