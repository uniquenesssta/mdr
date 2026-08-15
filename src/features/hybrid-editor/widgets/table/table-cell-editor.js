/**
 * Atomic 8.9 Table cell direct-editor lifecycle owner.
 * Allowed imports: Table navigation/writeback plus Hybrid outside-pointer Activation.
 * Forbidden imports: CodeMirror packages, model-kernel paths, widget presentation and application globals.
 * API: createTableCellEditor(). State: editor-local cancelled/committed/closed/navigation target flags.
 * Lifecycle: explicit destroy hook removes Session-owned document listener and prevents late close/writeback.
 */
import { bindOutsidePointerClosure } from '../../activation/outside-pointer-closure.js';
import { getTableCellNavigationTarget, scheduleTableCellEdit } from './table-keyboard-navigation.js';
import { writeTableCellValue } from './table-writeback.js';

export function createTableCellEditor(view, descriptor, options = {}) {
  const documentRef = options.documentRef || globalThis.document;
  const input = documentRef.createElement('input');
  input.type = 'text';
  input.className = 'cm-hybrid-table-cell-input';
  input.value = String(descriptor.cell?.value || '');
  input.dataset.hybridTableCellInput = 'true';
  input.dataset.hybridTableCellKey = descriptor.cellKey;
  input.setAttribute('aria-label', descriptor.ariaLabel);
  input.title = '正在编辑单元格；点击表格右上角“编辑源码”可编辑 Markdown 源码';
  input.spellcheck = false;
  input.autocomplete = 'off';

  if (!descriptor.cell || !Number.isInteger(descriptor.cell.from) || !Number.isInteger(descriptor.cell.to)) {
    input.disabled = true;
    input.title = '该行缺少此单元格，请点击“编辑源码”补齐表格结构';
    return input;
  }
  if (typeof options.encodeTableCell !== 'function') throw new TypeError('Table cell encoder is required');

  const originalValue = String(descriptor.cell.value || '');
  let cancelled = false;
  let committed = false;
  let closed = false;
  let requestedFocusKey = '';
  let removeOutsidePointerListener = () => {};

  const scheduleNextCell = focusKey => {
    if (!focusKey) return;
    if (typeof options.scheduleCellEdit === 'function') {
      options.scheduleCellEdit(descriptor.tableFrom, focusKey);
      return;
    }
    scheduleTableCellEdit(descriptor.tableFrom, focusKey, {
      documentRef,
      scheduleFrame: options.scheduleFrame,
      attempts: options.navigationAttempts
    });
  };

  const releaseOutsidePointer = () => {
    removeOutsidePointerListener();
    removeOutsidePointerListener = () => {};
  };

  const close = result => {
    if (closed) return;
    closed = true;
    releaseOutsidePointer();
    options.onClose?.(result);
  };

  const commit = focusKey => {
    if (committed || cancelled) {
      if (focusKey) scheduleNextCell(focusKey);
      return false;
    }
    committed = true;
    const result = writeTableCellValue(view, descriptor, input.value, originalValue, {
      encodeTableCell: options.encodeTableCell,
      createHistoryAnnotation: options.createHistoryAnnotation,
      recordInteraction: options.recordInteraction,
      onFailure: options.onFailure
    });
    if (!result.failed && focusKey) scheduleNextCell(focusKey);
    return result.changed;
  };

  const destroy = () => {
    if (closed) return;
    cancelled = true;
    closed = true;
    releaseOutsidePointer();
  };

  input.__markdownEditorCommitTableCell = (focusKey = '') => commit(focusKey);
  input.__markdownEditorDestroyTableCell = destroy;
  input.addEventListener('focus', () => input.select());
  input.addEventListener('mousedown', event => event.stopPropagation());
  input.addEventListener('click', event => event.stopPropagation());
  input.addEventListener('dblclick', event => event.stopPropagation());
  input.addEventListener('input', event => event.stopPropagation());
  removeOutsidePointerListener = bindOutsidePointerClosure(view, input, () => {
    if (closed) return;
    const changed = commit(requestedFocusKey);
    close({
      reason: cancelled ? 'cancelled' : changed ? 'committed' : 'pointer-outside',
      value: input.value
    });
  }, {
    isActive: () => !closed && input.isConnected
  });

  input.addEventListener('blur', event => {
    if (closed) return;
    const related = event.relatedTarget?.closest?.('[data-hybrid-table-cell-key]') || null;
    const relatedKey = related?.getAttribute?.('data-hybrid-table-cell-key') || '';
    const changed = commit(requestedFocusKey || relatedKey);
    if (input.isConnected) {
      close({
        reason: cancelled ? 'cancelled' : changed ? 'committed' : 'unchanged',
        value: input.value
      });
    }
  });
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelled = true;
      input.value = originalValue;
      options.recordInteraction?.('hybrid.table-cell-edit-cancel', {
        tableFrom: descriptor.tableFrom,
        row: descriptor.rowIndex,
        column: descriptor.columnIndex
      });
      input.blur();
      return;
    }
    const navigationTarget = getTableCellNavigationTarget(event, descriptor);
    if (navigationTarget !== null) {
      event.preventDefault();
      requestedFocusKey = navigationTarget;
      input.blur();
    }
  });
  return input;
}
