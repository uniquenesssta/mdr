/**
 * Responsibility: Classify import metadata without reading content or enforcing size policy.
 * Imports: Image Policy MIME predicate. Exports: IMPORT_KINDS and File/path/result classifiers.
 * State/side effects: None. Lifecycle: Pure functions; no start/destroy required.
 */
import { isAllowedImageMime } from '../images/image-policy.js';
export const IMPORT_KINDS = Object.freeze({ TEXT: 'text', IMAGE: 'image', UNSUPPORTED: 'unsupported' });
const TEXT_EXTENSIONS = Object.freeze(['md', 'markdown', 'txt']);
const IMAGE_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const metadata = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const extension = name => typeof name === 'string' ? name.split('.').pop().toLowerCase() : '';

/** Browser drop prefers text names; image-dialog selection intentionally uses MIME only. */
export function classifyBrowserFile(file, { imageOnly = false } = {}) {
  if (!metadata(file)) return IMPORT_KINDS.UNSUPPORTED;
  if (!imageOnly && TEXT_EXTENSIONS.includes(extension(file.name))) return IMPORT_KINDS.TEXT;
  return isAllowedImageMime(file.type)
    ? IMPORT_KINDS.IMAGE : IMPORT_KINDS.UNSUPPORTED;
}

/** Native paths keep the existing extension policy, independently of browser MIME. */
export function classifyImportPath(path) {
  if (typeof path !== 'string') return IMPORT_KINDS.UNSUPPORTED;
  const name = path.trim().split(/[\\/]/).pop();
  const ext = extension(name);
  if (TEXT_EXTENSIONS.includes(ext)) return IMPORT_KINDS.TEXT;
  if (IMAGE_EXTENSIONS.includes(ext)) return IMPORT_KINDS.IMAGE;
  return IMPORT_KINDS.UNSUPPORTED;
}

/** Normalize a returned native kind; content, MIME and filename cannot override it. */
export function classifyImportResult(result) {
  if (!metadata(result)) return IMPORT_KINDS.UNSUPPORTED;
  const kind = result.kind;
  return kind === IMPORT_KINDS.TEXT || kind === IMPORT_KINDS.IMAGE ? kind : IMPORT_KINDS.UNSUPPORTED;
}
