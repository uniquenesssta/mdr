/**
 * Responsibility: Own link-dialog form/pending selection presentation and send one link insertion command on confirmation.
 * Imports: Shared DOM event scope only.
 * Exports: createLinkDialogView.
 * State/side effects: Owns pending selection and modal form listeners only; no editor text.
 * Lifecycle: Explicit View with idempotent destroy(); closes modal, clears pending state and removes listeners.
 */
import { createEventScope } from '../../../ui/dom/index.js';
const OPEN_EVENT = 'markdown-editor:modal-shell-open';
const CLOSE_EVENT = 'markdown-editor:modal-shell-close';
function modal(root, type, detail) {
  const EventCtor = root.ownerDocument?.defaultView?.CustomEvent || globalThis.CustomEvent;
  root.dispatchEvent(new EventCtor(type, { detail }));
  if (detail.error) throw detail.error;
}
export function createLinkDialogView({
  root,
  selection,
  insertLink,
  focus,
  defaultUrl = 'https://',
  fallbackLabel = '链接',
  emptyUrlMessage = '请输入链接地址',
  notify = () => {}
} = {}) {
  if (!root?.ownerDocument) throw new TypeError('Link Dialog View requires a modal root.');
  if (!selection || typeof selection.snapshot !== 'function' || typeof selection.selectedText !== 'function') throw new TypeError('Link Dialog View requires Selection Service.');
  if (typeof insertLink !== 'function') throw new TypeError('Link Dialog View requires insertLink command.');
  const events = createEventScope();
  const input = root.querySelector('#link-url-input');
  let pending = null;
  let destroyed = false;
  const close = () => modal(root, CLOSE_EVENT, { reason: 'feature-close' });
  const open = () => {
    const snapshot = selection.snapshot();
    pending = Object.freeze({ selection: snapshot, label: selection.selectedText(snapshot) || fallbackLabel });
    if (input) input.value = defaultUrl;
    modal(root, OPEN_EVENT, { options: { initialFocus: input, onClose: () => { pending = null; focus?.focus?.({ preventScroll: true }); } } });
    input?.select?.();
  };
  const confirm = () => {
    const url = String(input?.value || '').trim();
    if (!pending) { close(); return false; }
    if (!url) { notify(emptyUrlMessage); input?.focus?.(); return false; }
    insertLink(url, { selection: pending.selection, label: pending.label, fallbackLabel });
    close();
    return true;
  };
  events.listen(root, 'click', event => {
    const action = event.target?.closest?.('[data-link-action]')?.dataset?.linkAction;
    if (!action) return;
    event.preventDefault?.();
    if (action === 'close' || action === 'cancel') close();
    if (action === 'confirm') confirm();
  });
  events.listen(input, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault?.(); confirm(); } });
  return Object.freeze({ open, close, confirm, destroy() { if (destroyed) return; destroyed = true; pending = null; try { close(); } catch (_) {} events.destroy(); } });
}
