/**
 * Responsibility: Public Stage 6 Layout contract for runtime layout state, responsive thresholds and the scoped classic migration bridge.
 * Imports: Layout feature modules only.
 * Exports: LayoutState factory, Sidebar Resize Controller, responsive breakpoint helpers and classic LayoutState port mount.
 * State/side effects: Import-only facade; no DOM, storage or runtime state ownership.
 */
export { createLayoutState } from './state/layout-state.js';
export { createSidebarResizeController, SIDEBAR_WIDTH_STORAGE_KEY } from './sidebar/sidebar-resize-controller.js';
export {
  RESPONSIVE_BREAKPOINTS,
  RESPONSIVE_MEDIA_QUERIES,
  getCompactShellMaxWidth,
  getCompactSplitMaxWidth,
  matchesNarrowInteractiveLayout
} from './shell/responsive-breakpoints.js';
export { mountClassicLayoutStatePort } from './compatibility/classic-layout-state-port.js';
