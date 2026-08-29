/**
 * Responsibility: Expose immutable editor selection snapshots and bounded selected-text reads over the neutral editor adapter.
 * Imports: None; consumes only the injected neutral adapter.
 * Exports: createEditorSelectionService.
 * State/side effects: Owns terminal lifecycle only; never owns document text or selection authority.
 * Lifecycle: Explicit instance with idempotent destroy(); destroy is terminal and does not destroy the adapter.
 */
export function createEditorSelectionService({ adapter } = {}) {
  if (!adapter || typeof adapter.getSelection !== 'function' || typeof adapter.sliceText !== 'function'
    || typeof adapter.setSelection !== 'function' || typeof adapter.getTextLength !== 'function') {
    throw new TypeError('Editor Selection Service requires a neutral editor adapter.');
  }
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Editor Selection Service has been destroyed.');
  };
  const snapshot = () => {
    assertActive();
    const value = adapter.getSelection();
    return Object.freeze({
      anchor: Number(value.anchor) || 0,
      head: Number(value.head) || 0,
      start: Number(value.start) || 0,
      end: Number(value.end) || 0,
      direction: value.direction === 'backward' ? 'backward' : 'forward',
      documentLength: Number(adapter.getTextLength()) || 0
    });
  };
  return Object.freeze({
    snapshot,
    selectedText(selection = snapshot()) {
      assertActive();
      return adapter.sliceText(selection.start, selection.end);
    },
    restore(selection, options = {}) {
      assertActive();
      if (!selection || typeof selection !== 'object') throw new TypeError('Selection snapshot is required.');
      const length = Number(adapter.getTextLength()) || 0;
      const anchor = Math.max(0, Math.min(length, Number(selection.anchor ?? selection.start) || 0));
      const head = Math.max(0, Math.min(length, Number(selection.head ?? selection.end ?? anchor) || 0));
      return adapter.setSelection(anchor, head, { scrollIntoView: Boolean(options.scrollIntoView) });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
    }
  });
}
