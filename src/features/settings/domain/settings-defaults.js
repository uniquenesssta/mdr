/**
 * Responsibility: Own the immutable default values for every persisted Stage 4 user setting.
 * Imports: None.
 * Exports: SETTING_DEFAULTS.
 * State/side effects: Frozen data only; no DOM, storage, platform or lifecycle side effects.
  * Lifecycle: Import-only immutable defaults module; no runtime lifecycle.
 */
const EMPTY_TOOLBAR_ITEMS = Object.freeze([]);

export const SETTING_DEFAULTS = Object.freeze({
  theme: 'light',
  language: 'zh-CN',
  layoutMode: 'hybrid',
  sidebarVisible: true,
  autoSaveEnabled: true,
  autoSaveDelay: 500,
  editorFontSize: 18,
  editorTextColor: '',
  activeLineColor: '',
  exportDirectory: '',
  toolbarVisible: true,
  toolbarHiddenItems: EMPTY_TOOLBAR_ITEMS,
  toolbarDensity: 'compact',
  toolbarPrimaryItems: Object.freeze(['heading', 'bold', 'italic', 'textColor', 'highlight', 'link']),
  previewPerformanceMode: 'auto',
  readingWidth: 'half',
  tableVisualEditing: false,
  codeVisualEditing: false
});
