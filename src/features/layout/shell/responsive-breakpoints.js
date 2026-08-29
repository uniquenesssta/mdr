/**
 * Responsibility: Own Stage 6 responsive layout thresholds and media-query strings used by layout state/controllers.
 * Imports: None.
 * Exports: immutable responsive breakpoint contract plus hysteresis/query helpers.
 * State/side effects: Pure constants and calculations; no DOM, storage or listeners.
 */
const COMPACT_SHELL_ENTER_MAX_WIDTH = 860;
const COMPACT_SHELL_EXIT_MAX_WIDTH = 900;
const COMPACT_SPLIT_ENTER_MAX_WIDTH = 720;
const COMPACT_SPLIT_EXIT_MAX_WIDTH = 760;
const NARROW_INTERACTIVE_MAX_WIDTH = 768;

export const RESPONSIVE_BREAKPOINTS = Object.freeze({
  compactShell: Object.freeze({
    enterMaxWidth: COMPACT_SHELL_ENTER_MAX_WIDTH,
    exitMaxWidth: COMPACT_SHELL_EXIT_MAX_WIDTH
  }),
  compactSplit: Object.freeze({
    enterMaxWidth: COMPACT_SPLIT_ENTER_MAX_WIDTH,
    exitMaxWidth: COMPACT_SPLIT_EXIT_MAX_WIDTH
  }),
  narrowInteractive: Object.freeze({ maxWidth: NARROW_INTERACTIVE_MAX_WIDTH })
});

export const RESPONSIVE_MEDIA_QUERIES = Object.freeze({
  narrowInteractive: `(max-width: ${NARROW_INTERACTIVE_MAX_WIDTH}px)`
});

export function getCompactShellMaxWidth(active) {
  return active
    ? RESPONSIVE_BREAKPOINTS.compactShell.exitMaxWidth
    : RESPONSIVE_BREAKPOINTS.compactShell.enterMaxWidth;
}

export function getCompactSplitMaxWidth(active) {
  return active
    ? RESPONSIVE_BREAKPOINTS.compactSplit.exitMaxWidth
    : RESPONSIVE_BREAKPOINTS.compactSplit.enterMaxWidth;
}

export function matchesNarrowInteractiveLayout(matchMedia) {
  if (typeof matchMedia !== 'function') return false;
  return Boolean(matchMedia(RESPONSIVE_MEDIA_QUERIES.narrowInteractive)?.matches);
}
