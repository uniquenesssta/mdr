/** Pure UI action policy for the read-only document view. */
const READING_ACTIONS = new Set([
  'layout', 'open-find', 'open-replace', 'page-fullscreen', 'system-fullscreen',
  'save-current-file', 'save-as-markdown', 'close-app-menus', 'customize-toolbar'
]);

export function canRunEditorAction(mode, action) {
  return mode !== 'preview' || READING_ACTIONS.has(action);
}
