/**
 * Responsibility: Insert one Markdown image through one neutral editor replacement transaction.
 * Imports: None.
 * Exports: createImageCommand.
 * State/side effects: No owned state; delegates one mutation to the injected adapter.
 * Lifecycle: Pure command factory; no independent resources.
 */
export function createImageCommand(editor) {
  if (!editor || typeof editor.getSelection !== 'function' || typeof editor.replaceRange !== 'function') {
    throw new TypeError('Image command requires a neutral editor adapter.');
  }
  return Object.freeze({
    insert(url, options = {}) {
      const normalizedUrl = String(url || '').trim();
      if (!normalizedUrl) throw new TypeError('Image URL must not be empty.');
      const selection = options.selection || editor.getSelection();
      const start = Math.max(0, Number(selection.start) || 0);
      const end = Math.max(start, Number(selection.end) || start);
      const fallbackAlt = String(options.fallbackAlt || '图片');
      const safeAlt = String(options.alt || fallbackAlt).replace(/\]/g, '\\]');
      return editor.replaceRange(`![${safeAlt}](${normalizedUrl})`, start, end, 'end');
    }
  });
}
