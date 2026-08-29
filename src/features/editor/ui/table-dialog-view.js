/**
 * Responsibility: Own the toolbar table-size picker grid and send the selected row/column count through an injected table command.
 * Imports: Shared DOM event scope only.
 * Exports: createTableDialogView.
 * State/side effects: Owns grid DOM/listeners and menu visibility only; no editor state.
 * Lifecycle: Explicit View with idempotent destroy(); closes picker and removes listeners.
 */
import { createEventScope } from '../../../ui/dom/index.js';
export function createTableDialogView({ menu, grid, label, insertTable, rows = 8, columns = 8, formatLabel = (r, c) => `${r} 行 × ${c} 列` } = {}) {
  if (!menu?.ownerDocument || !grid?.ownerDocument) throw new TypeError('Table Dialog View requires menu and grid elements.');
  if (typeof insertTable !== 'function') throw new TypeError('Table Dialog View requires insertTable command.');
  const events = createEventScope();
  let destroyed = false;
  const cells = [];
  if (!grid.children.length) {
    for (let row = 1; row <= rows; row += 1) for (let column = 1; column <= columns; column += 1) {
      const cell = grid.ownerDocument.createElement('div');
      cell.className = 'table-grid-cell';
      cell.dataset.row = String(row);
      cell.dataset.col = String(column);
      grid.appendChild(cell);
    }
  }
  cells.push(...grid.querySelectorAll('.table-grid-cell'));
  const highlight = (row, column) => {
    cells.forEach(cell => cell.classList.toggle('active', Number(cell.dataset.row) <= row && Number(cell.dataset.col) <= column));
    if (label) label.textContent = formatLabel(row, column);
  };
  const close = () => { menu.classList.remove('show'); highlight(0, 0); };
  const toggle = () => { const open = !menu.classList.contains('show'); close(); if (open) menu.classList.add('show'); };
  const insert = (rowCount, columnCount) => {
    const result = insertTable(rowCount, columnCount);
    close();
    return result;
  };
  events.listen(grid, 'mouseover', event => {
    const cell = event.target?.closest?.('.table-grid-cell');
    if (cell) highlight(Number(cell.dataset.row), Number(cell.dataset.col));
  });
  events.listen(grid, 'mouseleave', () => highlight(0, 0));
  events.listen(grid, 'click', event => {
    const cell = event.target?.closest?.('.table-grid-cell');
    if (!cell) return;
    insert(Number(cell.dataset.row), Number(cell.dataset.col));
  });
  return Object.freeze({ toggle, close, insert, destroy() { if (destroyed) return; destroyed = true; close(); events.destroy(); } });
}
