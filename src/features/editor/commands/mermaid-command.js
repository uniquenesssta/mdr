/**
 * Responsibility: Insert one Mermaid fenced block through one neutral editor replacement transaction.
 * Imports: None.
 * Exports: createMermaidCommand.
 * State/side effects: No owned state; delegates one mutation to the injected adapter.
 * Lifecycle: Pure command factory; no independent resources.
 */
export function createMermaidCommand(editor) {
  if (!editor || typeof editor.getSelection !== 'function' || typeof editor.replaceRange !== 'function') {
    throw new TypeError('Mermaid command requires a neutral editor adapter.');
  }
  return Object.freeze({
    insert(code, options = {}) {
      const source = String(code || '').trim();
      if (!source) throw new TypeError('Mermaid source must not be empty.');
      const selection = options.selection || editor.getSelection();
      const fenced = `\n\`\`\`mermaid\n${source}\n\`\`\`\n\n`;
      return editor.replaceRange(fenced, selection.start, selection.end, 'end');
    }
  });
}
