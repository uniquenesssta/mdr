/**
 * Responsibility: Insert one Markdown image through one neutral editor replacement transaction.
 * Imports: Public Import image Markdown factory.
 * Exports: createImageCommand.
 * State/side effects: No owned state; delegates one mutation to the injected adapter.
 * Lifecycle: Pure command factory; no independent resources.
 */
import { createImageMarkdown } from '../../import/index.js';

export function createImageCommand(editor) {
  if (!editor || typeof editor.getSelection !== 'function' || typeof editor.replaceRange !== 'function') {
    throw new TypeError('Image command requires a neutral editor adapter.');
  }
  return Object.freeze({
    insert(url, options = {}) {
      const markdown = createImageMarkdown(url, options);
      const selection = options.selection || editor.getSelection();
      const start = Math.max(0, Number(selection.start) || 0);
      const end = Math.max(start, Number(selection.end) || start);
      return editor.replaceRange(markdown, start, end, 'end');
    }
  });
}
