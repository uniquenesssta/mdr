/**
 * Responsibility: Canonicalize document titles while preserving the legacy Markdown/text extension contract.
 * State/side effects: Pure.
 */
const DOCUMENT_EXTENSION_PATTERN = /\.(md|markdown|txt)$/i;

export function normalizeDocumentTitle(value, fallbackTitle = '未命名文档') {
  let title = String(value ?? '').trim();
  if (!title) title = String(fallbackTitle ?? '').trim() || '未命名文档';
  if (!DOCUMENT_EXTENSION_PATTERN.test(title)) title += '.md';
  return title;
}
