/**
 * Responsibility: Stable public entry for the Help feature.
 * Imports: Help feature modules only; callers must not depend on feature internals through this file.
 * Exports: Help composition, controller, content registry, state and temporary classic port contracts.
 * State/side effects: None. Lifecycle: import-only facade.
 */
export { createHelpFeature } from './create-help-feature.js';
export { createHelpController, HELP_SHOWN_STORAGE_KEY } from './help-controller.js';
export { createHelpContentRegistry, helpContentRegistry } from './help-content-registry.js';
export { createHelpState, HELP_PAGE_IDS, normalizeHelpPage } from './help-state.js';
export { mountClassicHelpPort } from './compatibility/classic-help-port.js';
