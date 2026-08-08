/**
 * Responsibility: Validate and freeze one Settings section descriptor against the authoritative Settings Schema.
 * Imports: Settings domain schema only; never UI, application, editor, preview, platform or persistence implementations.
 * Exports: defineSettingsSection().
 * State/side effects: Pure functions and immutable module constants only; no DOM, storage, business calls or lifecycle resources.
 */
import { SETTING_SECTIONS, getSettingDefinition } from '../domain/settings-schema.js';

const SECTION_IDS = Object.freeze(Object.values(SETTING_SECTIONS));
const FIELD_SURFACES = Object.freeze(['settings-dialog', 'external']);
const CONTROL_VALIDATION_KINDS = Object.freeze({
  select: Object.freeze(['enum', 'integer-enum']),
  toggle: Object.freeze(['boolean']),
  color: Object.freeze(['optional-color']),
  duration: Object.freeze(['integer-range']),
  directory: Object.freeze(['trimmed-string']),
  checklist: Object.freeze(['string-array-subset'])
});

function assertString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`Settings section ${label} must be a non-empty string.`);
  return normalized;
}

function defineField(sectionId, field) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    throw new TypeError(`Settings section ${sectionId} field must be an object.`);
  }
  const settingId = assertString(field.settingId, 'field settingId');
  const control = assertString(field.control, 'field control');
  const surface = assertString(field.surface, 'field surface');
  const definition = getSettingDefinition(settingId);
  if (!definition) throw new Error(`Unknown setting ${settingId} in section ${sectionId}.`);
  if (definition.section !== sectionId) {
    throw new Error(`Setting ${settingId} belongs to ${definition.section}, not ${sectionId}.`);
  }
  const allowedValidationKinds = CONTROL_VALIDATION_KINDS[control];
  if (!allowedValidationKinds) throw new Error(`Unknown Settings field control ${control}.`);
  if (!allowedValidationKinds.includes(definition.validation.kind)) {
    throw new Error(`Control ${control} is incompatible with ${settingId} validation ${definition.validation.kind}.`);
  }
  if (!FIELD_SURFACES.includes(surface)) throw new Error(`Unknown Settings field surface ${surface}.`);
  return Object.freeze({ settingId, control, surface });
}

export function defineSettingsSection({ id, fields } = {}) {
  const sectionId = assertString(id, 'id');
  if (!SECTION_IDS.includes(sectionId)) throw new Error(`Unknown Settings section ${sectionId}.`);
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new TypeError(`Settings section ${sectionId} requires at least one field.`);
  }
  const normalizedFields = fields.map(field => defineField(sectionId, field));
  const settingIds = normalizedFields.map(field => field.settingId);
  if (new Set(settingIds).size !== settingIds.length) {
    throw new Error(`Settings section ${sectionId} contains duplicate setting ids.`);
  }
  return Object.freeze({ id: sectionId, fields: Object.freeze(normalizedFields) });
}
