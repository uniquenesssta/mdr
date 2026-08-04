const EDITABLE_BLOCK_NODES = new Set([
  'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
  'SetextHeading1', 'SetextHeading2', 'Paragraph', 'Blockquote', 'ListItem', 'FencedCode',
  'IndentedCode', 'HTMLBlock', 'Table', 'HorizontalRule'
]);

export function mergeRanges(ranges) {
  const sorted = Array.from(ranges || [], range => ({
    from: Math.max(0, Number(range?.from) || 0),
    to: Math.max(Number(range?.from) || 0, Number(range?.to) || 0),
    revealBlock: Boolean(range?.revealBlock)
  })).sort((left, right) => left.from - right.from || left.to - right.to);
  const merged = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.from > previous.to + 1) merged.push(range);
    else {
      previous.to = Math.max(previous.to, range.to);
      previous.revealBlock = previous.revealBlock || range.revealBlock;
    }
  }
  return merged;
}

function findEditableBlock(tree, position, documentLength) {
  const safe = Math.max(0, Math.min(documentLength, Number(position) || 0));
  let node = tree.resolveInner(safe, -1);
  while (node) {
    if (EDITABLE_BLOCK_NODES.has(node.name)) return { from: node.from, to: node.to };
    node = node.parent;
  }
  return null;
}

export function getEditableRanges(view, tree) {
  if (view.hasFocus === false) return [];
  const ranges = [];
  const documentLength = view.state.doc.length;
  const selections = view.state.selection.ranges;
  const mainIndex = view.state.selection.mainIndex;
  for (let index = 0; index < selections.length; index += 1) {
    const selection = selections[index];
    const from = Math.min(selection.anchor, selection.head);
    const to = Math.max(selection.anchor, selection.head);
    if (to > from) {
      // A non-collapsed selection is a visual operation, not an instruction to
      // reveal Markdown source. Keeping the presentation decorations mounted is
      // essential for exact hybrid selection: headings, emphasis, links, and
      // quote prefixes must not turn back into raw markers while the pointer is
      // dragged across them. The selection itself is rendered by the hybrid
      // presentation layer as bounded per-line marks.
      continue;
    }
    // Secondary carets must not make unrelated Markdown blocks fall back to
    // source presentation. Multiple carets are useful for editing, but in
    // hybrid mode revealing every caret's ancestor makes large portions of the
    // document suddenly lose their rendered appearance.
    if (index !== mainIndex) continue;
    const activeBlock = findEditableBlock(tree, from, documentLength);
    if (activeBlock) ranges.push({ ...activeBlock, revealBlock: true });
    else {
      const line = view.state.doc.lineAt(from);
      ranges.push({ from: line.from, to: line.to, revealBlock: true });
    }
  }
  return mergeRanges(ranges);
}

export function intersectsRanges(ranges, from, to = from) {
  for (const range of ranges || []) {
    if (range.from > to) break;
    if (range.revealBlock) {
      if (range.to >= from && range.from <= to) return true;
      continue;
    }
    // Non-collapsed selections use half-open intervals. Treating touching
    // boundaries as intersections reveals adjacent Markdown markers that were
    // not selected and makes the hybrid highlight look wider than the source.
    if (range.from < to && from < range.to) return true;
  }
  return false;
}

export function intersectsRevealRanges(ranges, from, to = from) {
  for (const range of ranges || []) {
    if (range.from > to) break;
    if (range.revealBlock && range.to >= from && range.from <= to) return true;
  }
  return false;
}

export function overlapsRanges(ranges, from, to) {
  return Array.from(ranges || []).some(range => range.from < to && from < range.to);
}

export function collectVisibleLines(view) {
  const lines = [];
  const seen = new Set();
  for (const range of view.visibleRanges) {
    let line = view.state.doc.lineAt(range.from);
    while (line.from <= range.to) {
      if (!seen.has(line.from)) {
        seen.add(line.from);
        lines.push(line);
      }
      if (line.number >= view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }
  return lines;
}

export function getExpandedVisibleRanges(view, characterMargin = 6000) {
  const length = view.state.doc.length;
  return mergeRanges(view.visibleRanges.map(range => ({
    from: Math.max(0, range.from - characterMargin),
    to: Math.min(length, range.to + characterMargin)
  })));
}

export function shouldDecorateSourceActiveLine(editableRanges, blockRanges, from, to) {
  const safeFrom = Math.max(0, Number(from) || 0);
  const safeTo = Math.max(safeFrom + 1, Number(to) || safeFrom);
  return intersectsRevealRanges(editableRanges, safeFrom, safeTo)
    && !overlapsRanges(blockRanges, safeFrom, safeTo);
}
