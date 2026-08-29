/**
 * Responsibility: Own persisted Outline collapse state for heading IDs.
 * Imports: None; storage and error reporting are injected.
 * Exports: OUTLINE_COLLAPSE_STORAGE_KEY, createOutlineCollapseStore.
 * State/side effects: Sole owner of the in-memory collapsed-ID set and exact persisted key md_editor_outline_collapsed.
 * Lifecycle: Explicit restore/destroy; persistence failures are reported without discarding the current in-memory state.
 */

export const OUTLINE_COLLAPSE_STORAGE_KEY = 'md_editor_outline_collapsed';

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

function parseCollapsedIds(raw) {
  if (raw === null || raw === undefined || raw === '') return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return [];
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  return Object.entries(parsed)
    .filter(([id, collapsed]) => Boolean(String(id || '').trim()) && collapsed === true)
    .map(([id]) => String(id));
}

export function createOutlineCollapseStore({
  storage,
  reportError = (message, error) => console.error(message, error)
} = {}) {
  if (!storage || typeof storage !== 'object') throw new TypeError('Outline collapse storage is required.');
  requireFunction(storage.get, 'Outline collapse storage.get');
  requireFunction(storage.set, 'Outline collapse storage.set');
  requireFunction(reportError, 'Outline collapse error reporter');

  const collapsedIds = new Set();
  let restored = false;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('OutlineCollapseStore is destroyed.');
  };

  const snapshot = () => Object.freeze({
    restored,
    collapsedIds: Object.freeze([...collapsedIds].sort())
  });

  async function persist() {
    assertActive();
    const payload = {};
    for (const id of collapsedIds) payload[id] = true;
    try {
      await storage.set(OUTLINE_COLLAPSE_STORAGE_KEY, JSON.stringify(payload));
      return Object.freeze({ ok: true, persisted: true });
    } catch (error) {
      reportError('Outline collapse persistence failed.', error);
      return Object.freeze({ ok: false, persisted: false, reason: 'persistence-failed', error });
    }
  }

  const store = Object.freeze({
    restore() {
      assertActive();
      if (restored) return snapshot();
      collapsedIds.clear();
      let raw = null;
      try {
        raw = storage.get(OUTLINE_COLLAPSE_STORAGE_KEY);
      } catch (error) {
        reportError('Outline collapse restore failed.', error);
      }
      for (const id of parseCollapsedIds(raw)) collapsedIds.add(id);
      restored = true;
      return snapshot();
    },
    get snapshot() {
      assertActive();
      return snapshot();
    },
    isCollapsed(id) {
      assertActive();
      return collapsedIds.has(String(id || ''));
    },
    toggle(id) {
      assertActive();
      const key = String(id || '').trim();
      if (!key) return Promise.resolve(Object.freeze({ ok: false, reason: 'invalid-id' }));
      if (collapsedIds.has(key)) collapsedIds.delete(key);
      else collapsedIds.add(key);
      return persist();
    },
    collapse(id) {
      assertActive();
      const key = String(id || '').trim();
      if (!key) return Promise.resolve(Object.freeze({ ok: false, reason: 'invalid-id' }));
      collapsedIds.add(key);
      return persist();
    },
    expandAll() {
      assertActive();
      if (!collapsedIds.size) return Promise.resolve(Object.freeze({ ok: true, persisted: false }));
      collapsedIds.clear();
      return persist();
    },
    collapseAll(ids) {
      assertActive();
      collapsedIds.clear();
      for (const id of ids || []) {
        const key = String(id || '').trim();
        if (key) collapsedIds.add(key);
      }
      return persist();
    },
    destroy() {
      if (destroyed) return;
      collapsedIds.clear();
      restored = false;
      destroyed = true;
    }
  });
  return store;
}
