export { SIDEBAR_TABS, normalizeSidebarTab, createSidebarState } from './state/sidebar-state.js';
export { SIDEBAR_TAB_STORAGE_KEY, createSidebarTabController } from './tabs/sidebar-tab-controller.js';
export { mountClassicSidebarControllerPort } from './compatibility/classic-sidebar-controller-port.js';
export { mountClassicOutlineControllerPort } from './compatibility/classic-outline-controller-port.js';
export { mountClassicFolderTreeControllerPort } from './compatibility/classic-folder-tree-controller-port.js';
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
export {
  normalizeNativePath,
  isSameNativePath,
  isNativePathWithinDirectory,
  getNativeParentPath
} from './folder-tree/folder-tree-path-policy.js';
export {
  SUPPORTED_FOLDER_TREE_EXTENSIONS,
  normalizeFolderTreeResult
} from './folder-tree/folder-tree-normalizer.js';
export { createFolderTreeState } from './folder-tree/folder-tree-state.js';
export { createFolderTreeNodeView } from './folder-tree/folder-tree-node-view.js';
export { createFolderTreeView } from './folder-tree/folder-tree-view.js';
export { createFolderTreeController } from './folder-tree/folder-tree-controller.js';
