/**
 * Responsibility: Bind editor-pane presentation gestures and selection notifications without owning editor text or layout state.
 * Imports: Shared DOM event scope only.
 * Exports: createEditorPaneView.
 * State/side effects: Owns pane/editor listeners only; all actions delegate to injected commands/callbacks.
 * Lifecycle: Explicit View with idempotent destroy(); removes every bound listener.
 */
import { createEventScope } from '../../../ui/dom/index.js';

export function createEditorPaneView({ root, editorElement, editorApi, i18n, collapse = () => {}, onSelectionChange = () => {} } = {}) {
  if (!root?.ownerDocument || !editorElement?.ownerDocument) throw new TypeError('Editor Pane View requires pane and editor elements.');
  if (typeof editorApi?.subscribe !== 'function' || typeof editorApi?.setPlaceholder !== 'function') throw new TypeError('Editor Pane View requires Editor capabilities.');
  const events = createEventScope();
  let destroyed = false;
  events.listen(root, 'click', event => {
    const trigger = event.target?.closest?.('[data-editor-pane-action="collapse"]');
    if (!trigger) return;
    event.preventDefault?.();
    collapse('editor');
  });
  const unsubscribeSelection = editorApi.subscribe(update => { if (update.selectionSet) onSelectionChange(update); });
  const refreshPlaceholder = () => editorApi.setPlaceholder(i18n.t(editorElement.dataset.i18nPlaceholder));
  let unsubscribeLocale = null;
  try { refreshPlaceholder(); unsubscribeLocale = i18n.subscribe(refreshPlaceholder); }
  catch (error) { unsubscribeSelection(); events.destroy(); throw error; }
  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      for (const release of [unsubscribeSelection, unsubscribeLocale, () => events.destroy()]) {
        try { release?.(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Editor Pane View cleanup failed.');
    }
  });
}
