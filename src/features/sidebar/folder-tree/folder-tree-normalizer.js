/**
 * Responsibility: Pure Folder Tree DTO normalization, readable-file filtering and stable node ordering.
 * Imports: None.
 * Exports: SUPPORTED_FOLDER_TREE_EXTENSIONS, normalizeFolderTreeResult.
 * State/side effects: None.
 * Lifecycle: Pure.
 */

export const SUPPORTED_FOLDER_TREE_EXTENSIONS = Object.freeze(['md', 'markdown', 'txt']);
const SUPPORTED_EXTENSIONS = new Set(SUPPORTED_FOLDER_TREE_EXTENSIONS);

function extensionOf(name) {
  const match = String(name || '').toLocaleLowerCase().match(/\.([^.]+)$/);
  return match ? match[1] : '';
}

function sortNodes(nodes) {
  return Array.from(nodes || []).sort((left, right) => {
    const leftDirectory = left?.kind === 'directory';
    const rightDirectory = right?.kind === 'directory';
    if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
    return String(left?.name || '').localeCompare(String(right?.name || ''), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  });
}

function normalizeNode(node) {
  const kind = node?.kind === 'directory' ? 'directory' : 'file';
  const name = String(node?.name || '').trim();
  const path = String(node?.path || '').trim();
  if (!name || !path) return null;
  if (kind === 'file' && !SUPPORTED_EXTENSIONS.has(extensionOf(name))) return null;
  if (kind === 'directory') {
    const children = sortNodes(node?.children).map(normalizeNode).filter(Boolean);
    return Object.freeze({ kind, name, path, children: Object.freeze(children) });
  }
  return Object.freeze({ kind, name, path });
}

export function normalizeFolderTreeResult(result) {
  const rootPath = String(result?.rootPath || '').trim();
  const rootName = String(result?.rootName || '').trim() || rootPath;
  const nodes = sortNodes(result?.nodes).map(normalizeNode).filter(Boolean);
  return Object.freeze({
    rootPath,
    rootName,
    nodes: Object.freeze(nodes),
    fileCount: Math.max(0, Number(result?.fileCount) || 0),
    directoryCount: Math.max(0, Number(result?.directoryCount) || 0),
    skippedCount: Math.max(0, Number(result?.skippedCount) || 0),
    truncated: Boolean(result?.truncated)
  });
}
