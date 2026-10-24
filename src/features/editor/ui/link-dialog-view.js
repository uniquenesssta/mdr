/**
 * Responsibility: Own link-dialog form/pending selection presentation and send one link insertion command on confirmation.
 * Imports: Shared DOM event scope only.
 * Exports: createLinkDialogView.
 * State/side effects: Owns pending selection and modal form listeners only; no editor text.
 * Lifecycle: Explicit View with idempotent destroy(); closes modal, clears pending state and removes listeners.
 */
import { createEventScope } from '../../../ui/dom/index.js';
import { ModalShell } from '../../../ui/components/modal-shell.js';
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
  const shell = new ModalShell(root, { panel: root.firstElementChild });
  try {
  const input = root.querySelector('#link-url-input');
  let pending = null;
  let destroyed = false;
  const close = () => shell.close('feature-close');
  const open = () => {
    const snapshot = selection.snapshot();
    pending = Object.freeze({ selection: snapshot, label: selection.selectedText(snapshot) || fallbackLabel });
    if (input) input.value = defaultUrl;
    shell.open(null, { labelledBy: 'link-modal-title',  initialFocus: input, onClose: () => { pending = null; focus?.focus?.({ preventScroll: true }); } });
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
  return Object.freeze({ open, close, confirm, destroy() { if (destroyed) return; destroyed = true; pending = null; const errors = []; for (const action of [() => close(), () => events.destroy(), () => shell.destroy()]) try { action(); } catch (error) { errors.push(error); } if (errors.length) throw new AggregateError(errors, 'Editor dialog cleanup failed.'); } });
  } catch (error) {
    const errors = [error];
    try { events.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { shell.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    if (errors.length > 1) throw new AggregateError(errors, 'Editor dialog construction failed.');
    throw error;
  }
}
