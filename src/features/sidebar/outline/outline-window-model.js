/** Flatten only expanded outline rows; retain the full tree in the controller. */
export function collectOutlineWindowRows(tree, isCollapsed) {
  const rows = []; let total = 0;
  function visit(nodes, depth, visible) {
    for (const node of nodes || []) {
      total++;
      if (visible) rows.push({ node, depth });
      visit(node.children, depth + 1, visible && !isCollapsed(node.id));
    }
  }
  visit(tree, 0, true);
  return { rows, total };
}

export function outlineWindowRange(length, top, height, rowHeight = 36) {
  const start = Math.max(0, Math.floor(top / rowHeight) - 6);
  return { start: Math.min(start, length), end: Math.min(length, Math.ceil((top + Math.max(height, rowHeight)) / rowHeight) + 6) };
}
