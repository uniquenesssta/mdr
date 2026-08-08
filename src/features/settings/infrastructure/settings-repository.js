/**
 * Responsibility: Sole persistence owner for Settings Schema values, preserving legacy keys while isolating reads, validation, canonical serialization and rollback-safe writes.
 * Imports: Settings domain contracts only; storage is injected.
 * Exports: createSettingsRepository(), SettingsRepositoryReadError, SettingsRepositoryWriteError.
 * State/side effects: Stateless repository instance; storage I/O occurs only inside load()/save(); no DOM, global storage lookup or lifecycle subscription.
 */
import { getSettingDefinition, SETTING_IDS } from '../domain/settings-schema.js';
import {
  deserializeSettingValue,
  serializeSettingValue,
  shouldOmitSettingValue
} from '../domain/settings-serialization.js';
import { normalizeSettingValue } from '../domain/settings-validation.js';

export class SettingsRepositoryReadError extends Error {
  constructor(definition, cause) {
    super(`Failed to read setting "${definition.id}" from "${definition.key}".`, { cause });
    this.name = 'SettingsRepositoryReadError';
    this.settingId = definition.id;
    this.storageKey = definition.key;
  }
}

export class SettingsRepositoryWriteError extends Error {
  constructor(definition, cause, rollbackErrors = []) {
    super(`Failed to persist setting "${definition.id}" to "${definition.key}".`, { cause });
    this.name = 'SettingsRepositoryWriteError';
    this.settingId = definition.id;
    this.storageKey = definition.key;
    this.rollbackErrors = Object.freeze([...rollbackErrors]);
  }
}

function assertStorage(storage) {
  if (!storage || typeof storage !== 'object') {
    throw new TypeError('Settings Repository requires an injected storage object.');
  }
  for (const method of ['getItem', 'setItem', 'removeItem']) {
    if (typeof storage[method] !== 'function') {
      throw new TypeError(`Settings Repository storage requires ${method}().`);
    }
  }
}

function resolveDefinitions(ids = SETTING_IDS) {
  if (!Array.isArray(ids)) throw new TypeError('Settings Repository load ids must be an array.');
  const seen = new Set();
  return ids.map(id => {
    const normalizedId = String(id || '');
    const definition = getSettingDefinition(normalizedId);
    if (!definition) throw new RangeError(`Unknown setting id: ${normalizedId || '<empty>'}.`);
    if (seen.has(normalizedId)) throw new TypeError(`Duplicate setting id: ${normalizedId}.`);
    seen.add(normalizedId);
    return definition;
  });
}

function readRaw(storage, definition) {
  try {
    return storage.getItem(definition.key);
  } catch (cause) {
    throw new SettingsRepositoryReadError(definition, cause);
  }
}

function restoreRaw(storage, definition, rawValue) {
  if (rawValue === null) storage.removeItem(definition.key);
  else storage.setItem(definition.key, rawValue);
}

function prepareChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new TypeError('Settings Repository save changes must be an object.');
  }
  return Object.entries(changes).map(([id, value]) => {
    const definition = getSettingDefinition(id);
    if (!definition) throw new RangeError(`Unknown setting id: ${id}.`);
    const normalized = normalizeSettingValue(definition, value);
    return Object.freeze({ definition, normalized });
  });
}

export function createSettingsRepository({ storage } = {}) {
  assertStorage(storage);

  function load(ids = SETTING_IDS) {
    const definitions = resolveDefinitions(ids);
    // Read every requested raw value before decoding anything. No read path writes or repairs storage.
    const rawValues = definitions.map(definition => Object.freeze({
      definition,
      rawValue: readRaw(storage, definition)
    }));
    const snapshot = {};
    for (const { definition, rawValue } of rawValues) {
      snapshot[definition.id] = deserializeSettingValue(definition, rawValue).value;
    }
    return Object.freeze(snapshot);
  }

  function save(changes) {
    const prepared = prepareChanges(changes);
    if (!prepared.length) return Object.freeze({});

    // Preflight all reads before the first mutation so a storage read failure cannot overwrite user data.
    const previous = new Map();
    for (const { definition } of prepared) {
      previous.set(definition.id, readRaw(storage, definition));
    }

    const applied = [];
    try {
      for (const item of prepared) {
        const { definition, normalized } = item;
        applied.push(item);
        if (shouldOmitSettingValue(definition, normalized)) {
          storage.removeItem(definition.key);
        } else {
          storage.setItem(definition.key, serializeSettingValue(definition, normalized));
        }
      }
    } catch (cause) {
      const failed = applied[applied.length - 1]?.definition || prepared[0].definition;
      const rollbackErrors = [];
      for (const { definition } of [...applied].reverse()) {
        try {
          restoreRaw(storage, definition, previous.get(definition.id));
        } catch (rollbackError) {
          rollbackErrors.push(Object.freeze({
            settingId: definition.id,
            storageKey: definition.key,
            error: rollbackError
          }));
        }
      }
      throw new SettingsRepositoryWriteError(failed, cause, rollbackErrors);
    }

    return Object.freeze(Object.fromEntries(prepared.map(({ definition, normalized }) => [definition.id, normalized])));
  }

  return Object.freeze({ load, save });
}
