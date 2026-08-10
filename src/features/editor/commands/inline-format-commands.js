/**
 * Responsibility: Build basic inline marker replacements from the neutral editor adapter.
 * State/side effects: None beyond one replaceRange call per command.
 */
function wrapSelection(editor, before, after) {
  const { start, end } = editor.getSelection();
  const selected = editor.sliceText(start, end);
  return editor.replaceRange(before + selected + after, start, end, 'select');
}

export function createInlineFormatCommands(editor) {
  return Object.freeze({
    bold() {
      return wrapSelection(editor, '**', '**');
    },
    italic() {
      return wrapSelection(editor, '*', '*');
    },
    strikethrough() {
      return wrapSelection(editor, '~~', '~~');
    }
  });
}
