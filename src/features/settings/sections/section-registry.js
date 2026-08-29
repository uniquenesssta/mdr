/**
 * Responsibility: Own the ordered immutable registry of all five Settings section descriptors and enforce exact Settings Schema coverage.
 * Imports: Settings domain ids plus the five section descriptor modules only.
 * Exports: section constants, SETTINGS_SECTION_IDS, SETTINGS_SECTION_DEFINITIONS, getSettingsSectionDefinition(), listSettingsSectionDefinitions().
 * State/side effects: Immutable module-load registry only; no DOM, storage, UI, application or business-module calls.
 */
import { SETTING_IDS, SETTING_SECTIONS } from '../domain/settings-schema.js';
import { EDITOR_SETTINGS_SECTION } from './editor-settings.js';
import { GENERAL_SETTINGS_SECTION } from './general-settings.js';
import { PERFORMANCE_SETTINGS_SECTION } from './performance-settings.js';
import { SAVE_SETTINGS_SECTION } from './save-settings.js';
import { TOOLBAR_SETTINGS_SECTION } from './toolbar-settings.js';

const DEFINITIONS = Object.freeze([
  GENERAL_SETTINGS_SECTION,
  EDITOR_SETTINGS_SECTION,
  SAVE_SETTINGS_SECTION,
  TOOLBAR_SETTINGS_SECTION,
  PERFORMANCE_SETTINGS_SECTION
]);
const EXPECTED_SECTION_IDS = Object.freeze([
  SETTING_SECTIONS.GENERAL,
  SETTING_SECTIONS.EDITOR,
  SETTING_SECTIONS.SAVE,
  SETTING_SECTIONS.TOOLBAR,
  SETTING_SECTIONS.PERFORMANCE
]);
const actualSectionIds = DEFINITIONS.map(section => section.id);
if (actualSectionIds.some((id, index) => id !== EXPECTED_SECTION_IDS[index])) {
  throw new Error('Settings section registry order does not match the Stage 4 section contract.');
}
const fieldIds = DEFINITIONS.flatMap(section => section.fields.map(field => field.settingId));
if (fieldIds.length !== SETTING_IDS.length || new Set(fieldIds).size !== SETTING_IDS.length) {
  throw new Error('Settings section registry must describe every setting exactly once.');
}
for (const settingId of SETTING_IDS) {
  if (!fieldIds.includes(settingId)) throw new Error(`Settings section registry is missing ${settingId}.`);
}

const BY_ID = Object.freeze(Object.fromEntries(DEFINITIONS.map(section => [section.id, section])));

export {
  EDITOR_SETTINGS_SECTION,
  GENERAL_SETTINGS_SECTION,
  PERFORMANCE_SETTINGS_SECTION,
  SAVE_SETTINGS_SECTION,
  TOOLBAR_SETTINGS_SECTION
};
export const SETTINGS_SECTION_IDS = Object.freeze([...EXPECTED_SECTION_IDS]);
export const SETTINGS_SECTION_DEFINITIONS = DEFINITIONS;

export function getSettingsSectionDefinition(id) {
  return BY_ID[String(id || '')] || null;
}

export function listSettingsSectionDefinitions() {
  return DEFINITIONS;
}
