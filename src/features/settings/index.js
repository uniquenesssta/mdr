/**
 * Responsibility: Public Stage 4 Settings contract exposing domain rules, section descriptors, persistence, the authoritative Settings Store and scoped classic Store bridge.
 * Imports: Settings feature modules only.
 * Exports: Schema/default/validation/serialization, immutable Section Modules, Settings Repository, Settings Store and classic Store compatibility mount contracts.
 * State/side effects: Import-only facade; no DOM, storage lookup or runtime state ownership.
 */
export { SETTING_DEFAULTS } from './domain/settings-defaults.js';
export {
  SETTINGS_SCHEMA,
  SETTINGS_IMPACT_EVENTS,
  SETTING_IDS,
  SETTING_SECTIONS,
  getSettingDefinition,
  listSettingDefinitions
} from './domain/settings-schema.js';
export {
  assertValidSettingValue,
  isValidSettingValue,
  normalizeSettingValue
} from './domain/settings-validation.js';
export {
  deserializeSettingValue,
  serializeSettingValue,
  shouldOmitSettingValue
} from './domain/settings-serialization.js';
export {
  createSettingsRepository,
  SettingsRepositoryReadError,
  SettingsRepositoryWriteError
} from './infrastructure/settings-repository.js';
export { createSettingsStore } from './state/settings-store.js';
export { createSettingsFeature } from './create-settings-feature.js';
export {
  SETTINGS_CHANGED_EVENT,
  createSettingsApplyCoordinator
} from './application/settings-apply-coordinator.js';
export { createSettingsController } from './application/settings-controller.js';
export {
  EDITOR_SETTINGS_SECTION,
  GENERAL_SETTINGS_SECTION,
  PERFORMANCE_SETTINGS_SECTION,
  SAVE_SETTINGS_SECTION,
  SETTINGS_SECTION_DEFINITIONS,
  SETTINGS_SECTION_IDS,
  TOOLBAR_SETTINGS_SECTION,
  getSettingsSectionDefinition,
  listSettingsSectionDefinitions
} from './sections/section-registry.js';
export { mountClassicSettingsStorePort } from './compatibility/classic-settings-store-port.js';
