/**
 * Responsibility: Browser image MIME, byte limits and confirmation decisions.
 * Imports: None. Exports: isAllowedImageMime, assessBrowserImage.
 * State/side effects: None; native file limits remain enforced by Rust Image Reader.
 * Lifecycle: Pure metadata functions; no start/destroy required.
 */
const MAX_BROWSER_IMAGE_BYTES = 5 * 1024 * 1024;
const DIALOG_CONFIRM_BYTES = 2 * 1024 * 1024;

/** Preserve browser image/* acceptance, including BMP; native paths use File Kind. */
export function isAllowedImageMime(type) {
  return typeof type === 'string' && type.startsWith('image/');
}

/** Call after text-first drop routing; dialog selections intentionally use MIME only. */
export function assessBrowserImage(file, { source = 'drop' } = {}) {
  if (source !== 'drop' && source !== 'dialog') throw new TypeError('Unknown browser image source.');
  if (!file || typeof file !== 'object' || Array.isArray(file) || !isAllowedImageMime(file.type)) {
    return Object.freeze({ allowed: false, reason: 'unsupported', requiresConfirmation: false });
  }
  if (file.size > MAX_BROWSER_IMAGE_BYTES) {
    return Object.freeze({ allowed: false, reason: 'too-large', requiresConfirmation: false });
  }
  return Object.freeze({
    allowed: true,
    reason: null,
    requiresConfirmation: source === 'dialog' && file.size > DIALOG_CONFIRM_BYTES
  });
}
