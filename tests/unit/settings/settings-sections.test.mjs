import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EDITOR_SETTINGS_SECTION,
  GENERAL_SETTINGS_SECTION,
  PERFORMANCE_SETTINGS_SECTION,
  SAVE_SETTINGS_SECTION,
  SETTINGS_SCHEMA,
  SETTINGS_SECTION_DEFINITIONS,
  SETTINGS_SECTION_IDS,
  SETTING_IDS,
  SETTING_SECTIONS,
  TOOLBAR_SETTINGS_SECTION,
  getSettingsSectionDefinition,
  listSettingsSectionDefinitions
} from '../../../src/features/settings/index.js';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const EXPECTED = Object.freeze({
  general: Object.freeze([
    ['theme', 'select', 'settings-dialog'],
    ['language', 'select', 'settings-dialog'],
    ['layoutMode', 'select', 'settings-dialog'],
    ['sidebarVisible', 'toggle', 'settings-dialog']
  ]),
  editor: Object.freeze([
    ['editorFontSize', 'select', 'settings-dialog'],
    ['editorTextColor', 'color', 'settings-dialog'],
    ['activeLineColor', 'color', 'settings-dialog'],
    ['tableVisualEditing', 'toggle', 'external'],
    ['codeVisualEditing', 'toggle', 'external']
  ]),
  save: Object.freeze([
    ['autoSaveEnabled', 'toggle', 'settings-dialog'],
    ['autoSaveDelay', 'duration', 'settings-dialog'],
    ['exportDirectory', 'directory', 'settings-dialog']
  ]),
  toolbar: Object.freeze([
    ['toolbarVisible', 'toggle', 'settings-dialog'],
    ['toolbarHiddenItems', 'checklist', 'settings-dialog']
  ]),
  performance: Object.freeze([
    ['previewPerformanceMode', 'select', 'settings-dialog']
  ])
});
const SETTINGS_DIALOG_MARKERS = Object.freeze({
  theme: "'setting-theme'",
  language: "'setting-language'",
  layoutMode: "'setting-layout'",
  sidebarVisible: "'setting-sidebar-visible'",
  editorFontSize: "'setting-editor-font-size'",
  editorTextColor: "'setting-editor-text-color'",
  activeLineColor: "'setting-active-line-color'",
  autoSaveEnabled: "'setting-autosave-enabled'",
  autoSaveDelay: "'setting-autosave-delay'",
  exportDirectory: "'setting-export-directory'",
  toolbarVisible: "'setting-toolbar-visible'",
  toolbarHiddenItems: "'setting-toolbar-items'",
  previewPerformanceMode: "'setting-preview-performance-mode'"
});
const CONTROL_VALIDATION = Object.freeze({
  select: Object.freeze(['enum', 'integer-enum']),
  toggle: Object.freeze(['boolean']),
  color: Object.freeze(['optional-color']),
  duration: Object.freeze(['integer-range']),
  directory: Object.freeze(['trimmed-string']),
  checklist: Object.freeze(['string-array-subset'])
});

async function readText(path) {
  return (await readFile(resolve(ROOT, path), 'utf8')).replace(/\r\n?/g, '\n');
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function compact(section) {
  return section.fields.map(field => [field.settingId, field.control, field.surface]);
}

test('Atomic 4.9 exposes five ordered Section Modules with exact current field order and control semantics', () => {
  assert.deepEqual(SETTINGS_SECTION_IDS, ['general', 'editor', 'save', 'toolbar', 'performance']);
  assert.deepEqual(compact(GENERAL_SETTINGS_SECTION), EXPECTED.general);
  assert.deepEqual(compact(EDITOR_SETTINGS_SECTION), EXPECTED.editor);
  assert.deepEqual(compact(SAVE_SETTINGS_SECTION), EXPECTED.save);
  assert.deepEqual(compact(TOOLBAR_SETTINGS_SECTION), EXPECTED.toolbar);
  assert.deepEqual(compact(PERFORMANCE_SETTINGS_SECTION), EXPECTED.performance);
});

test('Section registry covers every Settings Schema id exactly once and preserves schema section ownership', () => {
  const describedIds = SETTINGS_SECTION_DEFINITIONS.flatMap(section => section.fields.map(field => field.settingId));
  assert.equal(describedIds.length, SETTING_IDS.length);
  assert.equal(new Set(describedIds).size, SETTING_IDS.length);
  assert.deepEqual([...describedIds].sort(), [...SETTING_IDS].sort());
  for (const section of SETTINGS_SECTION_DEFINITIONS) {
    assert.equal(section.id, SETTINGS_SECTION_IDS[SETTINGS_SECTION_DEFINITIONS.indexOf(section)]);
    for (const field of section.fields) assert.equal(SETTINGS_SCHEMA[field.settingId].section, section.id);
  }
});

test('Section field controls derive legal values from Schema validation instead of duplicating option lists', () => {
  for (const section of SETTINGS_SECTION_DEFINITIONS) {
    for (const field of section.fields) {
      const definition = SETTINGS_SCHEMA[field.settingId];
      assert.ok(CONTROL_VALIDATION[field.control].includes(definition.validation.kind), field.settingId);
      assert.deepEqual(Object.keys(field).sort(), ['control', 'settingId', 'surface']);
      assert.equal('options' in field, false);
      assert.equal('defaultValue' in field, false);
    }
  }
});

test('Current UI exposure remains 13 Settings Dialog fields plus two external visual-editing toggles', () => {
  const dialogIds = SETTINGS_SECTION_DEFINITIONS.flatMap(section => section.fields)
    .filter(field => field.surface === 'settings-dialog').map(field => field.settingId);
  const externalIds = SETTINGS_SECTION_DEFINITIONS.flatMap(section => section.fields)
    .filter(field => field.surface === 'external').map(field => field.settingId);
  assert.equal(dialogIds.length, 13);
  assert.deepEqual(externalIds, ['tableVisualEditing', 'codeVisualEditing']);
});

test('Section descriptors and registry public results are deeply immutable with stable lookup semantics', () => {
  for (const value of [SETTINGS_SECTION_IDS, SETTINGS_SECTION_DEFINITIONS, ...SETTINGS_SECTION_DEFINITIONS]) assertDeepFrozen(value);
  assert.equal(listSettingsSectionDefinitions(), SETTINGS_SECTION_DEFINITIONS);
  for (const section of SETTINGS_SECTION_DEFINITIONS) assert.equal(getSettingsSectionDefinition(section.id), section);
  assert.equal(getSettingsSectionDefinition('unknown'), null);
});

test('Section descriptors remain the field authority consumed by Atomic 4.10 Settings UI without taking DOM ownership', async () => {
  const [dialog, fieldFactory, autosave, color, directory, compatibility] = await Promise.all([
    readText('src/features/settings/ui/settings-dialog-view.js'),
    readText('src/features/settings/ui/settings-field-view.js'),
    readText('src/features/settings/ui/autosave-field-view.js'),
    readText('src/features/settings/ui/color-field-view.js'),
    readText('src/features/settings/ui/directory-field-view.js'),
    readText('public/compatibility/business-content.html')
  ]);
  assert.match(dialog, /listSettingsSectionDefinitions/);
  assert.ok(dialog.includes('for (const descriptor of section.fields) {'));
  assert.match(dialog, /descriptor.surface !== 'settings-dialog'/);
  assert.match(dialog, /createSettingsFieldView/);
  assert.match(fieldFactory, /descriptor.settingId/);
  assert.match(fieldFactory, /descriptor.control/);
  assert.match(fieldFactory, /createAutosaveFieldView/);
  assert.match(fieldFactory, /createColorFieldView/);
  assert.match(fieldFactory, /createDirectoryFieldView/);
  const uiSources = [dialog, fieldFactory, autosave, color, directory].join('\n');
  for (const [settingId, marker] of Object.entries(SETTINGS_DIALOG_MARKERS)) {
    assert.ok(uiSources.includes(marker), settingId);
  }
  assert.doesNotMatch(compatibility, /id="settings-modal"|id="setting-theme"/);
  assert.match(compatibility, /id="table-visual-editing-toggle"/);
  assert.match(compatibility, /id="code-visual-editing-toggle"/);
});

test('Atomic 4.9 section modules remain pure descriptions after Atomic 4.10 consumes them through the public Settings feature', async () => {
  const sectionFiles = (await readdir(resolve(ROOT, 'src/features/settings/sections'))).sort();
  assert.deepEqual(sectionFiles, [
    'editor-settings.js', 'general-settings.js', 'performance-settings.js', 'save-settings.js',
    'section-registry.js', 'settings-section.js', 'toolbar-settings.js'
  ]);
  for (const name of sectionFiles) {
    const source = await readText(`src/features/settings/sections/${name}`);
    assert.doesNotMatch(source, /\blocalStorage\s*\.|\bsessionStorage\s*\.|\bdocument\s*\.|\bwindow\s*\.|@tauri-apps|public\/app\/|src\/(?:editor|preview)\//);
  }
  const publicEntry = await readText('src/features/settings/index.js');
  assert.match(publicEntry, /sections\/section-registry\.js/);
  assert.match(publicEntry, /create-settings-feature\.js/);
  assert.match(publicEntry, /application\/settings-controller\.js/);
});
