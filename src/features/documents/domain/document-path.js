/**
 * Responsibility: Normalize optional document file paths without interpreting platform-specific path syntax.
 * State/side effects: Pure.
 */
export function normalizeDocumentPath(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}
