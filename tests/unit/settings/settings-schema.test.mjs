import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SETTINGS_IMPACT_EVENTS,
  SETTINGS_SCHEMA,
  SETTING_DEFAULTS,
  SETTING_IDS,
  SETTING_SECTIONS,
  deserializeSettingValue,
  getSettingDefinition,
  isValidSettingValue,
  listSettingDefinitions,
  normalizeSettingValue,
  serializeSettingValue,
  shouldOmitSettingValue
} from '../../../src/features/settings/index.js';
import { LOCALE_IDS } from '../../../src/i18n/index.js';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const EXPECTED_IDS = Object.freeze([
  'theme', 'language', 'layoutMode', 'sidebarVisible', 'autoSaveEnabled', 'autoSaveDelay',
  'editorFontSize', 'editorTextColor', 'activeLineColor', 'exportDirectory', 'toolbarVisible',
  'toolbarHiddenItems', 'previewPerformanceMode', 'tableVisualEditing', 'codeVisualEditing'
]);
const EXPECTED_KEYS = Object.freeze({
  theme: 'md_editor_theme',
  language: 'md_editor_language',
  layoutMode: 'md_editor_layout_mode',
  sidebarVisible: 'md_editor_sidebar_visible',
  autoSaveEnabled: 'md_editor_autosave_enabled',
  autoSaveDelay: 'md_editor_autosave_delay',
  editorFontSize: 'md_editor_editor_font_size',
  editorTextColor: 'md_editor_text_color',
  activeLineColor: 'md_editor_active_line_color',
  exportDirectory: 'md_editor_export_directory',
  toolbarVisible: 'md_editor_toolbar_visible',
  toolbarHiddenItems: 'md_editor_toolbar_hidden_items',
  previewPerformanceMode: 'md_editor_preview_performance_mode',
  tableVisualEditing: 'md_editor_table_visual_editing',
  codeVisualEditing: 'md_editor_code_visual_editing'
});
const EXPECTED_DEFAULTS = Object.freeze({
  theme: 'light', language: 'zh-CN', layoutMode: 'both', sidebarVisible: true,
  autoSaveEnabled: true, autoSaveDelay: 500, editorFontSize: 16, editorTextColor: '',
  activeLineColor: '', exportDirectory: '', toolbarVisible: true,
  toolbarHiddenItems: Object.freeze([]), previewPerformanceMode: 'auto',
  tableVisualEditing: false, codeVisualEditing: false
});
const EXPECTED_TOOLBAR_ITEMS = Object.freeze([
  'bold', 'italic', 'underline', 'strikethrough', 'script', 'textColor', 'highlight',
  'heading', 'quote', 'lists', 'code', 'link', 'image', 'table', 'find', 'mermaid'
]);

async function readText(path) {
  return (await readFile(resolve(ROOT, path), 'utf8')).replace(/\r\n?/g, '\n');
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test('Atomic 4.6 declares every persisted user setting with the exact legacy localStorage key', () => {
  assert.deepEqual(SETTING_IDS, EXPECTED_IDS);
  assert.deepEqual(Object.keys(SETTINGS_SCHEMA), EXPECTED_IDS);
  assert.deepEqual(Object.keys(SETTING_DEFAULTS), EXPECTED_IDS);
  assert.equal(new Set(Object.values(EXPECTED_KEYS)).size, EXPECTED_IDS.length);

  for (const id of EXPECTED_IDS) {
    const definition = getSettingDefinition(id);
    assert.equal(definition?.id, id);
    assert.equal(definition.key, EXPECTED_KEYS[id]);
    assert.equal(definition.defaultValue, SETTING_DEFAULTS[id]);
    assert.equal(typeof definition.type, 'string');
    assert.equal(typeof definition.section, 'string');
    assert.equal(typeof definition.validation.kind, 'string');
    assert.equal(typeof definition.serialization.kind, 'string');
    assert.match(definition.impactEvent, /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/);
  }
  assert.equal(getSettingDefinition('unknown-setting'), null);
  assert.equal(listSettingDefinitions().length, EXPECTED_IDS.length);
});

test('Settings defaults, sections and nested schema metadata are immutable and preserve existing defaults', () => {
  assert.deepEqual(SETTING_DEFAULTS, EXPECTED_DEFAULTS);
  assert.deepEqual(Object.values(SETTING_SECTIONS).sort(), ['editor', 'general', 'performance', 'save', 'toolbar']);
  assertDeepFrozen(SETTING_DEFAULTS);
  assertDeepFrozen(SETTING_SECTIONS);
  assertDeepFrozen(SETTINGS_IMPACT_EVENTS);
  assertDeepFrozen(SETTING_IDS);
  assertDeepFrozen(SETTINGS_SCHEMA);
  assertDeepFrozen(listSettingDefinitions());
});

test('Settings Schema preserves exact option surfaces used by the current Settings UI and editor toggles', () => {
  assert.deepEqual(SETTINGS_SCHEMA.theme.validation.values, ['light', 'dark']);
  assert.deepEqual(SETTINGS_SCHEMA.language.validation.values, LOCALE_IDS);
  assert.deepEqual(SETTINGS_SCHEMA.layoutMode.validation.values, ['both', 'hybrid', 'edit', 'preview']);
  assert.deepEqual(SETTINGS_SCHEMA.editorFontSize.validation.values, [14, 15, 16, 18, 20]);
  assert.deepEqual(SETTINGS_SCHEMA.previewPerformanceMode.validation.values, ['auto', 'virtual', 'chapter', 'full']);
  assert.deepEqual(SETTINGS_SCHEMA.toolbarHiddenItems.validation.values, EXPECTED_TOOLBAR_ITEMS);
  assert.deepEqual(
    [SETTINGS_SCHEMA.autoSaveDelay.validation.min, SETTINGS_SCHEMA.autoSaveDelay.validation.max],
    [500, 3_600_000]
  );
});

test('Settings validation rejects wrong types and illegal values while canonicalizing valid colors, paths and arrays', () => {
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.theme, 'dark'), true);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.theme, 'system'), false);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.sidebarVisible, true), true);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.sidebarVisible, 'true'), false);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.autoSaveDelay, 500), true);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.autoSaveDelay, 3_600_000), true);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.autoSaveDelay, 499), false);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.autoSaveDelay, 3_600_001), false);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.editorFontSize, 16), true);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.editorFontSize, 17), false);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.editorTextColor, '#AABBCC'), true);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.editorTextColor, '#abc'), false);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.toolbarHiddenItems, ['bold', 'mermaid']), true);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.toolbarHiddenItems, ['bold', 'bold']), false);
  assert.equal(isValidSettingValue(SETTINGS_SCHEMA.toolbarHiddenItems, ['unknown']), false);

  assert.equal(normalizeSettingValue(SETTINGS_SCHEMA.editorTextColor, '#AABBCC'), '#aabbcc');
  assert.equal(normalizeSettingValue(SETTINGS_SCHEMA.exportDirectory, '  C:/Exports  '), 'C:/Exports');
  assert.deepEqual(normalizeSettingValue(SETTINGS_SCHEMA.toolbarHiddenItems, ['mermaid', 'bold']), ['mermaid', 'bold']);
});

test('Settings serialization preserves legacy string formats and reports missing or invalid persisted values without storage I/O', () => {
  assert.equal(serializeSettingValue(SETTINGS_SCHEMA.sidebarVisible, false), 'false');
  assert.equal(serializeSettingValue(SETTINGS_SCHEMA.autoSaveDelay, 1500), '1500');
  assert.equal(serializeSettingValue(SETTINGS_SCHEMA.editorTextColor, '#AABBCC'), '#aabbcc');
  assert.equal(serializeSettingValue(SETTINGS_SCHEMA.exportDirectory, '  C:/Exports  '), 'C:/Exports');
  assert.equal(serializeSettingValue(SETTINGS_SCHEMA.toolbarHiddenItems, ['bold', 'mermaid']), '["bold","mermaid"]');

  assert.deepEqual(deserializeSettingValue(SETTINGS_SCHEMA.sidebarVisible, 'false'), { status: 'valid', value: false });
  assert.deepEqual(deserializeSettingValue(SETTINGS_SCHEMA.autoSaveDelay, '2000'), { status: 'valid', value: 2000 });
  assert.deepEqual(deserializeSettingValue(SETTINGS_SCHEMA.editorTextColor, '#AABBCC'), { status: 'valid', value: '#aabbcc' });
  assert.deepEqual(deserializeSettingValue(SETTINGS_SCHEMA.toolbarHiddenItems, '["bold","find"]'), { status: 'valid', value: ['bold', 'find'] });
  assert.deepEqual(deserializeSettingValue(SETTINGS_SCHEMA.theme, null), { status: 'missing', value: 'light' });
  assert.deepEqual(deserializeSettingValue(SETTINGS_SCHEMA.theme, 'system'), { status: 'invalid', value: 'light' });
  assert.deepEqual(deserializeSettingValue(SETTINGS_SCHEMA.toolbarHiddenItems, '{bad json'), { status: 'invalid', value: [] });

  assert.equal(shouldOmitSettingValue(SETTINGS_SCHEMA.editorTextColor, ''), true);
  assert.equal(shouldOmitSettingValue(SETTINGS_SCHEMA.activeLineColor, ''), true);
  assert.equal(shouldOmitSettingValue(SETTINGS_SCHEMA.exportDirectory, ''), true);
  assert.equal(shouldOmitSettingValue(SETTINGS_SCHEMA.toolbarHiddenItems, []), true);
  assert.equal(shouldOmitSettingValue(SETTINGS_SCHEMA.theme, 'light'), false);
});

test('Atomic 4.6 keeps legacy persistence keys schema-owned after Atomic 4.7 repository cutover', async () => {
  const [core, bootstrap, editorTools] = await Promise.all([
    readText('public/app/core.js'),
    readText('public/app/bootstrap.js'),
    readText('public/app/editor-tools.js')
  ]);
  const classicSource = [core, bootstrap, editorTools].join('\n');
  for (const key of Object.values(EXPECTED_KEYS)) assert.doesNotMatch(classicSource, new RegExp(key));
  for (const name of [
    'THEME_KEY', 'LANG_KEY', 'LAYOUT_MODE_KEY', 'SIDEBAR_VISIBLE_KEY', 'AUTOSAVE_ENABLED_KEY',
    'AUTOSAVE_DELAY_KEY', 'EDITOR_FONT_SIZE_KEY', 'EDITOR_TEXT_COLOR_KEY', 'ACTIVE_LINE_COLOR_KEY',
    'EXPORT_DIRECTORY_KEY', 'TOOLBAR_VISIBLE_KEY', 'TOOLBAR_ITEMS_KEY', 'PREVIEW_PERFORMANCE_MODE_KEY',
    'TABLE_VISUAL_EDITING_KEY', 'CODE_VISUAL_EDITING_KEY'
  ]) assert.doesNotMatch(classicSource, new RegExp('\\b' + name + '\\b'));
});

test('Atomic 4.6 Settings domain remains pure while later layers add Repository, Store and Atomic 4.9 sections', async () => {
  const domainFiles = (await readdir(resolve(ROOT, 'src/features/settings/domain'))).sort();
  assert.deepEqual(domainFiles, [
    'settings-defaults.js', 'settings-schema.js', 'settings-serialization.js', 'settings-validation.js'
  ]);

  for (const path of domainFiles.map(name => `src/features/settings/domain/${name}`)) {
    const source = await readText(path);
    assert.doesNotMatch(source, /\blocalStorage\s*\.|\bsessionStorage\s*\.|\bdocument\s*\.|\bwindow\s*\.|@tauri-apps|createPlatform\s*\(/);
  }
  const publicEntry = await readText('src/features/settings/index.js');
  assert.match(publicEntry, /infrastructure\/settings-repository\.js/);
  assert.match(publicEntry, /state\/settings-store\.js/);
  assert.match(publicEntry, /sections\/section-registry\.js/);
  assert.doesNotMatch(publicEntry, /from ['"]\.\/(?:application|ui)\//);
});
