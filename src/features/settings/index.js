/**
 * Responsibility: Public Stage 4 Settings domain contract; later repository/store/controller layers must consume this entry rather than duplicate schema rules.
 * Imports: Settings domain modules only.
 * Exports: Schema/default/validation/serialization contracts required by Atomic 4.6 and later Settings atomics.
 * State/side effects: Import-only facade; no DOM, storage, platform or lifecycle side effects.
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
