/**
 * Responsibility: Provide a UI-facing math insertion boundary that sends inline/block math commands and restores editor focus.
 * Imports: None.
 * Exports: createMathDialogView.
 * State/side effects: No owned DOM or document state; delegates commands/focus only.
 * Lifecycle: Explicit terminal View lifecycle for composition symmetry; destroy() is idempotent.
 */
export function createMathDialogView({ insertInline, insertBlock, focus } = {}) {
  if (typeof insertInline !== 'function' || typeof insertBlock !== 'function') throw new TypeError('Math Dialog View requires inline/block commands.');
  let destroyed = false;
  const assertActive = () => { if (destroyed) throw new Error('Math Dialog View has been destroyed.'); };
  return Object.freeze({
    insertInline() { assertActive(); const result = insertInline(); focus?.focus?.({ preventScroll: true }); return result; },
    insertBlock() { assertActive(); const result = insertBlock(); focus?.focus?.({ preventScroll: true }); return result; },
    destroy() { if (destroyed) return; destroyed = true; }
  });
}
