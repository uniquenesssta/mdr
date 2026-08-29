/**
 * Responsibility: Scoped Stage 7 migration bridge exposing the immutable preview threshold owner to remaining classic preview callers.
 * Imports: Preview threshold configuration only.
 * Exports: mountClassicPreviewThresholdsPort().
 * State/side effects: Owns one non-enumerable compatibility-host property; owns no threshold values and removes the property on destroy.
 * Lifecycle: mountClassicPreviewThresholdsPort()/destroy() are idempotent per mount.
 */
import { PREVIEW_BEHAVIOR_THRESHOLDS } from '../pipeline/preview-thresholds.js';

const PORT_PROPERTY = 'markdownEditorPreviewThresholdsPort';

function assertTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('Classic Preview Thresholds port target must be an object.');
  }
}

export function mountClassicPreviewThresholdsPort(target) {
  assertTarget(target);
  if (Object.hasOwn(target, PORT_PROPERTY)) {
    throw new Error('Classic Preview Thresholds port is already mounted.');
  }

  let destroyed = false;
  const api = Object.freeze({
    get snapshot() {
      if (destroyed) throw new Error('Classic Preview Thresholds port is destroyed.');
      return PREVIEW_BEHAVIOR_THRESHOLDS;
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
