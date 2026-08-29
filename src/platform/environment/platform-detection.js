/**
 * Pure runtime-kind detection. This module owns no state or side effects and is
 * the only production module allowed to read the Tauri runtime sentinel.
 */

export const PLATFORM_ENVIRONMENTS = Object.freeze({
  BROWSER: 'browser',
  DESKTOP: 'desktop'
});

const TAURI_INTERNALS_KEY = '__TAURI_INTERNALS__';

function hasTauriInternals(runtime) {
  if ((typeof runtime !== 'object' && typeof runtime !== 'function') || runtime === null) {
    return false;
  }
  try {
    return Boolean(runtime[TAURI_INTERNALS_KEY]);
  } catch {
    return false;
  }
}

export function detectPlatformEnvironment(runtime = globalThis) {
  const isDesktop = hasTauriInternals(runtime);
  return Object.freeze({
    kind: isDesktop ? PLATFORM_ENVIRONMENTS.DESKTOP : PLATFORM_ENVIRONMENTS.BROWSER,
    isDesktop,
    isBrowser: !isDesktop
  });
}
