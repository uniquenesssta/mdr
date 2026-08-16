/**
 * Responsibility: Hold the explicitly configured cross-feature sync callbacks used by Hybrid Editor integration code without exposing sync controllers on window.
 * State/side effects: One composition-owned capability reference; no timers, DOM or policy.
 * Lifecycle: configureHybridSyncCapabilities(null) clears the reference during app teardown.
 */

let capabilities = null;

function normalizeCapabilities(value) {
  if (value === null || value === undefined) return null;
  const required = ['markProgrammaticScroll', 'notifyScrollGeometry', 'notifySelectionGeometry'];
  if (typeof value !== 'object' || required.some(name => typeof value[name] !== 'function')) {
    throw new TypeError('Hybrid sync capabilities require markProgrammaticScroll/notifyScrollGeometry/notifySelectionGeometry');
  }
  return Object.freeze({
    markProgrammaticScroll: value.markProgrammaticScroll,
    notifyScrollGeometry: value.notifyScrollGeometry,
    notifySelectionGeometry: value.notifySelectionGeometry
  });
}

export function configureHybridSyncCapabilities(value = null) {
  capabilities = normalizeCapabilities(value);
  return capabilities;
}

export function getHybridSyncCapabilities() {
  return capabilities;
}
