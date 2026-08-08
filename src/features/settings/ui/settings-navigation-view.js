/**
 * Responsibility: Own Settings section navigation controls and active-section presentation.
 * Imports: Generic DOM primitives and Settings section ids only.
 * Exports: createSettingsNavigationView().
 * State/side effects: Owns navigation button DOM and one scoped click listener. Lifecycle: explicit destroyable view.
 */
import { createEventScope, createSafeElement, requireElementRef } from '../../../ui/dom/index.js';
import { SETTINGS_SECTION_IDS } from '../sections/section-registry.js';

const COPY = Object.freeze({
  general: Object.freeze({ label: '通用', summary: '主题、语言与布局' }),
  editor: Object.freeze({ label: '编辑器', summary: '字号与显示颜色' }),
  save: Object.freeze({ label: '保存与导出', summary: '自动保存和默认路径' }),
  toolbar: Object.freeze({ label: '工具栏', summary: '显示与项目管理' }),
  performance: Object.freeze({ label: '性能', summary: '超大文档预览策略' })
});

function normalizePage(page) {
  const value = String(page || '');
  return SETTINGS_SECTION_IDS.includes(value) ? value : SETTINGS_SECTION_IDS[0];
}

function findButton(root, target) {
  let current = target;
  while (current && current !== root) {
    if (current.dataset?.settingsPage) return current;
    current = current.parentElement || null;
  }
  return null;
}

export function createSettingsNavigationView(root, { onNavigate } = {}) {
  requireElementRef(root, 'Settings navigation root');
  if (typeof onNavigate !== 'function') throw new TypeError('Settings navigation requires a navigate callback.');
  const documentRef = root.ownerDocument;
  const events = createEventScope();
  const buttons = new Map();
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Settings navigation view has been destroyed.');
  };

  try {
    const fragment = documentRef.createDocumentFragment();
    for (const id of SETTINGS_SECTION_IDS) {
      const copy = COPY[id];
      const button = createSafeElement(documentRef, 'button', {
        className: 'preferences-nav-item',
        attributes: { type: 'button', 'aria-selected': 'false' },
        dataset: { settingsPage: id }
      });
      button.append(
        createSafeElement(documentRef, 'span', { text: copy.label }),
        createSafeElement(documentRef, 'small', { text: copy.summary })
      );
      buttons.set(id, button);
      fragment.append(button);
    }
    root.replaceChildren(fragment);
    events.listen(root, 'click', event => {
      const button = findButton(root, event?.target);
      if (button) onNavigate(button.dataset.settingsPage);
    });
  } catch (error) {
    try { events.destroy(); } catch {}
    buttons.clear();
    root.replaceChildren();
    throw error;
  }

  return Object.freeze({
    setActive(page) {
      assertActive();
      const activePage = normalizePage(page);
      for (const [id, button] of buttons) {
        const active = id === activePage;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        button.tabIndex = active ? 0 : -1;
      }
      return activePage;
    },
    getActiveButton() {
      assertActive();
      return [...buttons.values()].find(button => button.classList.contains('active')) || null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      try { events.destroy(); } catch (error) { errors.push(error); }
      buttons.clear();
      try { root.replaceChildren(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy Settings navigation view cleanly.');
    }
  });
}
