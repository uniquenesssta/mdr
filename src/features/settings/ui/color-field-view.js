/**
 * Responsibility: Own one Settings color control, follow-theme presentation and reset interaction.
 * Imports: Generic DOM primitives only.
 * Exports: createColorFieldView().
 * State/side effects: Owns only field DOM/listeners and whether the displayed swatch represents an explicit draft value; no runtime theme application.
  * Lifecycle: Explicit destroyable field View; destroy releases listeners and owned DOM.
 */
import { createEventScope, createSafeElement, requireElementRef } from '../../../ui/dom/index.js';

const THEME_DEFAULTS = Object.freeze({
  light: Object.freeze({ text: '#1a1d23', line: '#efedfc' }),
  dark: Object.freeze({ text: '#f0f2f7', line: '#252837' })
});

function resolveThemeColor(theme, kind) {
  const palette = theme === 'dark' ? THEME_DEFAULTS.dark : THEME_DEFAULTS.light;
  return kind === 'line' ? palette.line : palette.text;
}

export function createColorFieldView(root, {
  kind,
  inputId,
  label,
  ariaLabel = label,
  onChange
} = {}) {
  requireElementRef(root, 'color field root');
  if (!['text', 'line'].includes(kind)) throw new TypeError('Color field kind must be text or line.');
  if (typeof onChange !== 'function') throw new TypeError('Color field requires a change callback.');
  const documentRef = root.ownerDocument;
  const events = createEventScope();
  const field = createSafeElement(documentRef, 'div', { className: 'settings-field' });
  const fieldLabel = createSafeElement(documentRef, 'label', { text: label, attributes: { for: inputId } });
  const wrap = createSafeElement(documentRef, 'div', { className: 'settings-color-field' });
  const input = createSafeElement(documentRef, 'input', {
    id: inputId,
    attributes: { type: 'color', 'aria-label': ariaLabel }
  });
  const reset = createSafeElement(documentRef, 'button', {
    text: '跟随主题',
    attributes: { type: 'button' }
  });
  wrap.append(input, reset);
  field.append(fieldLabel, wrap);
  root.append(field);

  let destroyed = false;
  let explicitValue = '';
  let theme = 'light';

  const assertActive = () => {
    if (destroyed) throw new Error('Color field view has been destroyed.');
  };

  function renderValue() {
    input.value = explicitValue || resolveThemeColor(theme, kind);
    input.dataset.custom = explicitValue ? 'true' : 'false';
  }

  try {
    events.listen(input, 'input', () => {
      explicitValue = String(input.value || '').toLowerCase();
      input.dataset.custom = 'true';
      onChange(explicitValue);
    });
    events.listen(reset, 'click', () => {
      explicitValue = '';
      renderValue();
      onChange('');
    });
  } catch (error) {
    try { events.destroy(); } catch {}
    field.remove();
    throw error;
  }

  return Object.freeze({
    render(value, nextTheme = theme) {
      assertActive();
      explicitValue = String(value || '').toLowerCase();
      theme = nextTheme === 'dark' ? 'dark' : 'light';
      renderValue();
    },
    setTheme(nextTheme) {
      assertActive();
      theme = nextTheme === 'dark' ? 'dark' : 'light';
      if (!explicitValue) renderValue();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      try { events.destroy(); } catch (error) { errors.push(error); }
      try { field.remove(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy color field view cleanly.');
    }
  });
}
