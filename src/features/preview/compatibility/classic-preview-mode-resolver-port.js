/**
 * Responsibility: Scoped Stage 7 migration bridge exposing the pure Preview Mode Resolver to remaining classic preview callers.
 * Imports: Preview Mode Resolver pure functions only.
 * Exports: mountClassicPreviewModeResolverPort().
 * State/side effects: Owns one non-enumerable compatibility-host property; owns no preview mode state and removes the property on destroy.
 * Lifecycle: mountClassicPreviewModeResolverPort()/destroy() are idempotent per mount; API calls are terminal after destroy.
 */
import {
  normalizePreviewModeSetting,
  resolvePreviewMode
} from '../pipeline/preview-mode-resolver.js';

const PORT_PROPERTY = 'markdownEditorPreviewModeResolverPort';

function assertTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('Classic Preview Mode Resolver port target must be an object.');
  }
}

export function mountClassicPreviewModeResolverPort(target) {
  assertTarget(target);
  if (Object.hasOwn(target, PORT_PROPERTY)) {
    throw new Error('Classic Preview Mode Resolver port is already mounted.');
  }

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Classic Preview Mode Resolver port is destroyed.');
  };
  const api = Object.freeze({
    normalizeSetting(value) {
      assertActive();
      return normalizePreviewModeSetting(value);
    },
    resolve(settings, characterCount, blockCount) {
      assertActive();
      return resolvePreviewMode(settings, characterCount, blockCount);
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
