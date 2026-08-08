/**
 * Responsibility: Own the autosave-delay preset/custom controls, presentation and range validation.
 * Imports: Generic DOM primitives only.
 * Exports: createAutosaveFieldView().
 * State/side effects: Owns only field DOM/listeners and transient validation presentation; Settings value changes are emitted to the controller.
 */
import { createEventScope, createSafeElement, requireElementRef } from '../../../ui/dom/index.js';

const PRESETS = Object.freeze([
  Object.freeze({ value: 500, label: '0.5 秒' }),
  Object.freeze({ value: 1000, label: '1 秒' }),
  Object.freeze({ value: 2000, label: '2 秒' }),
  Object.freeze({ value: 5000, label: '5 秒' })
]);
const MIN_SECONDS = 0.5;
const MAX_SECONDS = 3600;
const ERROR_MESSAGE = '自动保存间隔请输入 0.5–3600 秒';

export function createAutosaveFieldView(root, { onChange } = {}) {
  requireElementRef(root, 'autosave field root');
  if (typeof onChange !== 'function') throw new TypeError('Autosave field requires a change callback.');
  const documentRef = root.ownerDocument;
  const events = createEventScope();

  const field = createSafeElement(documentRef, 'div', { className: 'settings-field' });
  const label = createSafeElement(documentRef, 'label', {
    text: '自动保存间隔',
    attributes: { for: 'setting-autosave-delay' }
  });
  const select = createSafeElement(documentRef, 'select', { id: 'setting-autosave-delay' });
  for (const preset of PRESETS) {
    select.append(createSafeElement(documentRef, 'option', {
      text: preset.label,
      attributes: { value: String(preset.value) }
    }));
  }
  select.append(createSafeElement(documentRef, 'option', { text: '自定义', attributes: { value: 'custom' } }));

  const customWrap = createSafeElement(documentRef, 'div', {
    id: 'setting-autosave-custom-wrap',
    className: 'settings-inline-field'
  });
  customWrap.hidden = true;
  const custom = createSafeElement(documentRef, 'input', {
    id: 'setting-autosave-custom-seconds',
    attributes: {
      type: 'number',
      min: String(MIN_SECONDS),
      max: String(MAX_SECONDS),
      step: '0.5',
      inputmode: 'decimal',
      'aria-label': '自定义自动保存间隔'
    }
  });
  customWrap.append(custom, createSafeElement(documentRef, 'span', { text: '秒' }));
  field.append(label, select, customWrap);
  root.append(field);

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Autosave field view has been destroyed.');
  };

  function clearInvalid() {
    custom.removeAttribute('aria-invalid');
  }

  function readCustom() {
    const seconds = Number(custom.value);
    if (!Number.isFinite(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) return null;
    return Math.round(seconds * 1000);
  }

  function emitCurrent() {
    clearInvalid();
    if (select.value === 'custom') {
      const value = readCustom();
      if (value === null) return false;
      onChange(value);
      return true;
    }
    onChange(Number(select.value));
    return true;
  }

  try {
    events.listen(select, 'change', () => {
      customWrap.hidden = select.value !== 'custom';
      emitCurrent();
    });
    events.listen(custom, 'input', () => {
      if (select.value === 'custom') emitCurrent();
    });
  } catch (error) {
    try { events.destroy(); } catch {}
    field.remove();
    throw error;
  }

  return Object.freeze({
    render(value) {
      assertActive();
      const numeric = Number(value);
      const preset = PRESETS.some(item => item.value === numeric);
      select.value = preset ? String(numeric) : 'custom';
      custom.value = String(numeric / 1000);
      customWrap.hidden = preset;
      clearInvalid();
    },
    validate() {
      assertActive();
      if (select.value !== 'custom' || readCustom() !== null) {
        clearInvalid();
        return Object.freeze({ valid: true, message: '', focus: null });
      }
      custom.setAttribute('aria-invalid', 'true');
      return Object.freeze({ valid: false, message: ERROR_MESSAGE, focus: () => custom.focus() });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      try { events.destroy(); } catch (error) { errors.push(error); }
      try { field.remove(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy autosave field view cleanly.');
    }
  });
}
