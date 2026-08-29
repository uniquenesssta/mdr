/**
 * Responsibility: Bind editor-pane presentation gestures and selection notifications without owning editor text or layout state.
 * Imports: Shared DOM event scope only.
 * Exports: createEditorPaneView.
 * State/side effects: Owns pane/editor listeners only; all actions delegate to injected commands/callbacks.
 * Lifecycle: Explicit View with idempotent destroy(); removes every bound listener.
 */
import { createEventScope } from '../../../ui/dom/index.js';

export function createEditorPaneView({ root, editorElement, collapse = () => {}, onSelectionChange = () => {} } = {}) {
  if (!root?.ownerDocument || !editorElement?.ownerDocument) throw new TypeError('Editor Pane View requires pane and editor elements.');
  const events = createEventScope();
  let destroyed = false;
  events.listen(root, 'click', event => {
    const trigger = event.target?.closest?.('[data-editor-pane-action="collapse"]');
    if (!trigger) return;
    event.preventDefault?.();
    collapse('editor');
  });
  events.listen(editorElement, 'select', event => onSelectionChange(event));
  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      events.destroy();
    }
  });
}
