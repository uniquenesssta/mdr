/**
 * Responsibility: Build inline or fenced code replacements from the neutral editor adapter.
 * State/side effects: None beyond one replaceRange call per command.
 */
function wrapCodeSelection(editor, forceInline) {
  const { start, end } = editor.getSelection();
  const selected = editor.sliceText(start, end);
  const replacement = !forceInline && selected.includes('\n')
    ? '```\n' + selected + '\n```'
    : '`' + selected + '`';
  return editor.replaceRange(replacement, start, end, 'select');
}

export function createCodeCommands(editor) {
  return Object.freeze({
    inlineCode() {
      return wrapCodeSelection(editor, true);
    },
    code() {
      return wrapCodeSelection(editor, false);
    }
  });
}
