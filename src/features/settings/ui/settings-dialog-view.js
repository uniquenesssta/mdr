/**
 * Responsibility: Own the Settings modal, section containers, navigation, feedback and lifecycle while delegating descriptor-backed field presentation.
 * Imports: Settings section registry, Settings field factory and generic UI primitives only; no Store, platform, persistence or business runtime.
 * Exports: createSettingsDialogView().
 * State/side effects: Owns dialog DOM/listeners and the ordered field View collection; all Settings values remain caller-owned draft state.
 */
import { ModalShell } from '../../../ui/components/modal-shell.js';
import { createIconView } from '../../../ui/components/icon-view.js';
import { createEventScope, createSafeElement, requireElementRef } from '../../../ui/dom/index.js';
import { listSettingsSectionDefinitions } from '../sections/section-registry.js';
import { createSettingsFieldView, getSettingsFieldLayoutGroup } from './settings-field-view.js';
import { createSettingsNavigationView } from './settings-navigation-view.js';

const SECTION_COPY = Object.freeze({
  general: Object.freeze({ title: '通用', summary: '控制应用外观、语言和启动后的默认工作区。' }),
  editor: Object.freeze({ title: '编辑器', summary: '调整源码编辑区域的字号、文字色和当前行提示。' }),
  save: Object.freeze({ title: '保存与导出', summary: '管理自动保存节奏，以及桌面版导出时默认打开的位置。' }),
  toolbar: Object.freeze({ title: '工具栏', summary: '保留常用格式按钮，隐藏暂时不需要的项目。' }),
  performance: Object.freeze({ title: '性能', summary: '选择超大文档的实时预览范围，平衡完整性与响应速度。' })
});

function createPage(documentRef, id) {
  const copy = SECTION_COPY[id];
  if (!copy) throw new Error(`Missing Settings section presentation for ${id}.`);
  const section = createSafeElement(documentRef, 'section', {
    className: 'preferences-page',
    attributes: { 'aria-labelledby': `settings-${id}-title` },
    dataset: { settingsPagePanel: id }
  });
  section.hidden = id !== 'general';
  const heading = createSafeElement(documentRef, 'div', { className: 'preferences-page-heading' });
  heading.append(
    createSafeElement(documentRef, 'h4', { id: `settings-${id}-title`, text: copy.title }),
    createSafeElement(documentRef, 'p', { text: copy.summary })
  );
  section.append(heading);
  return section;
}

function createFieldHost(documentRef, page, settingId, groups) {
  const groupId = getSettingsFieldLayoutGroup(settingId);
  if (!groupId) return page;
  if (!groups.has(groupId)) {
    const group = createSafeElement(documentRef, 'div', { className: 'settings-field-grid' });
    groups.set(groupId, group);
    page.append(group);
  }
  return groups.get(groupId);
}

export function createSettingsDialogView(overlayRoot, {
  onNavigate,
  onDraftChange,
  onRequestApply,
  onRequestCancel,
  onChooseDirectory,
  onClearDirectory
} = {}) {
  requireElementRef(overlayRoot, 'Settings overlay root');
  for (const [name, callback] of Object.entries({ onNavigate, onDraftChange, onRequestApply, onRequestCancel, onChooseDirectory, onClearDirectory })) {
    if (typeof callback !== 'function') throw new TypeError(`Settings dialog requires ${name}.`);
  }

  const documentRef = overlayRoot.ownerDocument;
  const events = createEventScope();
  const root = createSafeElement(documentRef, 'div', { id: 'settings-modal', className: 'modal-overlay' });
  const panel = createSafeElement(documentRef, 'div', {
    className: 'modal preferences-modal', attributes: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title' }
  });
  const header = createSafeElement(documentRef, 'div', { className: 'modal-header preferences-header' });
  const headingGroup = createSafeElement(documentRef, 'div');
  headingGroup.append(
    createSafeElement(documentRef, 'h3', { id: 'settings-title', text: '设置' }),
    createSafeElement(documentRef, 'p', { text: '按分类调整应用、编辑器和保存行为' })
  );
  const closeButton = createSafeElement(documentRef, 'button', { attributes: { type: 'button', 'aria-label': '关闭设置' } });
  closeButton.append(createIconView(documentRef, 'icon-close'));
  header.append(headingGroup, closeButton);

  const layout = createSafeElement(documentRef, 'div', { className: 'preferences-layout' });
  const navigationRoot = createSafeElement(documentRef, 'nav', { className: 'preferences-nav', attributes: { 'aria-label': '设置分类' } });
  const content = createSafeElement(documentRef, 'div', { className: 'preferences-content settings-body' });
  layout.append(navigationRoot, content);
  const feedback = createSafeElement(documentRef, 'div', { id: 'settings-feedback', className: 'c-form-status', attributes: { role: 'status', 'aria-live': 'polite' } });
  feedback.hidden = true;
  const footer = createSafeElement(documentRef, 'div', { className: 'modal-footer' });
  const cancelButton = createSafeElement(documentRef, 'button', { text: '取消', attributes: { type: 'button' } });
  const applyButton = createSafeElement(documentRef, 'button', { className: 'primary', text: '保存设置', attributes: { type: 'button' } });
  footer.append(feedback, cancelButton, applyButton);
  panel.append(header, layout, footer);
  root.append(panel);

  const pages = new Map();
  const fields = new Map();
  const groups = new Map();
  let navigation = null;
  let modal = null;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Settings dialog view has been destroyed.');
  };
  const emitDraftChange = (settingId, value) => {
    onDraftChange(settingId, value);
    if (settingId === 'theme') {
      for (const field of fields.values()) field.setTheme(value);
    }
  };

  try {
    for (const section of listSettingsSectionDefinitions()) {
      const page = createPage(documentRef, section.id);
      pages.set(section.id, page);
      content.append(page);
      for (const descriptor of section.fields) {
        if (descriptor.surface !== 'settings-dialog') continue;
        if (fields.has(descriptor.settingId)) throw new Error(`Duplicate Settings dialog field ${descriptor.settingId}.`);
        const fieldRoot = createFieldHost(documentRef, page, descriptor.settingId, groups);
        fields.set(descriptor.settingId, createSettingsFieldView(fieldRoot, descriptor, {
          onDraftChange: emitDraftChange,
          onChooseDirectory,
          onClearDirectory
        }));
      }
    }
    if (fields.size !== 13) throw new Error(`Settings dialog expected 13 descriptor-backed fields, received ${fields.size}.`);
    navigation = createSettingsNavigationView(navigationRoot, { onNavigate });
    events.listen(closeButton, 'click', () => onRequestCancel('feature-close'));
    events.listen(cancelButton, 'click', () => onRequestCancel('feature-close'));
    events.listen(applyButton, 'click', () => onRequestApply());
    modal = new ModalShell(root, { panel });
    overlayRoot.append(root);
  } catch (error) {
    const errors = [error];
    try { events.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { navigation?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    for (const field of [...fields.values()].reverse()) {
      try { field.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    }
    try { modal?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { root.remove(); } catch (cleanupError) { errors.push(cleanupError); }
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Failed to construct Settings dialog view cleanly.');
  }

  const directoryField = fields.get('exportDirectory');
  return Object.freeze({
    root,
    renderDraft(draft) {
      assertActive();
      for (const field of fields.values()) field.render(draft);
    },
    setActivePage(page) {
      assertActive();
      const activePage = navigation.setActive(page);
      for (const [id, section] of pages) {
        const active = id === activePage;
        section.hidden = !active;
        section.classList.toggle('active', active);
      }
      content.scrollTo?.({ top: 0, behavior: 'auto' });
      return activePage;
    },
    getActiveNavigationButton() {
      assertActive();
      return navigation.getActiveButton();
    },
    validate() {
      assertActive();
      for (const field of fields.values()) {
        const result = field.validate();
        if (!result.valid) return result;
      }
      return Object.freeze({ valid: true, message: '', focus: null });
    },
    setFeedback(message, kind = 'info') {
      assertActive();
      feedback.textContent = String(message || '');
      feedback.dataset.kind = String(kind || 'info');
      feedback.hidden = !feedback.textContent;
    },
    setDirectoryBusy(busy) {
      assertActive();
      directoryField?.setBusy(Boolean(busy));
    },
    setDirectoryValue(value) {
      assertActive();
      directoryField?.setValue(value);
    },
    open(options) {
      assertActive();
      return modal.open(null, options);
    },
    close(reason = 'programmatic') {
      assertActive();
      return modal.close(reason);
    },
    isOpen() {
      assertActive();
      return modal.isOpen();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      try { events.destroy(); } catch (error) { errors.push(error); }
      try { navigation.destroy(); } catch (error) { errors.push(error); }
      for (const field of [...fields.values()].reverse()) {
        try { field.destroy(); } catch (error) { errors.push(error); }
      }
      try { modal.destroy(); } catch (error) { errors.push(error); }
      try { root.remove(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy Settings dialog view cleanly.');
    }
  });
}
