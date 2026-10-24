/**
 * Responsibility: Stable public entry for the Menu feature.
 * Imports: Menu feature modules only; callers must not depend on Menu internals through this file.
 * Exports: Menu Model/state, command IDs/bindings, controller/view, Submenu Positioner, Recent Files Menu Controller and scoped classic adapters.
 * State/side effects: None.
 * Lifecycle: Import-only facade.
 */
export { MENU_COMMAND_IDS, createMenuCommandBindings, isMenuCommandId } from './menu-command-bindings.js';
export { MENU_DECLARATION, MENU_SELECTORS, createMenuState } from './menu-state.js';
export { createMenuController } from './menu-controller.js';
export { createMenuView } from './menu-view.js';
export { createSubmenuPositioner } from './submenu-positioner.js';
export { createRecentFilesMenuController } from './recent-files-menu-controller.js';
export { createMenuActions } from './menu-actions.js';

export { createMenuContentView } from './ui/menu-content-view.js';
