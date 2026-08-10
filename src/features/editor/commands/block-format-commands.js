/**
 * Responsibility: Build heading and quote replacements from the neutral editor adapter.
 * State/side effects: None beyond one replaceRange call per command.
 */
function normalizeHeadingLevel(level) {
  const value = Number(level);
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new RangeError('Heading level must be an integer from 1 through 6.');
  }
  return value;
}

export function createBlockFormatCommands(editor) {
  return Object.freeze({
    heading(level) {
      const normalizedLevel = normalizeHeadingLevel(level);
      const { start } = editor.getSelection();
      const lineNumber = editor.getLineNumberAtPosition(start);
      const from = editor.getLineStart(lineNumber);
      const to = editor.getLineEnd(lineNumber);
      const currentLine = editor.sliceText(from, to);
      const nextLine = '#'.repeat(normalizedLevel) + ' ' + currentLine.replace(/^#{0,6}\s*/, '');
      return editor.replaceRange(nextLine, from, to, 'end');
    },
    quote(fallbackText = '') {
      const { start, end } = editor.getSelection();
      const selected = editor.sliceText(start, end) || String(fallbackText ?? '');
      const quoted = '> ' + selected.replace(/\n/g, '\n> ');
      return editor.replaceRange(quoted, start, end, 'select');
    }
  });
}
