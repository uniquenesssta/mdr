/**
 * Atomic 8.10 hybrid image source cache.
 * Owns pending/resolved cache entries, bounded character cost and exact-key invalidation only.
 * It does not know document context, platform files, DOM, widgets or retry policy.
 */
const MAX_CACHE_CHARACTERS = 32 * 1024 * 1024;
const imageSourceCache = new Map();
let cachedCharacters = 0;

function touch(key, entry) {
  imageSourceCache.delete(key);
  imageSourceCache.set(key, entry);
}

function subtractResolvedCost(entry) {
  if (entry?.status === 'resolved') {
    cachedCharacters -= Number(entry.cost) || 0;
    if (cachedCharacters < 0) cachedCharacters = 0;
  }
}

function trim() {
  while (cachedCharacters > MAX_CACHE_CHARACTERS && imageSourceCache.size > 1) {
    const oldestKey = imageSourceCache.keys().next().value;
    const oldest = imageSourceCache.get(oldestKey);
    imageSourceCache.delete(oldestKey);
    subtractResolvedCost(oldest);
  }
}

export function getHybridImageSourceCacheEntry(key) {
  const normalizedKey = String(key || '');
  const entry = imageSourceCache.get(normalizedKey) || null;
  if (entry?.status === 'resolved') touch(normalizedKey, entry);
  return entry;
}

export function setHybridImageSourceCachePending(key, promise) {
  const normalizedKey = String(key || '');
  const previous = imageSourceCache.get(normalizedKey);
  subtractResolvedCost(previous);
  imageSourceCache.set(normalizedKey, { status: 'pending', promise });
  return promise;
}

export function setHybridImageSourceCacheResolved(key, value) {
  const normalizedKey = String(key || '');
  const previous = imageSourceCache.get(normalizedKey);
  subtractResolvedCost(previous);
  const cost = String(value?.url || '').length;
  const entry = { status: 'resolved', value, cost };
  cachedCharacters += cost;
  touch(normalizedKey, entry);
  trim();
  return value;
}

export function invalidateHybridImageSourceCacheKey(key) {
  const normalizedKey = String(key || '');
  const entry = imageSourceCache.get(normalizedKey);
  if (!entry) return false;
  imageSourceCache.delete(normalizedKey);
  subtractResolvedCost(entry);
  return true;
}
