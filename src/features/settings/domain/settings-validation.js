/**
 * Responsibility: Validate and canonicalize typed Settings Schema values without reading or writing persistence.
 * Imports: None; validation definitions are injected by the schema.
 * Exports: isValidSettingValue(), assertValidSettingValue(), normalizeSettingValue().
 * State/side effects: Pure functions only; no DOM, storage, platform or lifecycle side effects.
 */
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function assertValidation(validation) {
  if (!validation || typeof validation !== 'object' || Array.isArray(validation)) {
    throw new TypeError('Setting definition requires validation metadata.');
  }
  return validation;
}

function includes(values, value) {
  return Array.isArray(values) && values.includes(value);
}

function uniqueAllowedValues(values, allowedValues) {
  const output = [];
  for (const value of values) {
    if (!includes(allowedValues, value) || output.includes(value)) continue;
    output.push(value);
  }
  return output;
}

export function isValidSettingValue(definition, value) {
  const validation = assertValidation(definition?.validation);
  switch (validation.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return includes(validation.values, value);
    case 'integer-enum':
      return Number.isInteger(value) && includes(validation.values, value);
    case 'integer-range':
      return Number.isInteger(value) && value >= validation.min && value <= validation.max;
    case 'optional-color':
      return value === '' || (typeof value === 'string' && HEX_COLOR_PATTERN.test(value));
    case 'trimmed-string':
      return typeof value === 'string';
    case 'string-array-subset':
      return Array.isArray(value)
        && value.every(item => typeof item === 'string' && includes(validation.values, item))
        && new Set(value).size === value.length;
    default:
      throw new Error(`Unknown setting validation kind: ${String(validation.kind)}.`);
  }
}

export function assertValidSettingValue(definition, value) {
  if (!isValidSettingValue(definition, value)) {
    throw new TypeError(`Invalid value for setting ${String(definition?.id || '<unknown>')}.`);
  }
  return value;
}

export function normalizeSettingValue(definition, value) {
  assertValidSettingValue(definition, value);
  switch (definition.validation.kind) {
    case 'optional-color':
      return value ? value.toLowerCase() : '';
    case 'trimmed-string':
      return value.trim();
    case 'string-array-subset':
      return Object.freeze(uniqueAllowedValues(value, definition.validation.values));
    default:
      return value;
  }
}
