/**
 * Responsibility: Scoped Stage 7 migration bridge exposing the canonical PreviewState to remaining classic preview callers without copying state.
 * Imports: PreviewState contract only through the injected instance.
 * Exports: mountClassicPreviewStatePort().
 * State/side effects: Owns one non-enumerable compatibility-host property; owns no Preview state and removes the property on destroy.
 * Lifecycle: mountClassicPreviewStatePort()/destroy() are idempotent per mount; API calls are terminal after destroy.
 */
const PORT_PROPERTY = 'markdownEditorPreviewStatePort';

function assertTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('Classic Preview State port target must be an object.');
  }
}

function assertState(state) {
  const methods = [
    'beginRender',
    'isCurrentVersion',
    'setFocusSection',
    'commitStable',
    'commitDegraded',
    'failRender',
    'invalidate'
  ];
  if (!state || typeof state !== 'object') throw new TypeError('Preview State instance is required.');
  for (const method of methods) {
    if (typeof state[method] !== 'function') throw new TypeError(`Preview State.${method}() is required.`);
  }
  return state;
}

export function mountClassicPreviewStatePort(target, previewState) {
  assertTarget(target);
  const state = assertState(previewState);
  if (Object.hasOwn(target, PORT_PROPERTY)) {
    throw new Error('Classic Preview State port is already mounted.');
  }

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Classic Preview State port is destroyed.');
  };
  const api = Object.freeze({
    get snapshot() {
      assertActive();
      return state.snapshot;
    },
    beginRender() {
      assertActive();
      return state.beginRender();
    },
    isCurrentVersion(version) {
      assertActive();
      return state.isCurrentVersion(version);
    },
    setFocusSection(version, section) {
      assertActive();
      return state.setFocusSection(version, section);
    },
    commitStable(version, payload) {
      assertActive();
      return state.commitStable(version, payload);
    },
    commitDegraded(version, payload) {
      assertActive();
      return state.commitDegraded(version, payload);
    },
    failRender(version, payload) {
      assertActive();
      return state.failRender(version, payload);
    },
    invalidate(options) {
      assertActive();
      return state.invalidate(options);
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
