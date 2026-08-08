/**
 * Responsibility: Public Stage 4 Settings contract exposing domain rules, persistence, the authoritative Settings Store and scoped classic Store bridge.
 * Imports: Settings feature modules only.
 * Exports: Schema/default/validation/serialization, Settings Repository, Settings Store and classic Store compatibility mount contracts.
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
export { mountClassicSettingsStorePort } from './compatibility/classic-settings-store-port.js';
