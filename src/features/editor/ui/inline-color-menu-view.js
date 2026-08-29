/**
 * Responsibility: Own inline-color menu visibility/captured selection and send color commands through an injected command boundary.
 * Imports: Shared DOM event scope only.
 * Exports: createInlineColorMenuView.
 * State/side effects: Owns captured selection and color-menu DOM state; no document text.
 * Lifecycle: Explicit View with idempotent destroy(); closes menus and removes listeners.
 */
import { createEventScope } from '../../../ui/dom/index.js';

const CONFIG = Object.freeze({
  text: Object.freeze({ button: 'text-color-button', menu: 'text-color-menu', indicator: 'text-color-indicator', input: 'custom-text-color' }),
  highlight: Object.freeze({ button: 'highlight-color-button', menu: 'highlight-color-menu', indicator: 'highlight-color-indicator', input: 'custom-highlight-color' })
});

export function createInlineColorMenuView({ root, selection, commands, notify = () => {}, collapseSelection = () => false } = {}) {
  if (!root?.ownerDocument) throw new TypeError('Inline Color Menu View requires a toolbar root.');
  if (!selection || typeof selection.snapshot !== 'function') throw new TypeError('Inline Color Menu View requires Selection Service.');
  if (!commands || typeof commands.execute !== 'function') throw new TypeError('Inline Color Menu View requires a command boundary.');
  const events = createEventScope();
  let captured = null;
  let destroyed = false;

  const close = () => {
    for (const config of Object.values(CONFIG)) {
      root.querySelector(`#${config.menu}`)?.classList.remove('show');
      root.querySelector(`#${config.button}`)?.setAttribute('aria-expanded', 'false');
    }
  };
  const updateAvailability = () => {
    const value = selection.snapshot();
    const available = value.start < value.end;
    for (const config of Object.values(CONFIG)) {
      const button = root.querySelector(`#${config.button}`);
      if (button) button.disabled = !available;
    }
    if (!available) captured = null;
    return available;
  };
  const toggle = kind => {
    const config = CONFIG[kind];
    if (!config) return;
    const value = selection.snapshot();
    if (value.start === value.end) { notify('请先选择需要设置颜色的文字'); close(); return; }
    captured = value;
    const menu = root.querySelector(`#${config.menu}`);
    const button = root.querySelector(`#${config.button}`);
    const willShow = !menu?.classList.contains('show');
    close();
    if (willShow) {
      menu?.classList.add('show');
      button?.setAttribute('aria-expanded', 'true');
    }
  };
  const apply = (kind, color, clear = false) => {
    const target = captured || selection.snapshot();
    if (target.start === target.end) { notify('请先选择需要设置颜色的文字'); return; }
    const result = commands.execute(clear ? 'clear-color' : 'set-color', {
      kind,
      color,
      selection: target,
      collapse: Boolean(collapseSelection())
    });
    const indicator = root.querySelector(`#${CONFIG[kind].indicator}`);
    if (result?.applied && indicator) indicator.style.background = clear ? '' : String(color || '');
    if (result?.applied && !clear) {
      const input = root.querySelector(`#${CONFIG[kind].input}`);
      if (input) input.value = String(color || input.value || '');
    }
    captured = result?.selection ? Object.freeze({ ...target, ...result.selection }) : null;
    close();
    updateAvailability();
    return result;
  };

  events.listen(root, 'click', event => {
    const toggleButton = event.target?.closest?.('[data-color-menu-kind]');
    if (toggleButton) { event.preventDefault?.(); toggle(toggleButton.dataset.colorMenuKind); return; }
    const swatch = event.target?.closest?.('[data-inline-color]');
    if (swatch) { event.preventDefault?.(); apply(swatch.dataset.inlineColorKind, swatch.dataset.inlineColor); return; }
    const clearButton = event.target?.closest?.('[data-inline-color-clear]');
    if (clearButton) { event.preventDefault?.(); apply(clearButton.dataset.inlineColorClear, '', true); }
  });
  events.listen(root, 'change', event => {
    const input = event.target?.closest?.('[data-inline-color-custom]');
    if (input) apply(input.dataset.inlineColorCustom, input.value);
  });
  events.listen(root.ownerDocument, 'mousedown', event => {
    if (event.target?.closest?.('.color-dropdown')) return;
    close();
  });

  updateAvailability();
  return Object.freeze({
    toggle,
    close,
    updateAvailability,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      close();
      captured = null;
      events.destroy();
    }
  });
}
