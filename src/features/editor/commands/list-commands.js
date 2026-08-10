/**
 * Responsibility: Build basic Markdown list replacements from the neutral editor adapter.
 * State/side effects: None beyond one replaceRange call per command.
 */
function applyList(editor, prefix, fallbackText = '') {
  const { start, end } = editor.getSelection();
  const selected = editor.sliceText(start, end) || String(fallbackText ?? '');
  const firstLine = editor.getLineNumberAtPosition(start);
  const firstLineStart = editor.getLineStart(firstLine);
  const replacement = selected
    .split('\n')
    .map(line => (line ? prefix + line : line))
    .join('\n');
  return editor.replaceRange(replacement, firstLineStart, end, 'end');
}

export function createListCommands(editor) {
  return Object.freeze({
    unorderedList(fallbackText = '') {
      return applyList(editor, '- ', fallbackText);
    },
    orderedList(fallbackText = '') {
      return applyList(editor, '1. ', fallbackText);
    },
    taskList(fallbackText = '') {
      return applyList(editor, '- [ ] ', fallbackText);
    }
  });
}
