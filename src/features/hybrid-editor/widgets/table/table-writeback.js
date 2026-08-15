/**
 * Atomic 8.9 Table cell writeback owner.
 * Allowed imports: none; the frozen encodeTableCell capability and CodeMirror history annotation are injected by editor composition.
 * Forbidden imports: CodeMirror packages, model-kernel paths, DOM and application globals.
 * API: writeTableCellValue(). State: none. Side effects: at most one injected editor dispatch per call.
 */

export function writeTableCellValue(view, descriptor, value, originalValue, options = {}) {
  const encodeTableCell = options.encodeTableCell;
  if (typeof encodeTableCell !== 'function') throw new TypeError('Table cell encoder is required');
  const insert = encodeTableCell(value);
  if (insert === encodeTableCell(originalValue)) {
    return { changed: false, failed: false, insert };
  }

  const documentLength = view?.state?.doc?.length;
  const from = Number(descriptor?.cell?.from);
  const to = Number(descriptor?.cell?.to);
  if (!Number.isInteger(documentLength)
    || !Number.isInteger(from)
    || !Number.isInteger(to)
    || from < 0
    || to < from
    || to > documentLength) {
    const error = new Error('表格单元格范围已经失效');
    options.onFailure?.(error, {
      tableFrom: descriptor?.tableFrom,
      row: descriptor?.rowIndex,
      column: descriptor?.columnIndex,
      from,
      to,
      documentLength
    });
    return { changed: false, failed: true, insert };
  }

  try {
    const transaction = { changes: { from, to, insert } };
    const annotation = options.createHistoryAnnotation?.();
    if (annotation !== undefined) transaction.annotations = annotation;
    view.dispatch(transaction);
    options.recordInteraction?.('hybrid.table-cell-edit-commit', {
      tableFrom: descriptor.tableFrom,
      row: descriptor.rowIndex,
      column: descriptor.columnIndex,
      changedChars: insert.length - (to - from)
    });
    return { changed: true, failed: false, insert };
  } catch (error) {
    options.onFailure?.(error, {
      tableFrom: descriptor?.tableFrom,
      row: descriptor?.rowIndex,
      column: descriptor?.columnIndex,
      from,
      to
    });
    return { changed: false, failed: true, insert };
  }
}
