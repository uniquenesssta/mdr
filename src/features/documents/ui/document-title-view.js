/**
 * Responsibility: Reflect the active document title into the title input and send title draft edits through an injected command.
 * Imports: Shared DOM event scope only.
 * Exports: createDocumentTitleView.
 * State/side effects: Owns one input listener and one read-only session subscription; never owns title state.
 * Lifecycle: Explicit View with idempotent destroy(); removes listener and subscription.
 */
import { createEventScope } from '../../../ui/dom/index.js';

export function createDocumentTitleView({ input, session, updateTitleDraft, fallbackTitle = '未命名文档' } = {}) {
  if (!input?.ownerDocument) throw new TypeError('Document Title View requires an input element.');
  if (!session || typeof session.subscribe !== 'function') throw new TypeError('Document Title View requires a session contract.');
  if (typeof updateTitleDraft !== 'function') throw new TypeError('Document Title View requires an updateTitleDraft command.');
  const events = createEventScope();
  let destroyed = false;
  const render = snapshot => {
    if (destroyed) return;
    const records = snapshot?.records || session.records;
    const activeId = snapshot?.activeId ?? session.activeId;
    const active = records.find(record => record.id === activeId) || null;
    const next = String(active?.title || fallbackTitle);
    if (input.value !== next) input.value = next;
  };
  events.listen(input, 'input', () => updateTitleDraft(input.value));
  const unsubscribe = session.subscribe(event => render(event?.snapshot));
  render(session.snapshot || { records: session.records, activeId: session.activeId });
  return Object.freeze({
    refresh() { render(session.snapshot || { records: session.records, activeId: session.activeId }); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      events.destroy();
    }
  });
}
