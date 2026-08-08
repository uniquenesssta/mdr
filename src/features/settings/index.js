/**
 * Responsibility: Public Stage 4 Settings contract, exposing domain rules plus the Atomic 4.7 persistence boundary and scoped classic bridge.
 * Imports: Settings feature modules only.
 * Exports: Schema/default/validation/serialization, Settings Repository and classic compatibility mount contracts.
 * State/side effects: Import-only facade; no DOM, storage lookup or lifecycle state.
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
export { mountClassicSettingsRepositoryPort } from './compatibility/classic-settings-repository-port.js';
