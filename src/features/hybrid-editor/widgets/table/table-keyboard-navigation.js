/**
 * Atomic 8.9 Table keyboard-navigation owner.
 * Allowed imports: none. Forbidden imports: CodeMirror, model-kernel, Session and application globals.
 * API: getTableCellTargetKey(), getTableCellNavigationTarget(), scheduleTableCellEdit().
 * State: none. Side effects: optional bounded frame scheduling for post-writeback cell activation.
 */

export function getTableCellTargetKey(rowIndex, columnIndex, rowCount, columnCount, direction) {
  if (!rowCount || !columnCount) return '';
  if (direction === 'down') {
    return rowIndex + 1 < rowCount ? `${rowIndex + 1}:${columnIndex}` : '';
  }
  if (direction === 'up') {
    return rowIndex > 0 ? `${rowIndex - 1}:${columnIndex}` : '';
  }
  const linearIndex = rowIndex * columnCount + columnIndex + (direction === 'previous' ? -1 : 1);
  if (linearIndex < 0 || linearIndex >= rowCount * columnCount) return '';
  return `${Math.floor(linearIndex / columnCount)}:${linearIndex % columnCount}`;
}

export function getTableCellNavigationTarget(event, descriptor = {}) {
  if (event?.key === 'Tab') {
    return getTableCellTargetKey(
      descriptor.rowIndex,
      descriptor.columnIndex,
      descriptor.rowCount,
      descriptor.columnCount,
      event.shiftKey ? 'previous' : 'next'
    );
  }
  if (event?.key === 'Enter') {
    return getTableCellTargetKey(
      descriptor.rowIndex,
      descriptor.columnIndex,
      descriptor.rowCount,
      descriptor.columnCount,
      event.shiftKey ? 'up' : 'down'
    );
  }
  return null;
}

export function scheduleTableCellEdit(tableFrom, cellKey, options = {}) {
  if (!cellKey) return;
  const documentRef = options.documentRef || globalThis.document;
  const scheduleFrame = typeof options.scheduleFrame === 'function'
    ? options.scheduleFrame
    : globalThis.requestAnimationFrame;
  if (!documentRef?.querySelector || typeof scheduleFrame !== 'function') return;
  const attempts = Number.isInteger(options.attempts) ? Math.max(0, options.attempts) : 8;
  const selector = `.cm-hybrid-table-widget[data-hybrid-table-from="${tableFrom}"] [data-hybrid-table-cell-key="${cellKey}"]`;
  const activate = remaining => {
    const cell = documentRef.querySelector(selector);
    if (cell && typeof cell.__markdownEditorActivateTableCell === 'function') {
      cell.__markdownEditorActivateTableCell({ focus: true, select: true, trigger: 'navigation' });
      return;
    }
    if (remaining > 0) scheduleFrame(() => activate(remaining - 1));
  };
  scheduleFrame(() => activate(attempts));
}
