/**
 * Responsibility: Define the authoritative immutable Settings Schema contract: legacy key, type, default, section, validation, serialization and impact event.
 * Imports: Frozen settings defaults plus the public locale registry contract.
 * Exports: SETTINGS_SCHEMA, SETTING_IDS, SETTING_SECTIONS, SETTINGS_IMPACT_EVENTS, getSettingDefinition(), listSettingDefinitions().
 * State/side effects: Immutable module-load schema only; no DOM, storage, platform or lifecycle side effects.
 */
import { LOCALE_IDS } from '../../../i18n/index.js';
import { SETTING_DEFAULTS } from './settings-defaults.js';

export const SETTING_SECTIONS = Object.freeze({
  GENERAL: 'general',
  EDITOR: 'editor',
  SAVE: 'save',
  TOOLBAR: 'toolbar',
  PERFORMANCE: 'performance'
});

export const SETTINGS_IMPACT_EVENTS = Object.freeze({
  THEME: 'settings.theme.changed',
  LANGUAGE: 'settings.language.changed',
  LAYOUT: 'settings.layout.changed',
  SIDEBAR: 'settings.sidebar.changed',
  AUTOSAVE: 'settings.autosave.changed',
  EDITOR: 'settings.editor.changed',
  EXPORT: 'settings.export.changed',
  TOOLBAR: 'settings.toolbar.changed',
  PREVIEW: 'settings.preview.changed',
  VISUAL_EDITING: 'settings.visual-editing.changed'
});

const TOOLBAR_ITEM_IDS = Object.freeze([
  'bold', 'italic', 'underline', 'strikethrough', 'script', 'textColor', 'highlight',
  'heading', 'quote', 'lists', 'code', 'link', 'image', 'table', 'find', 'mermaid'
]);
const EDITOR_FONT_SIZES = Object.freeze([14, 15, 16, 18, 20]);
const LAYOUT_MODES = Object.freeze(['both', 'hybrid', 'edit', 'preview']);
const PREVIEW_PERFORMANCE_MODES = Object.freeze(['auto', 'virtual', 'chapter', 'full']);
const THEMES = Object.freeze(['light', 'dark']);

function freezeMetadata(metadata) {
  const copy = { ...metadata };
  if (Array.isArray(copy.values)) copy.values = Object.freeze([...copy.values]);
  return Object.freeze(copy);
}

function defineSetting(id, options) {
  const defaultValue = SETTING_DEFAULTS[id];
  if (defaultValue === undefined) throw new Error(`Missing default for setting ${id}.`);
  return Object.freeze({
    id,
    key: options.key,
    type: options.type,
    defaultValue,
    section: options.section,
    validation: freezeMetadata(options.validation),
    serialization: freezeMetadata(options.serialization),
    impactEvent: options.impactEvent
  });
}

const DEFINITIONS = Object.freeze([
  defineSetting('theme', {
    key: 'md_editor_theme', type: 'string', section: SETTING_SECTIONS.GENERAL,
    validation: { kind: 'enum', values: THEMES },
    serialization: { kind: 'string', omitWhenEmpty: false },
    impactEvent: SETTINGS_IMPACT_EVENTS.THEME
  }),
  defineSetting('language', {
    key: 'md_editor_language', type: 'string', section: SETTING_SECTIONS.GENERAL,
    validation: { kind: 'enum', values: LOCALE_IDS },
    serialization: { kind: 'string', omitWhenEmpty: false },
    impactEvent: SETTINGS_IMPACT_EVENTS.LANGUAGE
  }),
  defineSetting('layoutMode', {
    key: 'md_editor_layout_mode', type: 'string', section: SETTING_SECTIONS.GENERAL,
    validation: { kind: 'enum', values: LAYOUT_MODES },
    serialization: { kind: 'string', omitWhenEmpty: false },
    impactEvent: SETTINGS_IMPACT_EVENTS.LAYOUT
  }),
  defineSetting('sidebarVisible', {
    key: 'md_editor_sidebar_visible', type: 'boolean', section: SETTING_SECTIONS.GENERAL,
    validation: { kind: 'boolean' },
    serialization: { kind: 'boolean-string', omitWhenEmpty: false },
    impactEvent: SETTINGS_IMPACT_EVENTS.SIDEBAR
  }),
  defineSetting('autoSaveEnabled', {
    key: 'md_editor_autosave_enabled', type: 'boolean', section: SETTING_SECTIONS.SAVE,
    validation: { kind: 'boolean' },
    serialization: { kind: 'boolean-string', omitWhenEmpty: false },
    impactEvent: SETTINGS_IMPACT_EVENTS.AUTOSAVE
  }),
  defineSetting('autoSaveDelay', {
    key: 'md_editor_autosave_delay', type: 'integer', section: SETTING_SECTIONS.SAVE,
    validation: { kind: 'integer-range', min: 500, max: 3_600_000 },
    serialization: { kind: 'integer-string', omitWhenEmpty: false },
    impactEvent: SETTINGS_IMPACT_EVENTS.AUTOSAVE
  }),
  defineSetting('editorFontSize', {
    key: 'md_editor_editor_font_size', type: 'integer', section: SETTING_SECTIONS.EDITOR,
    validation: { kind: 'integer-enum', values: EDITOR_FONT_SIZES },
    serialization: { kind: 'integer-string', omitWhenEmpty: false },
    impactEvent: SETTINGS_IMPACT_EVENTS.EDITOR
  }),
  defineSetting('editorTextColor', {
    key: 'md_editor_text_color', type: 'string', section: SETTING_SECTIONS.EDITOR,
    validation: { kind: 'optional-color' },
    serialization: { kind: 'string', omitWhenEmpty: true },
    impactEvent: SETTINGS_IMPACT_EVENTS.EDITOR
  }),
  defineSetting('activeLineColor', {
    key: 'md_editor_active_line_color', type: 'string', section: SETTING_SECTIONS.EDITOR,
    validation: { kind: 'optional-color' },
    serialization: { kind: 'string', omitWhenEmpty: true },
    impactEvent: SETTINGS_IMPACT_EVENTS.EDITOR
  }),
  defineSetting('exportDirectory', {
    key: 'md_editor_export_directory', type: 'string', section: SETTING_SECTIONS.SAVE,
    validation: { kind: 'trimmed-string' },
    serialization: { kind: 'string', omitWhenEmpty: true },
    impactEvent: SETTINGS_IMPACT_EVENTS.EXPORT
  }),
  defineSetting('toolbarVisible', {
    key: 'md_editor_toolbar_visible', type: 'boolean', section: SETTING_SECTIONS.TOOLBAR,
    validation: { kind: 'boolean' },
    serialization: { kind: 'boolean-string', omitWhenEmpty: false },
    impactEvent: SETTINGS_IMPACT_EVENTS.TOOLBAR
  }),
  defineSetting('toolbarHiddenItems', {
    key: 'md_editor_toolbar_hidden_items', type: 'string-array', section: SETTING_SECTIONS.TOOLBAR,
    validation: { kind: 'string-array-subset', values: TOOLBAR_ITEM_IDS },
    serialization: { kind: 'json-string-array', omitWhenEmpty: true },
    impactEvent: SETTINGS_IMPACT_EVENTS.TOOLBAR
  }),
  defineSetting('previewPerformanceMode', {
    key: 'md_editor_preview_performance_mode', type: 'string', section: SETTING_SECTIONS.PERFORMANCE,
    validation: { kind: 'enum', values: PREVIEW_PERFORMANCE_MODES },
    serialization: { kind: 'string', omitWhenEmpty: false },
    impactEvent: SETTINGS_IMPACT_EVENTS.PREVIEW
  }),
  defineSetting('tableVisualEditing', {
    key: 'md_editor_table_visual_editing', type: 'boolean', section: SETTING_SECTIONS.EDITOR,
    validation: { kind: 'boolean' },
    serialization: { kind: 'boolean-string', omitWhenEmpty: false },
    impactEvent: SETTINGS_IMPACT_EVENTS.VISUAL_EDITING
  }),
  defineSetting('codeVisualEditing', {
    key: 'md_editor_code_visual_editing', type: 'boolean', section: SETTING_SECTIONS.EDITOR,
    validation: { kind: 'boolean' },
    serialization: { kind: 'boolean-string', omitWhenEmpty: false },
    impactEvent: SETTINGS_IMPACT_EVENTS.VISUAL_EDITING
  })
]);

export const SETTING_IDS = Object.freeze(DEFINITIONS.map(definition => definition.id));
export const SETTINGS_SCHEMA = Object.freeze(Object.fromEntries(DEFINITIONS.map(definition => [definition.id, definition])));

export function getSettingDefinition(id) {
  return SETTINGS_SCHEMA[String(id || '')] || null;
}

export function listSettingDefinitions() {
  return DEFINITIONS;
}
