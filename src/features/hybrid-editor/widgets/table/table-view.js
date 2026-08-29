/**
 * Atomic 8.9 Table presentation-view owner.
 * Allowed imports: none. Forbidden imports: CodeMirror, Session, source editing, writeback and application globals.
 * API: createTableView(), createTableCellPresentation(). State: none. Side effects: bounded DOM construction only.
 */

function getCellLabel(rowIndex, columnIndex, isHeader) {
  return `${isHeader ? '表头' : `第 ${rowIndex} 行`}第 ${columnIndex + 1} 列`;
}

export function createTableCellPresentation(cell, rowIndex, columnIndex, isHeader, valueOverride = cell?.value || '') {
  const value = document.createElement('span');
  value.className = 'cm-hybrid-table-cell-value';
  value.textContent = String(valueOverride || '');
  value.title = cell && Number.isInteger(cell.from) && Number.isInteger(cell.to)
    ? '双击直接编辑此单元格'
    : '该行缺少此单元格，双击或点击“编辑源码”补齐表格结构';
  value.setAttribute('aria-label', `${getCellLabel(rowIndex, columnIndex, isHeader)}，双击编辑`);
  return value;
}

export function createTableView(descriptor, options = {}) {
  const headers = descriptor.headers || [];
  const rows = descriptor.rows || [];
  const headerCells = descriptor.headerCells || [];
  const rowCells = descriptor.rowCells || [];
  const alignments = descriptor.alignments || [];
  const visualEditing = Boolean(options.visualEditing);
  const columnCount = headers.length;
  const rowCount = rows.length + 1;
  const cells = [];

  const scroller = document.createElement('div');
  scroller.className = 'cm-hybrid-table-scroller';
  scroller.dataset.hybridDoubleZone = 'table-body';
  const table = document.createElement('table');

  const appendCell = (cellElement, cell, rowIndex, columnIndex, isHeader) => {
    const cellKey = `${rowIndex}:${columnIndex}`;
    cellElement.style.textAlign = alignments[columnIndex] || 'left';
    cellElement.dataset.hybridTableCellKey = cellKey;
    if (visualEditing) {
      cellElement.appendChild(createTableCellPresentation(cell, rowIndex, columnIndex, isHeader));
    } else {
      cellElement.textContent = cell?.value || '';
    }
    cells.push({ cellElement, cell, cellKey, rowIndex, columnIndex, isHeader });
  };

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  headers.forEach((_, columnIndex) => {
    const th = document.createElement('th');
    appendCell(th, headerCells[columnIndex], 0, columnIndex, true);
    headRow.appendChild(th);
  });
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement('tbody');
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = document.createElement('tr');
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const td = document.createElement('td');
      appendCell(td, rowCells[rowIndex]?.[columnIndex], rowIndex + 1, columnIndex, false);
      row.appendChild(td);
    }
    body.appendChild(row);
  }
  table.appendChild(body);
  scroller.appendChild(table);
  return { scroller, cells, rowCount, columnCount };
}
