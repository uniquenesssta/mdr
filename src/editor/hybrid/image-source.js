const MAX_CACHE_CHARACTERS = 32 * 1024 * 1024;
const imageCache = new Map();
let cachedCharacters = 0;
let platformFiles = null;
let localImageEnabled = false;

export function configureHybridImageSourcePlatform({ files, enabled = false } = {}) {
  if (!files || typeof files.readImage !== 'function') {
    throw new TypeError('hybrid image source requires a files port');
  }
  platformFiles = files;
  localImageEnabled = Boolean(enabled);
}

function isDirectImageSource(source) {
  return /^(?:data:image\/|blob:|https?:\/\/|asset:)/i.test(source);
}

function currentDocumentContext() {
  return window.markdownEditorRuntimeContext?.getCurrentDocumentContext?.() || {};
}

function touchCache(key, entry) {
  imageCache.delete(key);
  imageCache.set(key, entry);
}

function trimCache() {
  while (cachedCharacters > MAX_CACHE_CHARACTERS && imageCache.size > 1) {
    const oldestKey = imageCache.keys().next().value;
    const oldest = imageCache.get(oldestKey);
    imageCache.delete(oldestKey);
    cachedCharacters -= Number(oldest?.cost) || 0;
  }
}

function cacheResolved(key, value) {
  const cost = String(value?.url || '').length;
  const previous = imageCache.get(key);
  if (previous?.status === 'resolved') cachedCharacters -= Number(previous.cost) || 0;
  const entry = { status: 'resolved', value, cost };
  cachedCharacters += cost;
  touchCache(key, entry);
  trimCache();
  return value;
}

export function invalidateHybridImageSource(source) {
  const context = currentDocumentContext();
  const prefix = `${context.documentId || ''}\0${context.filePath || ''}\0${String(source || '').trim()}`;
  for (const key of [...imageCache.keys()]) {
    if (key === prefix) {
      const entry = imageCache.get(key);
      if (entry?.status === 'resolved') cachedCharacters -= Number(entry.cost) || 0;
      imageCache.delete(key);
    }
  }
}

export async function resolveHybridImageSource(source) {
  const original = String(source || '').trim();
  if (!original) throw new Error('图片地址为空');
  if (/^(?:javascript|vbscript):/i.test(original)) throw new Error('不支持此图片地址');
  if (isDirectImageSource(original)) return { url: original, kind: 'direct', displaySource: original };

  const context = currentDocumentContext();
  if (!localImageEnabled || !platformFiles) {
    return { url: original, kind: 'relative', displaySource: original };
  }

  const key = `${context.documentId || ''}\0${context.filePath || ''}\0${original}`;
  const cached = imageCache.get(key);
  if (cached?.status === 'resolved') {
    touchCache(key, cached);
    return cached.value;
  }
  if (cached?.status === 'pending') return cached.promise;

  const promise = Promise.resolve(platformFiles.readImage(original, context.filePath || ''))
    .then(dataUrl => cacheResolved(key, {
      url: String(dataUrl || ''),
      kind: 'local',
      resolvedPath: original,
      displaySource: original,
      bytes: 0
    }))
    .catch(error => {
      imageCache.delete(key);
      throw error;
    });
  imageCache.set(key, { status: 'pending', promise });
  return promise;
}
