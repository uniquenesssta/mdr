/**
 * Responsibility: Temporary scoped bridge exposing typed Settings Repository calls to remaining classic scripts without exposing raw storage or schema internals.
 * Imports: None; repository instance is injected.
 * Exports: mountClassicSettingsRepositoryPort().
 * State/side effects: Owns one non-enumerable compatibility-host property and removes it on idempotent destroy(); no settings state or storage I/O is owned here.
 */
const PORT_PROPERTY = 'markdownEditorSettingsRepositoryPort';

function assertMountTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('Classic Settings Repository port target must be an object.');
  }
}

function assertRepository(repository) {
  if (!repository || typeof repository.load !== 'function' || typeof repository.save !== 'function') {
    throw new TypeError('Classic Settings Repository port requires a Settings Repository.');
  }
}

export function mountClassicSettingsRepositoryPort(target, repository) {
  assertMountTarget(target);
  assertRepository(repository);
  if (Object.hasOwn(target, PORT_PROPERTY)) throw new Error('Classic Settings Repository port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Classic Settings Repository port is destroyed.');
  };

  const api = Object.freeze({
    load() {
      assertActive();
      return repository.load();
    },

    get(id) {
      assertActive();
      return repository.load([id])[id];
    },

    save(changes) {
      assertActive();
      return repository.save(changes);
    },

    set(id, value) {
      assertActive();
      return repository.save({ [id]: value })[id];
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
