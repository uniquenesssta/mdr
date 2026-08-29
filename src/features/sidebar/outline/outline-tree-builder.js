/**
 * Responsibility: Normalize heading indexes already produced by the document/preview indexing pipeline and build the immutable Outline hierarchy.
 * Imports: None; must not read editor text, DOM, storage, browser globals, Preview internals or other feature internals.
 * Exports: normalizeOutlineHeadingIndex, normalizePreviewHeadingBlocks, outlineHeadingIndexesEqual, buildOutlineTree, collectCollapsibleOutlineIds.
 * State/side effects: None.
 * Lifecycle: Pure functions only.
 */

function clampLevel(value) {
  return Math.max(1, Math.min(6, Math.floor(Number(value) || 1)));
}

function normalizeLine(value) {
  return Math.max(1, Math.floor(Number(value) || 1));
}

function simpleHash(text) {
  let hash = 0;
  const value = String(text || '');
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function stripHeadingMarkdown(text) {
  return String(text || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function freezeHeading(item, index = 0) {
  const level = clampLevel(item?.level);
  const line = normalizeLine(item?.line);
  const text = String(item?.text || '').trim();
  const blockId = String(item?.blockId || '').trim();
  const requestedId = String(item?.id || '').trim();
  const id = requestedId || (blockId ? `heading-${blockId}` : `heading-${line}-${level}-${simpleHash(`${text}:${index}`)}`);
  return Object.freeze({ id, blockId, level, text, line });
}

export function normalizeOutlineHeadingIndex(headings) {
  if (!Array.isArray(headings)) return Object.freeze([]);
  const normalized = headings
    .filter(Boolean)
    .map((item, index) => freezeHeading(item, index))
    .sort((left, right) => left.line - right.line || left.level - right.level || left.id.localeCompare(right.id));
  return Object.freeze(normalized);
}

export function normalizePreviewHeadingBlocks(blocks) {
  if (!Array.isArray(blocks)) return Object.freeze([]);
  const headings = [];
  for (const block of blocks) {
    if (!block || block.type !== 'heading') continue;
    const firstLine = String(block.raw || '').split('\n', 1)[0];
    const match = firstLine.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const rawText = match[2].trim();
    const line = normalizeLine(block.startLine);
    const level = clampLevel(match[1].length);
    const blockId = String(block.id || '').trim();
    headings.push({
      id: blockId ? `heading-${blockId}` : `heading-${line}-${level}-${simpleHash(rawText)}`,
      blockId,
      level,
      text: stripHeadingMarkdown(rawText) || rawText,
      line
    });
  }
  return normalizeOutlineHeadingIndex(headings);
}

export function outlineHeadingIndexesEqual(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  return a.length === b.length && a.every((item, index) => {
    const next = b[index];
    return Boolean(next)
      && item.id === next.id
      && item.blockId === next.blockId
      && item.level === next.level
      && item.text === next.text
      && item.line === next.line;
  });
}

function freezeNode(node) {
  return Object.freeze({
    id: node.id,
    blockId: node.blockId,
    level: node.level,
    text: node.text,
    line: node.line,
    children: Object.freeze(node.children.map(freezeNode))
  });
}

export function buildOutlineTree(headings) {
  const normalized = normalizeOutlineHeadingIndex(headings);
  const root = { level: 0, children: [] };
  const stack = [root];
  for (const heading of normalized) {
    const node = { ...heading, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= node.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return Object.freeze(root.children.map(freezeNode));
}

export function collectCollapsibleOutlineIds(nodes, output = []) {
  for (const node of nodes || []) {
    if (!node?.children?.length) continue;
    output.push(node.id);
    collectCollapsibleOutlineIds(node.children, output);
  }
  return output;
}
