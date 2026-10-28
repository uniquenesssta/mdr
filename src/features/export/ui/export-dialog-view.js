/** Own compact format/options presentation and delegate every export to the existing command port. */
import { createSafeElement, createEventScope } from '../../../ui/dom/index.js';
import { createIconView } from '../../../ui/components/icon-view.js';
import { ModalShell } from '../../../ui/components/modal-shell.js';

export function createExportDialogView({ overlayRoot, trigger, commands, readInput, beforeOpen = () => {} }) {
  const doc = overlayRoot.ownerDocument;
  const node = (tag, options = {}) => createSafeElement(doc, tag, options);
  const button = (text, className = '') => node('button', { text, className, attributes: { type: 'button' } });
  const root = node('div', { id: 'export-document-modal', className: 'modal-overlay' });
  const panel = node('div', { className: 'modal writing-export-dialog', attributes: { role: 'dialog', 'aria-labelledby': 'export-document-title' } });
  const header = node('div', { className: 'modal-header' });
  const close = button(''); close.setAttribute('aria-label', '关闭导出'); close.append(createIconView(doc, 'icon-close'));
  header.append(node('h3', { id: 'export-document-title', text: '导出文档' }), close);
  const body = node('div', { className: 'modal-body' });
  const name = node('p', { className: 'writing-export-name' });
  const nameIcon = createIconView(doc, 'icon-menu-file');
  const nameText = node('span');
  name.append(nameIcon, nameText);
  const formats = node('div', { className: 'writing-export-formats', attributes: { role: 'group', 'aria-label': '导出格式' } });
  const formatButtons = new Map();
  for (const [id, label] of [['markdown', 'Markdown'], ['html', 'HTML'], ['word', 'Word'], ['image', '图片'], ['pdf', '打印']]) { const item = button(label); formats.append(item); formatButtons.set(id, item); }
  const imageOptions = node('div', { className: 'writing-export-options' });
  const width = node('select', { id: 'export-document-width', attributes: { 'aria-label': '图片宽度' } });
  for (const value of [1080, 1920]) width.append(node('option', { text: `${value} px`, attributes: { value } }));
  const background = node('select', { id: 'export-document-background', attributes: { 'aria-label': '图片背景' } });
  for (const [id, label] of [['light', '浅色'], ['dark', '深色']]) background.append(node('option', { text: label, attributes: { value: id } }));
  for (const [id, label, control] of [['export-document-width', '宽度', width], ['export-document-background', '背景', background]]) {
    const row = node('div', { className: 'writing-export-option' });
    row.append(node('label', { text: label, attributes: { for: id } }), control); imageOptions.append(row);
  }
  const feedback = node('p', { className: 'c-form-status', attributes: { role: 'status', 'aria-live': 'polite' } }); feedback.hidden = true;
  body.append(name, formats, imageOptions, feedback);
  const footer = node('div', { className: 'modal-footer' });
  const note = node('span', { className: 'writing-export-note' });
  body.insertBefore(note, feedback);
  const advanced = button('图片高级选项', 'writing-image-advanced');
  const cancel = button('取消'), submit = button('导出', 'primary');
  footer.append(advanced, cancel, submit); panel.append(header, body, footer); root.append(panel); overlayRoot.append(root);
  const events = createEventScope();
  const modal = new ModalShell(root, { panel });
  let format = 'markdown', busy = false, destroyed = false;
  const selectFormat = id => {
    format = id;
    panel.dataset.format = id;
    advanced.hidden = id !== 'image';
    for (const [key, item] of formatButtons) { item.classList.toggle('active', key === id); item.setAttribute('aria-pressed', key === id ? 'true' : 'false'); }
    imageOptions.hidden = id !== 'image';
    note.textContent = ({ markdown: '原始 Markdown', html: '独立 HTML 文件', word: 'Word 文档', image: 'PNG · 完整文档', pdf: '系统打印与另存 PDF' })[id];
    note.hidden = id === 'image';
  };
  const open = () => {
    if (destroyed) return false;
    beforeOpen();
    trigger.closest?.('.menu-dropdown')?.querySelector('.menu-trigger')?.focus({ preventScroll: true });
    nameText.textContent = String(readInput().name || '未命名文档.md'); name.title = nameText.textContent; feedback.hidden = true; selectFormat(format);
    return modal.open(null, { initialFocus: formatButtons.get(format), labelledBy: 'export-document-title' });
  };
  const run = async () => {
    if (busy || destroyed) return false;
    busy = true; submit.disabled = true; feedback.hidden = true;
    const selected = format;
    const input = { ...readInput(), ...(selected === 'image' ? { imageOptions: { ratio: width.value === '1920' ? '16:9' : '9:16', cropFit: false, background: background.value } } : {}) };
    try {
      modal.close('export');
      let result;
      if (selected === 'image') {
        const preview = await commands.invoke('renderImage', { input });
        if (preview?.status !== 'ready' || destroyed) return preview;
        result = await commands.invoke('saveImage', { input });
      } else result = await commands.invoke(({ markdown: 'exportMarkdown', html: 'exportHtml', word: 'exportWord', pdf: 'exportPdf' })[selected], { input });
      if (result?.status === 'failed' || result?.status === 'invalid') {
        open(); feedback.textContent = '导出未完成，请检查文档或保存位置后重试。'; feedback.hidden = false;
      }
      return result;
    } finally { busy = false; if (!destroyed) submit.disabled = false; }
  };
  try {
    events.listen(trigger, 'click', event => {
      if (event.target?.closest?.('[data-menu-command]')) return;
      open();
    });
    events.listen(close, 'click', () => modal.close('feature-close'));
    events.listen(cancel, 'click', () => modal.close('feature-close'));
    events.listen(advanced, 'click', () => { modal.close('advanced-image'); void commands.invoke('openImage'); });
    events.listen(submit, 'click', () => { void run().catch(error => { if (!destroyed) { open(); feedback.textContent = error?.message || String(error); feedback.hidden = false; } }); });
    for (const [id, item] of formatButtons) events.listen(item, 'click', () => selectFormat(id));
    selectFormat(format);
  } catch (error) { events.destroy(); modal.destroy(); root.remove(); throw error; }
  return Object.freeze({ open, destroy() { if (destroyed) return; destroyed = true; events.destroy(); modal.destroy(); root.remove(); } });
}
