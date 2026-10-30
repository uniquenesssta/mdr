/** Clipboard and selection commands over the actual editor, with stale async intent protection. */
export function createEditorContextActions({ editor, clipboard, focus, runHistory, getDocumentId, isReadOnly }) {
  let destroyed = false;
  const capture = () => ({ selection: editor.getSelection(), version: editor.getDocumentVersion(), documentId: getDocumentId() });
  const valid = (intent, requireSelection = true) => !destroyed && intent && intent.documentId === getDocumentId()
    && intent.version === editor.getDocumentVersion()
    && (!requireSelection || (intent.selection.start === editor.getSelection().start && intent.selection.end === editor.getSelection().end));
  return Object.freeze({
    capture,
    async execute(action, intent) {
      if (!valid(intent, !['undo', 'redo', 'select-all'].includes(action))) return false;
      const { start, end } = intent.selection;
      if (action === 'copy' || action === 'cut') {
        if (action === 'cut' && isReadOnly()) return false;
        if (start === end) return false;
        await clipboard.writeText(editor.sliceText(start, end));
        if (action === 'copy') return true;
        if (!valid(intent) || isReadOnly()) return false;
        editor.replaceRange('', start, end, 'end');
      } else if (action === 'paste') {
        if (isReadOnly()) return false;
        const text = await clipboard.readText();
        if (!valid(intent) || isReadOnly() || !text.length) return false;
        editor.replaceRange(text, start, end, 'end');
      } else if (action === 'select-all') {
        editor.setSelection(0, editor.getTextLength());
      } else if (action === 'undo' || action === 'redo') {
        if (isReadOnly()) return false;
        return runHistory(action);
      } else throw new Error(`Unknown editor context action: ${action}`);
      focus();
      return true;
    },
    destroy() { destroyed = true; }
  });
}
