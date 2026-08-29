/**
 * Responsibility: Temporary scoped bridge exposing Settings Store committed/draft session operations to remaining classic scripts without exposing Repository or raw storage.
 * Imports: None; Store instance is injected.
 * Exports: mountClassicSettingsStorePort().
 * State/side effects: Owns one non-enumerable compatibility-host property and removes it on idempotent destroy(); no Settings values are owned here.
 */
const PORT_PROPERTY = 'markdownEditorSettingsStorePort';

function assertMountTarget(target) {
  if (!target || typeof target !== 'object') throw new TypeError('Classic Settings Store port target must be an object.');
}

function assertStore(store) {
  if (!store || typeof store !== 'object') throw new TypeError('Classic Settings Store port requires a Settings Store.');
  for (const method of ['get', 'openDraft', 'updateDraft', 'applyDraft', 'cancelDraft', 'commit', 'set']) {
    if (typeof store[method] !== 'function') throw new TypeError(`Classic Settings Store port requires ${method}().`);
  }
  if (!('snapshot' in store) || !('draft' in store) || !('hasDraft' in store)) {
    throw new TypeError('Classic Settings Store port requires snapshot/draft state accessors.');
  }
}

export function mountClassicSettingsStorePort(target, store) {
  assertMountTarget(target);
  assertStore(store);
  if (Object.hasOwn(target, PORT_PROPERTY)) throw new Error('Classic Settings Store port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Classic Settings Store port is destroyed.');
  };

  const api = Object.freeze({
    get snapshot() {
      assertActive();
      return store.snapshot;
    },
    get draft() {
      assertActive();
      return store.draft;
    },
    get hasDraft() {
      assertActive();
      return store.hasDraft;
    },
    get(id) {
      assertActive();
      return store.get(id);
    },
    openDraft() {
      assertActive();
      return store.openDraft();
    },
    updateDraft(changes) {
      assertActive();
      return store.updateDraft(changes);
    },
    applyDraft() {
      assertActive();
      return store.applyDraft();
    },
    cancelDraft() {
      assertActive();
      return store.cancelDraft();
    },
    commit(changes) {
      assertActive();
      return store.commit(changes);
    },
    set(id, value) {
      assertActive();
      return store.set(id, value);
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
