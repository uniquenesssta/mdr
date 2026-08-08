/**
 * Responsibility: Own the validated committed Settings snapshot and exactly one editable draft session, coordinating persistence without DOM knowledge.
 * Imports: Settings domain schema and validation contracts only; persistence is injected.
 * Exports: createSettingsStore().
 * State/side effects: Explicit committed/draft state; persistence occurs only through the injected persist callback on applyDraft()/commit(); no DOM or storage lookup.
 */
import { getSettingDefinition, SETTING_IDS } from '../domain/settings-schema.js';
import { normalizeSettingValue } from '../domain/settings-validation.js';

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function cloneValue(value) {
  return Array.isArray(value) ? Object.freeze([...value]) : value;
}

function valuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

function normalizeChanges(changes, label = 'Settings changes') {
  assertPlainObject(changes, label);
  const normalized = {};
  for (const [id, value] of Object.entries(changes)) {
    const definition = getSettingDefinition(id);
    if (!definition) throw new RangeError(`Unknown setting id: ${id}.`);
    normalized[id] = cloneValue(normalizeSettingValue(definition, value));
  }
  return Object.freeze(normalized);
}

function normalizeFullSnapshot(snapshot) {
  assertPlainObject(snapshot, 'Settings Store initial snapshot');
  const keys = Object.keys(snapshot);
  if (keys.length !== SETTING_IDS.length || keys.some(id => !SETTING_IDS.includes(id))) {
    throw new TypeError('Settings Store initial snapshot must contain exactly every Settings Schema id.');
  }
  const normalized = {};
  for (const id of SETTING_IDS) {
    const definition = getSettingDefinition(id);
    normalized[id] = cloneValue(normalizeSettingValue(definition, snapshot[id]));
  }
  return Object.freeze(normalized);
}

function mergeSnapshot(snapshot, changes) {
  const next = {};
  for (const id of SETTING_IDS) {
    next[id] = cloneValue(Object.hasOwn(changes, id) ? changes[id] : snapshot[id]);
  }
  return Object.freeze(next);
}

function diffSnapshot(previous, next) {
  const changes = {};
  for (const id of SETTING_IDS) {
    if (!valuesEqual(previous[id], next[id])) changes[id] = cloneValue(next[id]);
  }
  return Object.freeze(changes);
}

export function createSettingsStore({ initialSnapshot, persist } = {}) {
  if (typeof persist !== 'function') throw new TypeError('Settings Store requires a persist callback.');

  let committed = normalizeFullSnapshot(initialSnapshot);
  let draft = null;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Settings Store is destroyed.');
  };

  function openDraft() {
    assertActive();
    if (!draft) draft = mergeSnapshot(committed, {});
    return draft;
  }

  function updateDraft(changes) {
    assertActive();
    if (!draft) throw new Error('Settings draft is not open.');
    const normalized = normalizeChanges(changes, 'Settings draft changes');
    draft = mergeSnapshot(draft, normalized);
    return draft;
  }

  function cancelDraft() {
    assertActive();
    if (!draft) return false;
    draft = null;
    return true;
  }

  function applyDraft() {
    assertActive();
    if (!draft) throw new Error('Settings draft is not open.');
    const changes = diffSnapshot(committed, draft);
    if (!Object.keys(changes).length) {
      draft = null;
      return committed;
    }

    // Persist first. A failed save leaves both committed and draft state unchanged.
    persist(changes);
    committed = draft;
    draft = null;
    return committed;
  }

  function commit(changes) {
    assertActive();
    const normalized = normalizeChanges(changes);
    const effective = {};
    for (const [id, value] of Object.entries(normalized)) {
      if (!valuesEqual(committed[id], value)) effective[id] = value;
    }
    const prepared = Object.freeze(effective);
    if (!Object.keys(prepared).length) return committed;

    const previousCommitted = committed;
    persist(prepared);
    committed = mergeSnapshot(previousCommitted, prepared);

    if (draft) {
      const rebased = {};
      for (const id of SETTING_IDS) {
        // Untouched draft fields follow an immediate committed change; user-edited fields stay dirty.
        rebased[id] = Object.hasOwn(prepared, id) && valuesEqual(draft[id], previousCommitted[id])
          ? committed[id]
          : draft[id];
      }
      draft = mergeSnapshot(draft, rebased);
    }
    return committed;
  }

  const api = {
    get snapshot() {
      assertActive();
      return committed;
    },
    get draft() {
      assertActive();
      return draft;
    },
    get hasDraft() {
      assertActive();
      return Boolean(draft);
    },
    get(id) {
      assertActive();
      const definition = getSettingDefinition(id);
      if (!definition) throw new RangeError(`Unknown setting id: ${String(id || '<empty>')}.`);
      return committed[definition.id];
    },
    openDraft,
    updateDraft,
    applyDraft,
    cancelDraft,
    commit,
    set(id, value) {
      const snapshot = commit({ [id]: value });
      return snapshot[id];
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      draft = null;
    }
  };

  return Object.freeze(api);
}
