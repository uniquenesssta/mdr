/**
 * Responsibility: Own the immutable metadata-only document session list, active document id and session change events.
 * State/side effects: Explicit in-memory instance state; synchronous event publication only. Never owns document body, DOM, storage or model objects.
 */
import { createDocumentRecord, updateDocumentRecord } from '../domain/document-record.js';

export const DOCUMENT_SESSION_CHANGED_EVENT = 'documents:session-changed';

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeRecord(record) {
  return createDocumentRecord(record);
}

function normalizeRecords(records) {
  if (!Array.isArray(records)) throw new TypeError('Document session records must be an array.');
  const normalized = records.map(normalizeRecord);
  const ids = new Set();
  for (const record of normalized) {
    if (ids.has(record.id)) throw new Error('Document session contains a duplicate document id: ' + record.id);
    ids.add(record.id);
  }
  return Object.freeze(normalized);
}

function normalizeActiveId(value, records) {
  if (value === undefined || value === null || value === '') return null;
  const activeId = String(value);
  if (!records.some(record => record.id === activeId)) {
    throw new Error('Active document id does not exist in the session: ' + activeId);
  }
  return activeId;
}

function sameRecord(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => hasOwn(right, key) && Object.is(left[key], right[key]));
}

function sameRecords(left, right) {
  return left.length === right.length && left.every((record, index) => sameRecord(record, right[index]));
}

function createSnapshot(records, activeId, revision) {
  return Object.freeze({ records, activeId, revision });
}

export function createDocumentSessionStore({
  initialRecords = [],
  activeId = null,
  reportListenerError = error => console.error('Document session listener failed:', error)
} = {}) {
  if (typeof reportListenerError !== 'function') {
    throw new TypeError('Document session listener error reporter must be a function.');
  }

  let destroyed = false;
  let records = normalizeRecords(initialRecords);
  let currentActiveId = normalizeActiveId(activeId, records);
  let revision = 0;
  let snapshot = createSnapshot(records, currentActiveId, revision);
  const listeners = new Set();

  const assertActive = () => {
    if (destroyed) throw new Error('Document session store has been destroyed.');
  };

  const publish = (previous, reason, changedId = null) => {
    const event = Object.freeze({
      type: DOCUMENT_SESSION_CHANGED_EVENT,
      reason: String(reason || 'update'),
      changedId: changedId === undefined || changedId === null ? null : String(changedId),
      revision,
      previous,
      snapshot
    });
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        reportListenerError(error, event);
      }
    }
    return snapshot;
  };

  const commit = (nextRecords, nextActiveId, reason, changedId = null) => {
    assertActive();
    const normalizedRecords = normalizeRecords(nextRecords);
    const normalizedActiveId = normalizeActiveId(nextActiveId, normalizedRecords);
    if (sameRecords(records, normalizedRecords) && currentActiveId === normalizedActiveId) return snapshot;
    const previous = snapshot;
    records = normalizedRecords;
    currentActiveId = normalizedActiveId;
    revision += 1;
    snapshot = createSnapshot(records, currentActiveId, revision);
    return publish(previous, reason, changedId);
  };

  const api = {
    get snapshot() { assertActive(); return snapshot; },
    get records() { assertActive(); return records; },
    get activeId() { assertActive(); return currentActiveId; },
    getRecord(documentId) {
      assertActive();
      const id = String(documentId ?? '');
      return records.find(record => record.id === id) || null;
    },
    getActiveRecord() {
      assertActive();
      return currentActiveId ? records.find(record => record.id === currentActiveId) || null : null;
    },
    replaceRecords(nextRecords, options = {}) {
      assertActive();
      const nextActiveId = hasOwn(options, 'activeId') ? options.activeId : currentActiveId;
      return commit(nextRecords, nextActiveId, options.reason || 'replace');
    },
    insertRecord(record, options = {}) {
      assertActive();
      const normalized = normalizeRecord(record);
      if (records.some(item => item.id === normalized.id)) {
        throw new Error('Document session already contains document id: ' + normalized.id);
      }
      const index = Math.max(0, Math.min(records.length, Number.isFinite(Number(options.index)) ? Math.trunc(Number(options.index)) : 0));
      const nextRecords = [...records];
      nextRecords.splice(index, 0, normalized);
      const nextActiveId = options.activate === true ? normalized.id : currentActiveId;
      return commit(nextRecords, nextActiveId, options.reason || 'insert', normalized.id);
    },
    updateRecord(documentId, patch = {}, options = {}) {
      assertActive();
      const id = String(documentId ?? '');
      const index = records.findIndex(record => record.id === id);
      if (index < 0) throw new Error('Document session record does not exist: ' + id);
      const updated = updateDocumentRecord(records[index], patch, options);
      if (sameRecord(records[index], updated)) return records[index];
      const nextRecords = [...records];
      nextRecords[index] = updated;
      commit(nextRecords, currentActiveId, options.reason || 'update', id);
      return records[index];
    },
    setActive(documentId, options = {}) {
      assertActive();
      const nextActiveId = documentId === undefined || documentId === null || documentId === '' ? null : String(documentId);
      commit(records, nextActiveId, options.reason || 'activate', nextActiveId);
      return currentActiveId;
    },
    removeRecord(documentId, options = {}) {
      assertActive();
      const id = String(documentId ?? '');
      const index = records.findIndex(record => record.id === id);
      if (index < 0) return null;
      const removed = records[index];
      const nextRecords = records.filter(record => record.id !== id);
      let nextActiveId = currentActiveId;
      if (hasOwn(options, 'activeId')) nextActiveId = options.activeId;
      else if (currentActiveId === id) nextActiveId = null;
      commit(nextRecords, nextActiveId, options.reason || 'remove', id);
      return removed;
    },
    reset(options = {}) {
      assertActive();
      return commit([], null, options.reason || 'reset');
    },
    subscribe(listener) {
      assertActive();
      if (typeof listener !== 'function') throw new TypeError('Document session listener must be a function.');
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
    }
  };

  return Object.freeze(api);
}
