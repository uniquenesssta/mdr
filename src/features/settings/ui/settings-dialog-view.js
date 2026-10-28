/**
 * Responsibility: Own the Settings modal, section containers, navigation, feedback and lifecycle while delegating descriptor-backed field presentation.
 * Imports: Settings section registry, Settings field factory and generic UI primitives only; no Store, platform, persistence or business runtime.
 * Exports: createSettingsDialogView().
 * State/side effects: Owns dialog DOM/listeners and the ordered field View collection; all Settings values remain caller-owned draft state.
  * Lifecycle: Explicit destroyable View; destroy releases owned field/navigation resources and DOM listeners.
 */
import { createIconView } from '../../../ui/components/icon-view.js';
import { createEventScope, createSafeElement, requireElementRef } from '../../../ui/dom/index.js';
import { listSettingsSectionDefinitions } from '../sections/section-registry.js';
import { createSettingsFieldView, getSettingsFieldLayoutGroup } from './settings-field-view.js';
import { createSettingsNavigationView } from './settings-navigation-view.js';
import { createToolbarPreviewView } from './toolbar-preview-view.js';
import { createLaunchPolicyFieldView } from './launch-policy-field-view.js';

const SECTION_COPY = Object.freeze({
  general: Object.freeze({ title: '常规', summary: '设置界面外观、语言与默认工作方式。' }),
  editor: Object.freeze({ title: '编辑器', summary: '调整编辑区域的字号和文字颜色。' }),
  save: Object.freeze({ title: '保存与导出', summary: '管理自动保存节奏，以及桌面版导出时默认打开的位置。' }),
  toolbar: Object.freeze({ title: '工具条', summary: '选择常驻项目和尺寸，其余命令可从菜单栏使用。' }),
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
  workspaceRoot = null,
  onNavigate,
  onDraftChange,
  onRequestApply,
  onRequestCancel,
  onChooseDirectory,
  onClearDirectory,
  onRequestReset = () => {},
  onLaunchPolicyChange = () => {},
  onOpen = () => {}
} = {}) {
  requireElementRef(overlayRoot, 'Settings overlay root');
  for (const [name, callback] of Object.entries({ onNavigate, onDraftChange, onRequestApply, onRequestCancel, onChooseDirectory, onClearDirectory })) {
    if (typeof callback !== 'function') throw new TypeError(`Settings dialog requires ${name}.`);
  }

  const documentRef = overlayRoot.ownerDocument;
  const events = createEventScope();
  const root = createSafeElement(documentRef, 'div', { id: 'settings-modal', className: 'settings-workspace' });
  root.hidden = true;
  const panel = createSafeElement(documentRef, 'div', {
    className: 'settings-workspace-panel', attributes: { role: 'region', 'aria-labelledby': 'settings-title' }
  });
  const header = createSafeElement(documentRef, 'div', { className: 'modal-header preferences-header' });
  const headingGroup = createSafeElement(documentRef, 'div');
  headingGroup.append(
    createSafeElement(documentRef, 'h3', { id: 'settings-title', text: '设置' })
  );
  header.append(headingGroup);

  const layout = createSafeElement(documentRef, 'div', { className: 'preferences-layout' });
  const navigationRoot = createSafeElement(documentRef, 'nav', { className: 'preferences-nav', attributes: { 'aria-label': '设置分类' } });
  const content = createSafeElement(documentRef, 'div', { className: 'preferences-content settings-body' });
  const surface = createSafeElement(documentRef, 'div', { className: 'settings-surface' });
  content.append(surface);
  const sidebar = createSafeElement(documentRef, 'aside', { className: 'settings-sidebar' });
  const returnButton = createSafeElement(documentRef, 'button', { className: 'sidebar-footer-action', text: '返回文档', attributes: { type: 'button' } });
  returnButton.append(createIconView(documentRef, 'icon-chevron-left'));
  sidebar.append(header, navigationRoot, returnButton);
  layout.append(sidebar, content);
  const feedback = createSafeElement(documentRef, 'div', { id: 'settings-feedback', className: "c-form-status settings-feedback", attributes: { role: 'status', 'aria-live': 'polite' } });
  feedback.hidden = true;
  const footer = createSafeElement(documentRef, 'div', { className: 'settings-footer' });
  const resetButton = createSafeElement(documentRef, 'button', { text: '恢复默认', attributes: { type: 'button' } });
  footer.append(createSafeElement(documentRef, 'p', { className: 'hint', text: '更改会自动保存在此设备。' }), feedback, resetButton);
  surface.append(footer);
  panel.append(layout);
  root.append(panel);

  const pages = new Map();
  const fields = new Map();
  const groups = new Map();
  const toolbarPreview = createToolbarPreviewView(documentRef);
  let navigation = null;
  let launchPolicy = null;
  let opened = false;
  let session = null;
  let returnFocus = null;
  let workspaceInert = false;
  const app = workspaceRoot?.parentElement || null;
  const closePage = (reason = 'programmatic') => {
    if (!opened) return false;
    opened = false;
    root.hidden = true;
    if (workspaceRoot) workspaceRoot.inert = workspaceInert;
    app?.classList.remove('settings-active');
    if (returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true });
    session?.onClose?.(reason);
    return true;
  };
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
      surface.append(page);
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
    if (fields.size !== 14) throw new Error(`Settings dialog expected 14 descriptor-backed fields, received ${fields.size}.`);
    launchPolicy = createLaunchPolicyFieldView(pages.get('general'), onLaunchPolicyChange);
    pages.get('toolbar').insertBefore(toolbarPreview.root, fields.get('toolbarPrimaryItems').root);
    navigation = createSettingsNavigationView(navigationRoot, { onNavigate });
    surface.append(footer);
    events.listen(returnButton, 'click', () => onRequestApply());
    events.listen(resetButton, 'click', () => onRequestReset());
    events.listen(root, 'keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); onRequestApply(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onRequestApply(); }
      event.stopPropagation();
    });
    if (app) app.append(root);
    else overlayRoot.append(root);
  } catch (error) {
    const errors = [error];
    try { events.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { navigation?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { launchPolicy?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    for (const field of [...fields.values()].reverse()) {
      try { field.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    }
    try { root.remove(); } catch (cleanupError) { errors.push(cleanupError); }
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Failed to construct Settings dialog view cleanly.');
  }

  const directoryField = fields.get('exportDirectory');
  return Object.freeze({
    root,
    launchPolicy,
    renderDraft(draft) {
      assertActive();
      for (const field of fields.values()) field.render(draft);
      toolbarPreview.render(draft);
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
      if (opened) return true;
      returnFocus = documentRef.activeElement;
      session = options;
      opened = true;
      // Preserve layout dimensions so returning does not rebuild the editor or preview.
      if (workspaceRoot) { workspaceInert = workspaceRoot.inert; workspaceRoot.inert = true; }
      app?.classList.add('settings-active');
      root.hidden = false;
      onOpen();
      options?.initialFocus?.focus?.({ preventScroll: true });
      if (navigation.getActiveButton()?.dataset.settingsPage === 'toolbar') {
        const item=fields.get('toolbarPrimaryItems').root.querySelector('input');
        item?.focus?.({ preventScroll:true });
        fields.get('toolbarPrimaryItems').root.scrollIntoView?.({ block:'nearest' });
      }
      return true;
    },
    close(reason = 'programmatic') {
      assertActive();
      return closePage(reason);
    },
    isOpen() {
      assertActive();
      return opened;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      try { events.destroy(); } catch (error) { errors.push(error); }
      try { toolbarPreview.destroy(); } catch (error) { errors.push(error); }
      try { launchPolicy?.destroy(); } catch (error) { errors.push(error); }
      try { navigation.destroy(); } catch (error) { errors.push(error); }
      for (const field of [...fields.values()].reverse()) {
        try { field.destroy(); } catch (error) { errors.push(error); }
      }
      try { closePage('destroy'); } catch (error) { errors.push(error); }
      try { root.remove(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy Settings dialog view cleanly.');
    }
  });
}
