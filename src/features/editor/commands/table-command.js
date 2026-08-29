/**
 * Responsibility: Build and insert one bounded Markdown table through one neutral editor replacement transaction.
 * Imports: None.
 * Exports: createTableCommand.
 * State/side effects: No owned state; delegates one mutation to the injected adapter.
 * Lifecycle: Pure command factory; no independent resources.
 */
export function createTableCommand(editor) {
  if (!editor || typeof editor.getSelection !== 'function' || typeof editor.replaceRange !== 'function') {
    throw new TypeError('Table command requires a neutral editor adapter.');
  }
  return Object.freeze({
    insert(rows, columns, options = {}) {
      const rowCount = Math.max(0, Math.floor(Number(rows) || 0));
      const columnCount = Math.max(0, Math.floor(Number(columns) || 0));
      if (!rowCount || !columnCount || rowCount > 64 || columnCount > 64) return false;
      const headerPrefix = String(options.headerPrefix || '列');
      const cellText = String(options.cellText || '内容');
      const header = Array.from({ length: columnCount }, (_, index) => ` ${headerPrefix}${index + 1} `).join('|');
      const separator = `|${Array.from({ length: columnCount }, () => ' --- ').join('|')}|`;
      const row = `|${Array.from({ length: columnCount }, () => ` ${cellText} `).join('|')}|`;
      let markdown = `\n|${header}|\n${separator}`;
      for (let index = 2; index <= rowCount; index += 1) markdown += `\n${row}`;
      markdown += '\n';
      const selection = options.selection || editor.getSelection();
      return editor.replaceRange(markdown, selection.start, selection.end, 'end');
    }
  });
}
