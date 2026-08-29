/**
 * Responsibility: Resolve the active Outline heading for a source line from an already-normalized heading index.
 * Imports: None; must not read DOM, editor text, storage, Preview internals or browser globals.
 * Exports: resolveActiveOutlineHeading.
 * State/side effects: None.
 * Lifecycle: Pure function only.
 */

export function resolveActiveOutlineHeading(headings, line) {
  const items = Array.isArray(headings) ? headings : [];
  if (!items.length) return null;
  const targetLine = Math.max(1, Math.floor(Number(line) || 1));
  if (targetLine < items[0].line) return items[0];
  let low = 0;
  let high = items.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (items[mid].line <= targetLine) low = mid;
    else high = mid - 1;
  }
  return items[low] || null;
}
