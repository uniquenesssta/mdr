export { SIDEBAR_TABS, normalizeSidebarTab, createSidebarState } from './state/sidebar-state.js';
export { SIDEBAR_TAB_STORAGE_KEY, createSidebarTabController } from './tabs/sidebar-tab-controller.js';
export { mountClassicSidebarControllerPort } from './compatibility/classic-sidebar-controller-port.js';
export { mountClassicOutlineControllerPort } from './compatibility/classic-outline-controller-port.js';
export { OUTLINE_COLLAPSE_STORAGE_KEY, createOutlineCollapseStore } from './outline/outline-collapse-store.js';
export { resolveActiveOutlineHeading } from './outline/outline-active-heading.js';
export {
  normalizeOutlineHeadingIndex,
  normalizePreviewHeadingBlocks,
  outlineHeadingIndexesEqual,
  buildOutlineTree,
  collectCollapsibleOutlineIds
} from './outline/outline-tree-builder.js';
export { createOutlineView } from './outline/outline-view.js';
export { createOutlineController } from './outline/outline-controller.js';
