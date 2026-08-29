/**
 * Responsibility: Insert inline or block math with one neutral editor transaction while preserving the legacy formula selection semantics.
 * Imports: None.
 * Exports: createMathCommand.
 * State/side effects: No owned state; delegates one transaction to the injected adapter.
 * Lifecycle: Pure command factory; no independent resources.
 */
export function createMathCommand(editor) {
  if (!editor || typeof editor.getSelection !== 'function' || typeof editor.sliceText !== 'function'
    || typeof editor.getTextLength !== 'function' || typeof editor.applyTransaction !== 'function') {
    throw new TypeError('Math command requires a neutral editor adapter.');
  }
  return Object.freeze({
    inline(options = {}) {
      const selection = options.selection || editor.getSelection();
      const selected = editor.sliceText(selection.start, selection.end);
      const formula = String(selected || options.fallbackFormula || 'E = mc^2').replace(/\s*\n\s*/g, ' ').trim();
      const insert = `$${formula}$`;
      const formulaStart = selection.start + 1;
      editor.applyTransaction({
        changes: { from: selection.start, to: selection.end, insert },
        selection: { anchor: formulaStart, head: formulaStart + formula.length }
      });
      return Object.freeze({ insert, formula, from: selection.start, to: selection.end });
    },
    block(options = {}) {
      const selection = options.selection || editor.getSelection();
      const selected = editor.sliceText(selection.start, selection.end);
      const formula = String(selected || options.fallbackFormula || '\\int_{a}^{b} f(x)\\,dx').trim();
      const documentLength = editor.getTextLength();
      const previous = selection.start > 0 ? editor.sliceText(selection.start - 1, selection.start) : '';
      const next = selection.end < documentLength ? editor.sliceText(selection.end, selection.end + 1) : '';
      const prefix = selection.start > 0 && previous !== '\n' ? '\n' : '';
      const suffix = selection.end < documentLength && next !== '\n' ? '\n' : '';
      const insert = `${prefix}$$\n${formula}\n$$${suffix}`;
      const formulaStart = selection.start + prefix.length + 3;
      editor.applyTransaction({
        changes: { from: selection.start, to: selection.end, insert },
        selection: { anchor: formulaStart, head: formulaStart + formula.length }
      });
      return Object.freeze({ insert, formula, from: selection.start, to: selection.end });
    }
  });
}
