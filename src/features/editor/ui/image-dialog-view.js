/**
 * Responsibility: Own image-dialog tab/file-preview state and send one image insertion command after form validation.
 * Imports: Shared DOM event scope and public Import cancellation contract; injected Image Import Controller.
 * Exports: createImageDialogView.
 * State/side effects: Owns pending upload data URL and DOM listeners only; never owns editor text.
 * Lifecycle: Explicit View with idempotent destroy(); clears pending upload state, closes modal and removes listeners.
 */
import { createEventScope, createSafeElement } from '../../../ui/dom/index.js';
import { ModalShell } from '../../../ui/components/modal-shell.js';
import { isImageImportCancelled } from '../../import/index.js';
export function createImageDialogView({
  root,
  selection,
  imageController,
  insertImage,
  notify = () => {},
  confirmLargeFile = () => true,
  fallbackAlt = '图片',
  createModalShell = (element, options) => new ModalShell(element, options),
  messages = {}
} = {}) {
  if (!root?.ownerDocument) throw new TypeError('Image Dialog View requires a modal root.');
  if (!selection || typeof selection.snapshot !== 'function') throw new TypeError('Image Dialog View requires Selection Service.');
  if (typeof insertImage !== 'function') throw new TypeError('Image Dialog View requires insertImage command.');
  if (typeof imageController?.readFile !== 'function' || typeof imageController?.createInsertion !== 'function') throw new TypeError('Image Dialog View requires Image Import Controller.');
  const events = createEventScope();
  const shell = createModalShell(root, { panel: root.firstElementChild });
  try {
  const text = Object.freeze({
    selectFile: messages.selectFile || '请选择图片文件',
    tooLarge: messages.tooLarge || '图片不能超过 5MB',
    readFailed: messages.readFailed || '图片读取失败',
    selectFirst: messages.selectFirst || '请先选择图片',
    enterUrl: messages.enterUrl || '请输入图片地址',
    previewAlt: messages.previewAlt || fallbackAlt
  });
  let pendingDataUrl = '';
  let pendingSelection = null;
  let activeTab = 'url';
  let destroyed = false, generation = 0;
  const q = selector => root.querySelector(selector);
  const feedback = createSafeElement(root.ownerDocument, 'p', { className: 'c-form-status is-error', attributes: { role: 'status', 'aria-live': 'polite' } });
  q('.modal-body').append(feedback);
  const choose = createSafeElement(root.ownerDocument, 'button', { className: 'image-choose-file', text: '选择图片', attributes: { type: 'button' } });
  q('#image-upload-area').append(choose);
  const projectAvailability = () => {
    const input = q('#image-url-input');
    const available = activeTab === 'upload' ? Boolean(pendingDataUrl) : Boolean(input.value.trim()) && input.checkValidity();
    q('[data-image-action="confirm"]').disabled = !available;
  };
  const showError = message => { feedback.textContent = message; q('[data-image-action="confirm"]').disabled = true; };
  const clearUpload = () => {
    generation++; imageController.cancel(); pendingDataUrl = '';
    q('#image-upload-preview')?.replaceChildren?.();
  };
  const switchTab = tab => {
    if (destroyed) return;
    if (tab !== 'upload') clearUpload();
    activeTab = tab === 'upload' ? 'upload' : 'url';
    root.querySelectorAll('.image-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === activeTab));
    root.querySelectorAll('.image-tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `image-tab-${activeTab}`));
    feedback.textContent = '';
    projectAvailability();
  };
  const close = () => { clearUpload(); pendingSelection = null; shell.close('feature-close'); };
  const open = () => {
    if (destroyed) return;
    clearUpload();
    pendingSelection = selection.snapshot();
    for (const selector of ['#image-url-input', '#image-url-alt', '#image-upload-alt', '#image-file-input']) {
      const element = q(selector); if (element) element.value = '';
    }
    q('#image-upload-preview')?.replaceChildren?.();
    switchTab('url');
    shell.open(null, { ariaLabel: '插入图片',  initialFocus: q('#image-url-input'), onClose: () => { clearUpload(); pendingSelection = null; } });
  };
  const readFile = async input => {
    if (destroyed) return;
    clearUpload();
    const id = generation;
    const file = input?.files?.[0];
    if (!file) return;
    try {
      const result = await imageController.readFile(file, { source: 'dialog', confirmLargeFile });
      if (destroyed || id !== generation) return;
      pendingDataUrl = result.url;
      const preview = q('#image-upload-preview');
      if (preview) {
        const image = root.ownerDocument.createElement('img');
        image.src = pendingDataUrl;
        image.alt = text.previewAlt;
        preview.replaceChildren(image);
      }
      switchTab('upload');
    } catch (error) {
      if (destroyed || id !== generation || isImageImportCancelled(error)) return;
      showError(error?.code === 'IMAGE_IMPORT_TOO_LARGE' ? text.tooLarge
        : error?.code === 'IMAGE_IMPORT_UNSUPPORTED' ? text.selectFile : text.readFailed);
    }
  };
  const confirm = () => {
    if (destroyed) return false;
    const url = activeTab === 'upload' ? pendingDataUrl : String(q('#image-url-input')?.value || '').trim();
    const alt = String((activeTab === 'upload' ? q('#image-upload-alt') : q('#image-url-alt'))?.value || '').trim() || fallbackAlt;
    if (!url || (activeTab === 'url' && !q('#image-url-input').checkValidity())) { showError(activeTab === 'upload' ? text.selectFirst : text.enterUrl); return false; }
    const request = imageController.createInsertion(url, { alt, fallbackAlt, selection: pendingSelection || selection.snapshot() });
    if (!request) { showError('地址或文件无效，请检查后重试。'); return false; }
    insertImage(request.url, request.options);
    close();
    return true;
  };
  events.listen(root, 'click', event => {
    const tab = event.target?.closest?.('[data-image-tab]')?.dataset?.imageTab;
    if (tab) { event.preventDefault?.(); switchTab(tab); return; }
    const action = event.target?.closest?.('[data-image-action]')?.dataset?.imageAction;
    if (action === 'close' || action === 'cancel') { event.preventDefault?.(); close(); }
    if (action === 'confirm') { event.preventDefault?.(); confirm(); }
  });
  events.listen(q('#image-file-input'), 'change', event => readFile(event.target));
  events.listen(choose, 'click', () => q('#image-file-input').click());
  events.listen(q('#image-url-input'), 'input', () => { feedback.textContent = ''; projectAvailability(); });
  events.listen(q('#image-upload-area'), 'dragover', event => { event.preventDefault(); event.stopPropagation(); });
  events.listen(q('#image-upload-area'), 'drop', event => { event.preventDefault(); event.stopPropagation(); void readFile({ files: event.dataTransfer?.files || [] }); });
  return Object.freeze({ open, close, switchTab, confirm, destroy() { if (destroyed) return; destroyed = true; const errors = []; for (const action of [() => close(), () => events.destroy(), () => shell.destroy(), () => imageController.destroy()]) try { action(); } catch (error) { errors.push(error); } if (errors.length) throw new AggregateError(errors, 'Editor dialog cleanup failed.'); } });
  } catch (error) {
    const errors = [error];
    try { events.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { shell.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    if (errors.length > 1) throw new AggregateError(errors, 'Editor dialog construction failed.');
    throw error;
  }
}
