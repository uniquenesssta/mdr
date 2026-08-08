/**
 * Responsibility: Own the immutable default values for every persisted Stage 4 user setting.
 * Imports: None.
 * Exports: SETTING_DEFAULTS.
 * State/side effects: Frozen data only; no DOM, storage, platform or lifecycle side effects.
 */
const EMPTY_TOOLBAR_ITEMS = Object.freeze([]);

export const SETTING_DEFAULTS = Object.freeze({
  theme: 'light',
  language: 'zh-CN',
  layoutMode: 'both',
  sidebarVisible: true,
  autoSaveEnabled: true,
  autoSaveDelay: 500,
  editorFontSize: 16,
  editorTextColor: '',
  activeLineColor: '',
  exportDirectory: '',
  toolbarVisible: true,
  toolbarHiddenItems: EMPTY_TOOLBAR_ITEMS,
  previewPerformanceMode: 'auto',
  tableVisualEditing: false,
  codeVisualEditing: false
});
