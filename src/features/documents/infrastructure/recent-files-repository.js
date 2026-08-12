/**
 * Responsibility: Own the bounded recent-file list, case-insensitive path dedupe, read-only snapshots/events and legacy Web Storage serialization.
 * State/side effects: Owns recent-file entries plus storage I/O and synchronous subscriber publication. Never owns menu DOM, document sessions, editor/model state or platform file I/O.
 */
import { createRecentFileEntry, normalizeRecentFilePath } from '../domain/recent-file-entry.js';

const RECENT_FILES_KEY = 'md_editor_recent_files';
const DEFAULT_MAX_ENTRIES = 20;
const EMPTY_ENTRIES = Object.freeze([]);

function getFileNameFromPath(path) {
  const normalizedPath = normalizeRecentFilePath(path).replace(/\\/g, '/');
  const name = normalizedPath.split('/').pop()?.trim() || '';
  return name || '未命名文件';
}

function createPathKey(path) {
  return normalizeRecentFilePath(path).toLocaleLowerCase();
}

function freezeEntries(entries) {
  return entries.length ? Object.freeze(entries.slice()) : EMPTY_ENTRIES;
}

function sameEntries(left, right) {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return entry === other || (
      entry?.path === other?.path &&
      entry?.name === other?.name &&
      entry?.openedAt === other?.openedAt
    );
  });
}

function createSnapshot(entries, revision) {
  return Object.freeze({ entries, revision });
}

export function createRecentFilesRepository({
  storage,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = Date.now,
  reportError = (message, error) => console.warn(message, error)
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('Recent files repository requires a Web Storage compatible object.');
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError('Recent files repository maxEntries must be a positive integer.');
  }
  if (typeof now !== 'function') throw new TypeError('Recent files repository clock must be a function.');
  if (typeof reportError !== 'function') throw new TypeError('Recent files repository error reporter must be a function.');

  let destroyed = false;
  let entries = EMPTY_ENTRIES;
  let revision = 0;
  let snapshot = createSnapshot(entries, revision);
  const listeners = new Set();

  const assertActive = () => {
    if (destroyed) throw new Error('Recent files repository has been destroyed.');
  };

  const persist = () => {
    assertActive();
    try {
      storage.setItem(RECENT_FILES_KEY, JSON.stringify(entries));
      return true;
    } catch (error) {
      reportError('Recent file storage failed:', error);
      return false;
    }
  };

  const publish = (reason, previous) => {
    if (!previous || destroyed) return snapshot;
    const event = Object.freeze({
      type: 'documents:recent-files-changed',
      reason: String(reason || 'update'),
      previous,
      snapshot
    });
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        reportError('Recent files listener failed:', error);
      }
    }
    return snapshot;
  };

  const replaceEntries = nextEntries => {
    assertActive();
    const frozen = freezeEntries(nextEntries);
    if (sameEntries(entries, frozen)) return null;
    const previous = snapshot;
    entries = frozen;
    revision += 1;
    snapshot = createSnapshot(entries, revision);
    return previous;
  };

  const normalizeStoredEntries = value => {
    const source = Array.isArray(value) ? value : [];
    const next = [];
    const seen = new Set();
    for (const item of source) {
      if (!item) continue;
      const path = normalizeRecentFilePath(item.path);
      if (!path) continue;
      const key = createPathKey(path);
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(createRecentFileEntry({
        path,
        name: item.name || getFileNameFromPath(path),
        openedAt: Number(item.openedAt) || 0,
        fallbackName: '未命名文件'
      }));
      if (next.length >= maxEntries) break;
    }
    return next;
  };

  const load = () => {
    assertActive();
    let parsed;
    try {
      parsed = JSON.parse(storage.getItem(RECENT_FILES_KEY) || '[]');
    } catch (_) {
      const previous = replaceEntries(EMPTY_ENTRIES);
      publish('load-failed', previous);
      return Object.freeze({ entries, persisted: false, readFailed: true });
    }
    const previous = replaceEntries(normalizeStoredEntries(parsed));
    const persisted = persist();
    publish('load', previous);
    return Object.freeze({ entries, persisted, readFailed: false });
  };

  const add = (path, options = {}) => {
    assertActive();
    const normalizedPath = normalizeRecentFilePath(path);
    if (!normalizedPath) {
      return Object.freeze({ added: false, persisted: null, entries });
    }
    const pathKey = createPathKey(normalizedPath);
    const next = entries.filter(item => createPathKey(item.path) !== pathKey);
    next.unshift(createRecentFileEntry({
      path: normalizedPath,
      name: options.name || getFileNameFromPath(normalizedPath),
      openedAt: options.openedAt,
      fallbackName: options.fallbackName ?? '未命名文件'
    }, { now }));
    const previous = replaceEntries(next.slice(0, maxEntries));
    const persisted = persist();
    publish('add', previous);
    return Object.freeze({ added: true, persisted, entries });
  };

  const clear = () => {
    assertActive();
    const previous = replaceEntries(EMPTY_ENTRIES);
    const persisted = persist();
    publish('clear', previous);
    return Object.freeze({ cleared: true, persisted, entries });
  };

  return Object.freeze({
    get snapshot() {
      assertActive();
      return snapshot;
    },
    get entries() {
      assertActive();
      return entries;
    },
    get maxEntries() {
      assertActive();
      return maxEntries;
    },
    load,
    add,
    clear,
    subscribe(listener) {
      assertActive();
      if (typeof listener !== 'function') throw new TypeError('Recent files repository listener must be a function.');
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      entries = EMPTY_ENTRIES;
    }
  });
}
