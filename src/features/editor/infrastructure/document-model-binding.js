/**
 * Bind the frozen DocumentModel input contract to the current Editor API.
 * This private object is only passed to the model: no DOM publication, text cache or history.
 */
export function createDocumentModelBinding(editorApi) {
  for (const method of ['getText', 'setText', 'getSelection', 'replaceRange', 'runProgrammaticChange']) {
    if (typeof editorApi?.[method] !== 'function') throw new TypeError(`DocumentModel binding requires ${method}().`);
  }
  return Object.freeze({
    virtualEditor: editorApi,
    get value() { return editorApi.getText(); },
    set value(text) { editorApi.runProgrammaticChange(() => editorApi.setText(text, { selection: 'end' })); },
    get selectionStart() { return editorApi.getSelection().start; },
    get selectionEnd() { return editorApi.getSelection().end; },
    get textLength() { return editorApi.getTextLength(); },
    get lineCount() { return editorApi.getLineCount(); },
    setRangeText(text, from, to, mode) {
      return editorApi.runProgrammaticChange(() => editorApi.replaceRange(text, from, to, mode));
    }
  });
}
