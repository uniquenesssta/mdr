/**
 * Responsibility: Own image-dialog tab/file-preview state and send one image insertion command after form validation.
 * Imports: Shared DOM event scope and public Import cancellation contract; injected Image Import Controller.
 * Exports: createImageDialogView.
 * State/side effects: Owns pending upload data URL and DOM listeners only; never owns editor text.
 * Lifecycle: Explicit View with idempotent destroy(); clears pending upload state, closes modal and removes listeners.
 */
import { createEventScope } from '../../../ui/dom/index.js';
import { isImageImportCancelled } from '../../import/index.js';
const OPEN_EVENT = 'markdown-editor:modal-shell-open';
const CLOSE_EVENT = 'markdown-editor:modal-shell-close';
function modal(root, type, detail) {
  const EventCtor = root.ownerDocument?.defaultView?.CustomEvent || globalThis.CustomEvent;
  root.dispatchEvent(new EventCtor(type, { detail }));
  if (detail.error) throw detail.error;
}
export function createImageDialogView({
  root,
  selection,
  imageController,
  insertImage,
  notify = () => {},
  confirmLargeFile = () => true,
  fallbackAlt = '图片',
  messages = {}
} = {}) {
  if (!root?.ownerDocument) throw new TypeError('Image Dialog View requires a modal root.');
  if (!selection || typeof selection.snapshot !== 'function') throw new TypeError('Image Dialog View requires Selection Service.');
  if (typeof insertImage !== 'function') throw new TypeError('Image Dialog View requires insertImage command.');
  if (typeof imageController?.readFile !== 'function' || typeof imageController?.createInsertion !== 'function') throw new TypeError('Image Dialog View requires Image Import Controller.');
  const events = createEventScope();
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
  };
  const close = () => { clearUpload(); pendingSelection = null; modal(root, CLOSE_EVENT, { reason: 'feature-close' }); };
  const open = () => {
    if (destroyed) return;
    clearUpload();
    pendingSelection = selection.snapshot();
    for (const selector of ['#image-url-input', '#image-url-alt', '#image-upload-alt', '#image-file-input']) {
      const element = q(selector); if (element) element.value = '';
    }
    q('#image-upload-preview')?.replaceChildren?.();
    switchTab('url');
    modal(root, OPEN_EVENT, { options: { initialFocus: q('#image-url-input'), onClose: () => { clearUpload(); pendingSelection = null; } } });
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
      notify(error?.code === 'IMAGE_IMPORT_TOO_LARGE' ? text.tooLarge
        : error?.code === 'IMAGE_IMPORT_UNSUPPORTED' ? text.selectFile : text.readFailed);
    }
  };
  const confirm = () => {
    if (destroyed) return false;
    const url = activeTab === 'upload' ? pendingDataUrl : String(q('#image-url-input')?.value || '').trim();
    const alt = String((activeTab === 'upload' ? q('#image-upload-alt') : q('#image-url-alt'))?.value || '').trim() || fallbackAlt;
    if (!url) { notify(activeTab === 'upload' ? text.selectFirst : text.enterUrl); return false; }
    const request = imageController.createInsertion(url, { alt, fallbackAlt, selection: pendingSelection || selection.snapshot() });
    if (!request) return false;
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
  return Object.freeze({ open, close, switchTab, confirm, destroy() { if (destroyed) return; destroyed = true; try { close(); } catch (_) {} imageController.destroy(); events.destroy(); } });
}
