/**
 * Responsibility: Own the read-only default-export-directory field and choose/clear interaction presentation.
 * Imports: Generic DOM primitives only.
 * Exports: createDirectoryFieldView().
 * State/side effects: Owns field DOM/listeners and busy presentation only; directory platform calls and Settings draft updates are controller-owned.
 */
import { createEventScope, createSafeElement, requireElementRef } from '../../../ui/dom/index.js';

export function createDirectoryFieldView(root, { onChoose, onClear } = {}) {
  requireElementRef(root, 'directory field root');
  if (typeof onChoose !== 'function' || typeof onClear !== 'function') {
    throw new TypeError('Directory field requires choose and clear callbacks.');
  }
  const documentRef = root.ownerDocument;
  const events = createEventScope();

  const field = createSafeElement(documentRef, 'div', { className: 'settings-field' });
  const label = createSafeElement(documentRef, 'label', {
    text: '默认导出路径',
    attributes: { for: 'setting-export-directory' }
  });
  const wrap = createSafeElement(documentRef, 'div', { className: 'settings-path-field' });
  const input = createSafeElement(documentRef, 'input', {
    id: 'setting-export-directory',
    attributes: { type: 'text', placeholder: '未设置：导出时手动选择路径', readonly: true }
  });
  const choose = createSafeElement(documentRef, 'button', { text: '选择目录', attributes: { type: 'button' } });
  const clear = createSafeElement(documentRef, 'button', { text: '清除', attributes: { type: 'button' } });
  wrap.append(input, choose, clear);
  field.append(
    label,
    wrap,
    createSafeElement(documentRef, 'p', {
      className: 'hint',
      text: 'Markdown、Word、HTML 和图片导出会默认打开此目录；PDF 由系统打印窗口选择保存位置。'
    })
  );
  root.append(field);

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Directory field view has been destroyed.');
  };

  try {
    events.listen(choose, 'click', () => onChoose());
    events.listen(clear, 'click', () => onClear());
  } catch (error) {
    try { events.destroy(); } catch {}
    field.remove();
    throw error;
  }

  return Object.freeze({
    setValue(value) {
      assertActive();
      input.value = String(value || '');
    },
    setBusy(busy) {
      assertActive();
      choose.disabled = Boolean(busy);
      clear.disabled = Boolean(busy);
      field.setAttribute('aria-busy', busy ? 'true' : 'false');
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      try { events.destroy(); } catch (error) { errors.push(error); }
      try { field.remove(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy directory field view cleanly.');
    }
  });
}
