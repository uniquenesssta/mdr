/**
 * Responsibility: Own the bounded recent-file list, case-insensitive path dedupe and legacy Web Storage serialization.
 * State/side effects: Owns only recent-file entries plus storage I/O. Never owns menu DOM, document sessions, editor/model state or platform file I/O.
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
      entries = EMPTY_ENTRIES;
      return Object.freeze({ entries, persisted: false, readFailed: true });
    }
    entries = freezeEntries(normalizeStoredEntries(parsed));
    const persisted = persist();
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
    entries = freezeEntries(next.slice(0, maxEntries));
    const persisted = persist();
    return Object.freeze({ added: true, persisted, entries });
  };

  const clear = () => {
    assertActive();
    entries = EMPTY_ENTRIES;
    const persisted = persist();
    return Object.freeze({ cleared: true, persisted, entries });
  };

  return Object.freeze({
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
    destroy() {
      if (destroyed) return;
      destroyed = true;
      entries = EMPTY_ENTRIES;
    }
  });
}
