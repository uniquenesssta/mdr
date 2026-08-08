import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSettingsRepository,
  mountClassicSettingsRepositoryPort
} from '../../../src/features/settings/index.js';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const LEGACY_KEYS = Object.freeze([
  'md_editor_theme', 'md_editor_language', 'md_editor_layout_mode', 'md_editor_sidebar_visible',
  'md_editor_autosave_enabled', 'md_editor_autosave_delay', 'md_editor_editor_font_size',
  'md_editor_text_color', 'md_editor_active_line_color', 'md_editor_export_directory',
  'md_editor_toolbar_visible', 'md_editor_toolbar_hidden_items', 'md_editor_preview_performance_mode',
  'md_editor_table_visual_editing', 'md_editor_code_visual_editing'
]);

async function readText(path) {
  return (await readFile(resolve(ROOT, path), 'utf8')).replace(/\r\n?/g, '\n');
}

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

test('Atomic 4.7 classic bridge exposes typed load/get/save/set only and never exposes raw storage', () => {
  const storage = createStorage({ md_editor_theme: 'dark' });
  const repository = createSettingsRepository({ storage });
  const host = {};
  const mount = mountClassicSettingsRepositoryPort(host, repository);

  assert.deepEqual(Object.keys(mount.api), ['load', 'get', 'save', 'set']);
  assert.equal(mount.api.get('theme'), 'dark');
  assert.equal(mount.api.set('theme', 'light'), 'light');
  assert.equal(storage.values.get('md_editor_theme'), 'light');
  assert.equal(Object.prototype.propertyIsEnumerable.call(host, 'markdownEditorSettingsRepositoryPort'), false);
  assert.equal('storage' in mount.api, false);
});

test('Atomic 4.7 classic bridge rejects duplicate ownership and destroy is idempotent and terminal', () => {
  const repository = createSettingsRepository({ storage: createStorage() });
  const host = {};
  const mount = mountClassicSettingsRepositoryPort(host, repository);
  assert.throws(() => mountClassicSettingsRepositoryPort(host, repository), /already mounted/);

  const api = mount.api;
  mount.destroy();
  mount.destroy();
  assert.equal(Object.hasOwn(host, 'markdownEditorSettingsRepositoryPort'), false);
  assert.throws(() => api.load(), /destroyed/);
  assert.throws(() => api.get('theme'), /destroyed/);
  assert.throws(() => api.save({ theme: 'dark' }), /destroyed/);
  assert.throws(() => api.set('theme', 'dark'), /destroyed/);
});

test('Atomic 4.7 production bootstrap mounts Settings Repository before classic application import and owns compatibility teardown', async () => {
  const source = await readText('src/bootstrap/module-entry.js');
  assert.ok(source.includes("import { createSettingsRepository, mountClassicSettingsRepositoryPort } from '../features/settings/index.js';"));
  assert.ok(source.includes('const settingsRepository = createSettingsRepository({ storage });'));
  assert.ok(source.includes('settingsPort = mountClassicSettingsRepositoryPort(portsHost, settingsRepository);'));
  assert.ok(source.indexOf('settingsPort = mountClassicSettingsRepositoryPort') < source.indexOf('await importApplication();'));
  assert.ok(source.includes('settingsPort?.destroy();'));
});

test('Atomic 4.7 removes direct Settings persistence from classic scripts while leaving unrelated localStorage responsibilities intact', async () => {
  const [core, bootstrap, editorTools] = await Promise.all([
    readText('public/app/core.js'),
    readText('public/app/bootstrap.js'),
    readText('public/app/editor-tools.js')
  ]);
  const classic = [core, bootstrap, editorTools].join('\n');
  for (const key of LEGACY_KEYS) assert.equal(classic.includes(key), false, key);
  assert.ok(core.includes('coreSettingsRepositoryPort.save({'));
  assert.ok(core.includes("coreSettingsRepositoryPort.set('theme', next)"));
  assert.ok(core.includes("coreSettingsRepositoryPort.set('language', resolvedLocale)"));
  assert.ok(bootstrap.includes('const restoredSettings = bootstrapSettingsRepositoryPort.load();'));
  assert.ok(bootstrap.includes('setLayoutMode(savedLayoutMode, false, false)'));
  assert.ok(editorTools.includes("if (persist) editorToolsSettingsRepositoryPort.set('layoutMode', nextMode)"));
  assert.ok(editorTools.includes("editorToolsSettingsRepositoryPort.set('tableVisualEditing', enabled)"));
  assert.ok(editorTools.includes("editorToolsSettingsRepositoryPort.set('codeVisualEditing', enabled)"));
  // Non-settings storage remains intentionally unmigrated in this atomic.
  assert.ok(core.includes('localStorage.setItem(RECENT_FILES_KEY'));
  assert.ok(core.includes('localStorage.setItem(DOCS_KEY'));
  assert.ok(editorTools.includes('localStorage.setItem(EDITOR_COLLAPSED_KEY'));
});

test('Atomic 4.7 adds only Repository infrastructure and the scoped compatibility bridge; Store/UI/sections remain future atomics', async () => {
  const rootEntries = (await readdir(resolve(ROOT, 'src/features/settings'))).sort();
  assert.deepEqual(rootEntries, ['compatibility', 'domain', 'index.js', 'infrastructure']);
  assert.deepEqual(
    (await readdir(resolve(ROOT, 'src/features/settings/infrastructure'))).sort(),
    ['settings-repository.js']
  );
  assert.deepEqual(
    (await readdir(resolve(ROOT, 'src/features/settings/compatibility'))).sort(),
    ['classic-settings-repository-port.js']
  );
  for (const absent of ['application', 'state', 'sections', 'ui']) {
    assert.equal(rootEntries.includes(absent), false);
  }
});
