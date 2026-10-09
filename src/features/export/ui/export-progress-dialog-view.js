import { ModalShell } from '../../../ui/components/modal-shell.js';
import { createEventScope, createSafeElement, requireElementRef } from '../../../ui/dom/index.js';

/** Own progress DOM, focus and listeners; cancellation is an injected controller command. */
export function createExportProgressDialogView({ overlayRoot, store, onCancel,
  createModalShell = (root, options) => new ModalShell(root, options) } = {}) {
  requireElementRef(overlayRoot, 'Export progress overlay root');
  if (!store || typeof store.getSnapshot !== 'function' || typeof store.subscribe !== 'function' || typeof onCancel !== 'function') {
    throw new TypeError('Export progress view requires a read-only store and cancel command.');
  }
  const documentRef = overlayRoot.ownerDocument;
  if (documentRef.getElementById('export-progress-modal')) throw new Error('Export progress view is already mounted.');
  const node = (parent, tag, options) => {
    const element = createSafeElement(documentRef, tag, options);
    parent?.append(element);
    return element;
  };
  const root = node(null, 'div', { id: 'export-progress-modal', className: 'modal-overlay export-progress-overlay', attributes: { 'aria-live': 'polite' } });
  const panel = node(root, 'div', { className: 'modal export-progress-modal' });
  const header = node(panel, 'div', { className: 'modal-header' });
  const title = node(header, 'h3', { id: 'export-progress-title' });
  const body = node(panel, 'div', { className: 'modal-body' });
  const track = node(body, 'div', { className: 'export-progress-track', attributes: { 'aria-hidden': 'true' } });
  const value = node(track, 'div', { id: 'export-progress-value', className: 'export-progress-value' });
  const status = node(body, 'p', { id: 'export-progress-status', className: 'export-progress-status' });
  node(body, 'p', { className: 'hint', text: '超大文档会分批构建导出内容，编辑器不会长时间无响应。' });
  const footer = node(panel, 'div', { className: 'modal-footer' });
  const cancel = node(footer, 'button', { id: 'export-progress-cancel', attributes: { type: 'button' } });
  const events = createEventScope();
  let destroyed = false, modal = null, unsubscribe = null;
  const render = snapshot => {
    if (destroyed) return;
    title.textContent = snapshot.title;
    value.style.width = snapshot.progress + '%';
    status.textContent = snapshot.message;
    cancel.disabled = !snapshot.cancelEnabled;
    cancel.textContent = snapshot.cancelLabel;
    if (!snapshot.visible) { if (modal.isOpen()) modal.close(snapshot.closeReason); return; }
    if (!modal.isOpen()) modal.open(null, {
      labelledBy: title.id, describedBy: status.id, initialFocus: cancel,
      closeOnEscape: false, closeOnBackdrop: false
    });
  };
  const cleanup = () => {
    const errors = [];
    for (const release of [() => unsubscribe?.(), () => events.destroy(), () => modal?.destroy(), () => root.remove()]) {
      try { release(); } catch (error) { errors.push(error); }
    }
    return errors;
  };
  try {
    modal = createModalShell(root, { panel });
    overlayRoot.append(root);
    events.listen(cancel, 'click', () => { if (!destroyed && store.getSnapshot().cancelEnabled) onCancel(); });
    unsubscribe = store.subscribe(render);
    if (typeof unsubscribe !== 'function') throw new TypeError('Export progress view subscription requires a disposer.');
  } catch (error) {
    destroyed = true;
    const errors = [error, ...cleanup()];
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Failed to construct export progress view cleanly.');
  }
  return Object.freeze({ root, isOpen: () => !destroyed && modal.isOpen(), destroy() {
    if (destroyed) return;
    destroyed = true;
    const errors = cleanup();
    if (errors.length) throw new AggregateError(errors, 'Failed to destroy export progress view cleanly.');
  } });
}
