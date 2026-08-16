/**
 * Responsibility: Read the final editor selection boundary from the neutral editor adapter without owning editor state, DOM listeners, projection or synchronization policy.
 * Imports: None; consumes only an injected editorApi.getSelection capability.
 * Exports: EditorSelectionReader and createEditorSelectionReader.
 * State/side effects: Owns only terminal lifecycle state; selection snapshots are immutable read results.
 * Lifecycle: Explicit instance lifecycle; destroy() is idempotent and later reads are rejected.
 */

function normalizeOffset(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : fallback;
}

export class EditorSelectionReader {
  constructor({ editorApi } = {}) {
    if (!editorApi || typeof editorApi.getSelection !== 'function') {
      throw new TypeError('EditorSelectionReader requires editorApi.getSelection');
    }
    this.editorApi = editorApi;
    this.destroyed = false;
  }

  read() {
    if (this.destroyed) throw new Error('EditorSelectionReader is destroyed');
    const selection = this.editorApi.getSelection?.() || {};
    const anchor = normalizeOffset(selection.anchor);
    const head = normalizeOffset(selection.head, anchor);
    const from = normalizeOffset(selection.from, Math.min(anchor, head));
    const to = Math.max(from, normalizeOffset(selection.to, Math.max(anchor, head)));
    return Object.freeze({
      anchor,
      head,
      from,
      to,
      isCollapsed: from === to
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.editorApi = null;
  }
}

export function createEditorSelectionReader(options = {}) {
  return new EditorSelectionReader(options);
}
