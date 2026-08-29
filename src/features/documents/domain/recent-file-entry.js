/**
 * Responsibility: Build immutable recent-file entries using the preserved {path,name,openedAt} persistence surface without narrowing legacy numeric values.
 * State/side effects: Pure except for an explicitly injected clock when openedAt is omitted.
 */
export function normalizeRecentFilePath(value) {
  return String(value ?? '').trim();
}

function deriveFileName(path) {
  const segments = String(path).split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || '';
}

export function createRecentFileEntry(input = {}, { now = Date.now } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Recent file entry input must be an object.');
  }
  const path = normalizeRecentFilePath(input.path);
  if (!path) throw new TypeError('Recent file path must not be empty.');
  const fallbackName = String(input.fallbackName ?? '未命名文件');
  const name = String(input.name || deriveFileName(path) || fallbackName);
  const rawOpenedAt = input.openedAt === undefined || input.openedAt === null || input.openedAt === ''
    ? now()
    : input.openedAt;
  const openedAt = Number(rawOpenedAt) || 0;
  return Object.freeze({ path, name, openedAt });
}
