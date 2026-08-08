/**
 * Responsibility: Convert validated setting values to and from the legacy localStorage string representation.
 * Imports: Settings validation only.
 * Exports: serializeSettingValue(), deserializeSettingValue(), shouldOmitSettingValue().
 * State/side effects: Pure conversion only; never reads, writes or removes storage entries.
 */
import { isValidSettingValue, normalizeSettingValue } from './settings-validation.js';

function assertSerialization(definition) {
  const serialization = definition?.serialization;
  if (!serialization || typeof serialization !== 'object' || Array.isArray(serialization)) {
    throw new TypeError('Setting definition requires serialization metadata.');
  }
  return serialization;
}

function cloneDefault(definition) {
  const value = definition.defaultValue;
  return Array.isArray(value) ? Object.freeze([...value]) : value;
}

export function shouldOmitSettingValue(definition, value) {
  const serialization = assertSerialization(definition);
  if (!serialization.omitWhenEmpty) return false;
  if (Array.isArray(value)) return value.length === 0;
  return value === '';
}

export function serializeSettingValue(definition, value) {
  const serialization = assertSerialization(definition);
  const normalized = normalizeSettingValue(definition, value);
  switch (serialization.kind) {
    case 'string':
      return normalized;
    case 'boolean-string':
      return normalized ? 'true' : 'false';
    case 'integer-string':
      return String(normalized);
    case 'json-string-array':
      return JSON.stringify(normalized);
    default:
      throw new Error(`Unknown setting serialization kind: ${String(serialization.kind)}.`);
  }
}

function decodeSerializedValue(serialization, rawValue) {
  switch (serialization.kind) {
    case 'string':
      return String(rawValue);
    case 'boolean-string':
      if (rawValue === 'true') return true;
      if (rawValue === 'false') return false;
      throw new TypeError('Serialized boolean setting must be "true" or "false".');
    case 'integer-string': {
      if (!/^-?\d+$/.test(String(rawValue))) throw new TypeError('Serialized integer setting must contain an integer.');
      return Number(rawValue);
    }
    case 'json-string-array': {
      const parsed = JSON.parse(String(rawValue));
      if (!Array.isArray(parsed)) throw new TypeError('Serialized setting array must decode to an array.');
      return parsed;
    }
    default:
      throw new Error(`Unknown setting serialization kind: ${String(serialization.kind)}.`);
  }
}

export function deserializeSettingValue(definition, rawValue) {
  const serialization = assertSerialization(definition);
  if (rawValue === null || rawValue === undefined) {
    return Object.freeze({ status: 'missing', value: cloneDefault(definition) });
  }

  try {
    const decoded = decodeSerializedValue(serialization, rawValue);
    if (!isValidSettingValue(definition, decoded)) {
      return Object.freeze({ status: 'invalid', value: cloneDefault(definition) });
    }
    return Object.freeze({ status: 'valid', value: normalizeSettingValue(definition, decoded) });
  } catch {
    return Object.freeze({ status: 'invalid', value: cloneDefault(definition) });
  }
}
