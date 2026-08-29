/**
 * Responsibility: Insert one Markdown link through one neutral editor replacement transaction.
 * Imports: None.
 * Exports: createLinkCommand.
 * State/side effects: No owned state; delegates one mutation to the injected adapter.
 * Lifecycle: Pure command factory; no independent resources.
 */
export function createLinkCommand(editor) {
  if (!editor || typeof editor.getSelection !== 'function' || typeof editor.sliceText !== 'function' || typeof editor.replaceRange !== 'function') {
    throw new TypeError('Link command requires a neutral editor adapter.');
  }
  return Object.freeze({
    insert(url, options = {}) {
      const normalizedUrl = String(url || '').trim();
      if (!normalizedUrl) throw new TypeError('Link URL must not be empty.');
      const selection = options.selection || editor.getSelection();
      const start = Math.max(0, Number(selection.start) || 0);
      const end = Math.max(start, Number(selection.end) || start);
      const selected = options.label === undefined ? editor.sliceText(start, end) : String(options.label || '');
      const label = selected || String(options.fallbackLabel || '链接');
      return editor.replaceRange(`[${label}](${normalizedUrl})`, start, end, 'end');
    }
  });
}
