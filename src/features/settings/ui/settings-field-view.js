/**
 * Responsibility: Materialize one Settings field descriptor into its presentation View without owning section order, Settings state, persistence or runtime effects.
 * Imports: Settings Schema metadata, specialized field Views and generic DOM primitives only.
 * Exports: createSettingsFieldView().
 * State/side effects: Owns only the DOM/listeners for one descriptor-backed field; values are rendered from and emitted to the caller draft.
 */
import { createEventScope, createSafeElement, requireElementRef } from '../../../ui/dom/index.js';
import { getSettingDefinition } from '../domain/settings-schema.js';
import { createAutosaveFieldView } from './autosave-field-view.js';
import { createColorFieldView } from './color-field-view.js';
import { createDirectoryFieldView } from './directory-field-view.js';

const FIELD_COPY = Object.freeze({
  theme: Object.freeze({ id: 'setting-theme', label: '主题', layoutGroup: 'general-grid' }),
  language: Object.freeze({ id: 'setting-language', label: '语言', layoutGroup: 'general-grid' }),
  layoutMode: Object.freeze({ id: 'setting-layout', label: '默认布局', hint: '单视图模式在同一编辑器内呈现排版效果；光标所在块与选区会显示原始 Markdown。' }),
  sidebarVisible: Object.freeze({ id: 'setting-sidebar-visible', label: '启动时显示左侧栏', summary: '左侧栏包含当前会话文档、同目录文件树和标题大纲。' }),
  editorFontSize: Object.freeze({ id: 'setting-editor-font-size', label: '编辑器字号' }),
  editorTextColor: Object.freeze({ id: 'setting-editor-text-color', label: '源码编辑文字色', colorKind: 'text', layoutGroup: 'editor-colors' }),
  activeLineColor: Object.freeze({ id: 'setting-active-line-color', label: '光标所在行底色', colorKind: 'line', layoutGroup: 'editor-colors' }),
  autoSaveEnabled: Object.freeze({ id: 'setting-autosave-enabled', label: '启用自动保存', summary: '关闭后仅在手动保存、切换文档或导出时写入当前内容。' }),
  autoSaveDelay: Object.freeze({ id: 'setting-autosave-delay', label: '自动保存间隔' }),
  exportDirectory: Object.freeze({ id: 'setting-export-directory', label: '默认导出路径' }),
  toolbarVisible: Object.freeze({ id: 'setting-toolbar-visible', label: '显示格式工具栏', summary: '撤销、重做、视图和主题按钮始终保留。' }),
  toolbarHiddenItems: Object.freeze({ id: 'setting-toolbar-items', label: '工具栏项目' }),
  previewPerformanceMode: Object.freeze({ id: 'setting-preview-performance-mode', label: '超大文档预览策略' })
});

const OPTION_LABELS = Object.freeze({
  theme: Object.freeze({ light: '浅色', dark: '深色' }),
  language: Object.freeze({ 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English', ja: '日本語', ko: '한국어', es: 'Español', fr: 'Français', de: 'Deutsch', ru: 'Русский', pt: 'Português' }),
  layoutMode: Object.freeze({ both: '编辑 + 预览', hybrid: '单视图混合编辑', edit: '仅编辑', preview: '仅预览' }),
  editorFontSize: Object.freeze({ 14: '14 px', 15: '15 px', 16: '16 px', 18: '18 px', 20: '20 px' }),
  previewPerformanceMode: Object.freeze({ auto: '自动（推荐）', virtual: '全文虚拟预览', chapter: '仅当前章节', full: '完整预览（高负载）' })
});

const TOOLBAR_LABELS = Object.freeze({
  bold: '加粗', italic: '斜体', underline: '下划线', strikethrough: '删除线', script: '上下标', textColor: '文字颜色', highlight: '文字高亮', heading: '标题', quote: '引用', lists: '列表与任务', code: '代码', link: '链接', image: '图片', table: '表格', find: '查找', mermaid: 'Mermaid'
});

function createBaseAdapter(settingId, control, root, { render, destroy, validate, setBusy, setTheme, setValue } = {}) {
  return Object.freeze({
    settingId,
    control,
    root,
    render,
    validate: validate || (() => Object.freeze({ valid: true, message: '', focus: null })),
    setBusy: setBusy || (() => {}),
    setTheme: setTheme || (() => {}),
    setValue: setValue || (() => {}),
    destroy
  });
}

function createSelectField(root, descriptor, copy, onDraftChange) {
  const documentRef = root.ownerDocument;
  const events = createEventScope();
  const definition = getSettingDefinition(descriptor.settingId);
  const field = createSafeElement(documentRef, 'div', { className: 'settings-field' });
  const label = createSafeElement(documentRef, 'label', { text: copy.label, attributes: { for: copy.id } });
  const select = createSafeElement(documentRef, 'select', { id: copy.id });
  const labels = OPTION_LABELS[descriptor.settingId] || {};
  for (const value of definition.validation.values || []) {
    select.append(createSafeElement(documentRef, 'option', { text: labels[value] ?? String(value), attributes: { value: String(value) } }));
  }
  field.append(label, select);
  if (copy.hint) field.append(createSafeElement(documentRef, 'p', { className: 'hint', text: copy.hint }));
  if (descriptor.settingId === 'previewPerformanceMode') {
    for (const [title, text, warning] of [
      ['自动模式', '超大文档会启用虚拟预览；达到百万字符后优先显示当前章节，避免一次挂载全部预览节点。', false],
      ['完整预览', '会创建完整预览内容，适合较小文档；百万字符文档可能明显增加内存和渲染负载。', true]
    ]) {
      const card = createSafeElement(documentRef, 'div', { className: warning ? 'settings-info-card warning' : 'settings-info-card' });
      card.append(createSafeElement(documentRef, 'b', { text: title }), createSafeElement(documentRef, 'p', { text }));
      field.append(card);
    }
  }
  root.append(field);
  try {
    events.listen(select, 'change', () => {
      const value = definition.type === 'integer' ? Number(select.value) : select.value;
      onDraftChange(descriptor.settingId, value);
    });
  } catch (error) {
    try { events.destroy(); } catch {}
    field.remove();
    throw error;
  }
  return createBaseAdapter(descriptor.settingId, descriptor.control, field, {
    render: draft => { select.value = String(draft[descriptor.settingId]); },
    destroy: () => { events.destroy(); field.remove(); }
  });
}

function createToggleField(root, descriptor, copy, onDraftChange) {
  const documentRef = root.ownerDocument;
  const events = createEventScope();
  const label = createSafeElement(documentRef, 'label', { className: 'settings-check settings-card-check' });
  const input = createSafeElement(documentRef, 'input', { id: copy.id, attributes: { type: 'checkbox' } });
  const text = createSafeElement(documentRef, 'span');
  text.append(createSafeElement(documentRef, 'b', { text: copy.label }));
  if (copy.summary) text.append(createSafeElement(documentRef, 'small', { text: copy.summary }));
  label.append(input, text);
  root.append(label);
  try {
    events.listen(input, 'change', () => onDraftChange(descriptor.settingId, input.checked));
  } catch (error) {
    try { events.destroy(); } catch {}
    label.remove();
    throw error;
  }
  return createBaseAdapter(descriptor.settingId, descriptor.control, label, {
    render: draft => { input.checked = Boolean(draft[descriptor.settingId]); },
    destroy: () => { events.destroy(); label.remove(); }
  });
}

function createChecklistField(root, descriptor, copy, onDraftChange) {
  const documentRef = root.ownerDocument;
  const events = createEventScope();
  const definition = getSettingDefinition(descriptor.settingId);
  const ids = definition.validation.values || [];
  const field = createSafeElement(documentRef, 'div', { className: 'settings-field' });
  field.append(createSafeElement(documentRef, 'label', { text: copy.label }));
  const grid = createSafeElement(documentRef, 'div', { id: copy.id, className: 'toolbar-settings-grid' });
  const inputs = new Map();
  for (const id of ids) {
    const label = createSafeElement(documentRef, 'label');
    const input = createSafeElement(documentRef, 'input', { attributes: { type: 'checkbox' }, dataset: { toolbarSetting: id } });
    inputs.set(id, input);
    label.append(input, documentRef.createTextNode(TOOLBAR_LABELS[id] || id));
    grid.append(label);
  }
  field.append(grid);
  root.append(field);
  try {
    events.listen(grid, 'change', event => {
      if (!event?.target?.dataset?.toolbarSetting) return;
      onDraftChange(descriptor.settingId, ids.filter(id => !inputs.get(id).checked));
    });
  } catch (error) {
    try { events.destroy(); } catch {}
    field.remove();
    throw error;
  }
  return createBaseAdapter(descriptor.settingId, descriptor.control, field, {
    render: draft => {
      const hidden = draft[descriptor.settingId] || [];
      for (const id of ids) inputs.get(id).checked = !hidden.includes(id);
    },
    destroy: () => { events.destroy(); field.remove(); }
  });
}

export function createSettingsFieldView(root, descriptor, { onDraftChange, onChooseDirectory, onClearDirectory } = {}) {
  requireElementRef(root, 'Settings field root');
  if (!descriptor || descriptor.surface !== 'settings-dialog') throw new TypeError('Settings field view requires one settings-dialog descriptor.');
  if (typeof onDraftChange !== 'function') throw new TypeError('Settings field view requires a draft change callback.');
  const copy = FIELD_COPY[descriptor.settingId];
  if (!copy) throw new Error(`Missing Settings field presentation for ${descriptor.settingId}.`);

  if (descriptor.control === 'select') return createSelectField(root, descriptor, copy, onDraftChange);
  if (descriptor.control === 'toggle') return createToggleField(root, descriptor, copy, onDraftChange);
  if (descriptor.control === 'checklist') return createChecklistField(root, descriptor, copy, onDraftChange);
  if (descriptor.control === 'color') {
    const view = createColorFieldView(root, { kind: copy.colorKind, inputId: copy.id, label: copy.label, onChange: value => onDraftChange(descriptor.settingId, value) });
    return createBaseAdapter(descriptor.settingId, descriptor.control, null, { render: draft => view.render(draft[descriptor.settingId], draft.theme), setTheme: theme => view.setTheme(theme), destroy: () => view.destroy() });
  }
  if (descriptor.control === 'duration') {
    const view = createAutosaveFieldView(root, { onChange: value => onDraftChange(descriptor.settingId, value) });
    return createBaseAdapter(descriptor.settingId, descriptor.control, null, { render: draft => view.render(draft[descriptor.settingId]), validate: () => view.validate(), destroy: () => view.destroy() });
  }
  if (descriptor.control === 'directory') {
    if (typeof onChooseDirectory !== 'function' || typeof onClearDirectory !== 'function') throw new TypeError('Directory Settings field requires choose and clear callbacks.');
    const view = createDirectoryFieldView(root, { onChoose: onChooseDirectory, onClear: onClearDirectory });
    return createBaseAdapter(descriptor.settingId, descriptor.control, null, { render: draft => view.setValue(draft[descriptor.settingId]), setBusy: busy => view.setBusy(busy), setValue: value => view.setValue(value), destroy: () => view.destroy() });
  }
  throw new Error(`Unsupported Settings field control ${descriptor.control}.`);
}

export function getSettingsFieldLayoutGroup(settingId) {
  return FIELD_COPY[String(settingId || '')]?.layoutGroup || '';
}
