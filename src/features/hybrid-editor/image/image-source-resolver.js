/**
 * Atomic 8.10 hybrid image source resolver.
 * Owns source validation, explicit platform/context configuration and local-path resolution.
 * Cache state is delegated to image-source-cache; DOM, retry UI and widget lifecycle are outside this module.
 */
import {
  getHybridImageSourceCacheEntry,
  invalidateHybridImageSourceCacheKey,
  setHybridImageSourceCachePending,
  setHybridImageSourceCacheResolved
} from './image-source-cache.js';

let platformFiles = null;
let localImageEnabled = false;
let getDocumentContext = () => ({});

function isDirectImageSource(source) {
  return /^(?:data:image\/|blob:|https?:\/\/|asset:)/i.test(source);
}

function readDocumentContext() {
  const context = getDocumentContext?.();
  return context && typeof context === 'object' ? context : {};
}

function createCacheKey(source, context = readDocumentContext()) {
  return `${context.documentId || ''}\0${context.filePath || ''}\0${String(source || '').trim()}`;
}

export function configureHybridImageSourcePlatform({
  files,
  enabled = false,
  getDocumentContext: contextProvider = null
} = {}) {
  if (!files || typeof files.readImage !== 'function') {
    throw new TypeError('hybrid image source requires a files port');
  }
  platformFiles = files;
  localImageEnabled = Boolean(enabled);
  getDocumentContext = typeof contextProvider === 'function' ? contextProvider : () => ({});
}

export function invalidateHybridImageSource(source) {
  return invalidateHybridImageSourceCacheKey(createCacheKey(source));
}

export async function resolveHybridImageSource(source) {
  const original = String(source || '').trim();
  if (!original) throw new Error('图片地址为空');
  if (/^(?:javascript|vbscript):/i.test(original)) throw new Error('不支持此图片地址');
  if (isDirectImageSource(original)) {
    return { url: original, kind: 'direct', displaySource: original };
  }

  const context = readDocumentContext();
  if (!localImageEnabled || !platformFiles) {
    return { url: original, kind: 'relative', displaySource: original };
  }

  const key = createCacheKey(original, context);
  const cached = getHybridImageSourceCacheEntry(key);
  if (cached?.status === 'resolved') return cached.value;
  if (cached?.status === 'pending') return cached.promise;

  const promise = Promise.resolve(platformFiles.readImage(original, context.filePath || ''))
    .then(dataUrl => setHybridImageSourceCacheResolved(key, {
      url: String(dataUrl || ''),
      kind: 'local',
      resolvedPath: original,
      displaySource: original,
      bytes: 0
    }))
    .catch(error => {
      invalidateHybridImageSourceCacheKey(key);
      throw error;
    });
  setHybridImageSourceCachePending(key, promise);
  return promise;
}
