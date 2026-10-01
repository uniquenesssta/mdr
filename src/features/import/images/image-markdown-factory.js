/**
 * Responsibility: Serialize one Markdown image using the existing image-command contract.
 * Imports: None. Exports: createImageMarkdown.
 * State/side effects: None; no file reads, DOM, URL resolution or protocol policy.
 * Lifecycle: Pure function; no resources to destroy.
 */
export function createImageMarkdown(url, options = {}) {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) throw new TypeError('Image URL must not be empty.');
  const fallbackAlt = String(options.fallbackAlt || '图片');
  const safeAlt = String(options.alt || fallbackAlt).replace(/\]/g, '\\]');
  return `![${safeAlt}](${normalizedUrl})`;
}
