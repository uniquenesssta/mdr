import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSettingsStore,
  mountClassicSettingsStorePort,
  SETTING_DEFAULTS
} from '../../../src/features/settings/index.js';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

function createStore(persist = () => {}) {
  return createSettingsStore({
    initialSnapshot: { ...SETTING_DEFAULTS, toolbarHiddenItems: [] },
    persist
  });
}

async function readText(path) {
  return (await readFile(resolve(ROOT, path), 'utf8')).replace(/\r\n?/g, '\n');
}

test('Atomic 4.8 classic bridge exposes only Settings Store committed/draft operations', () => {
  const host = {};
  const store = createStore();
  const mount = mountClassicSettingsStorePort(host, store);
  assert.deepEqual(Object.keys(mount.api), [
    'snapshot', 'draft', 'hasDraft', 'get', 'openDraft', 'updateDraft', 'applyDraft',
    'cancelDraft', 'commit', 'set'
  ]);
  assert.equal(mount.api.snapshot.theme, 'light');
  mount.api.openDraft();
  mount.api.updateDraft({ theme: 'dark' });
  assert.equal(mount.api.draft.theme, 'dark');
  assert.equal(mount.api.hasDraft, true);
  assert.equal('repository' in mount.api, false);
  assert.equal('storage' in mount.api, false);
  assert.equal(Object.prototype.propertyIsEnumerable.call(host, 'markdownEditorSettingsStorePort'), false);
});

test('Atomic 4.8 classic bridge rejects duplicate ownership and destroy is idempotent and terminal', () => {
  const host = {};
  const store = createStore();
  const mount = mountClassicSettingsStorePort(host, store);
  assert.throws(() => mountClassicSettingsStorePort(host, store), /already mounted/);
  const api = mount.api;
  mount.destroy();
  mount.destroy();
  assert.equal(Object.hasOwn(host, 'markdownEditorSettingsStorePort'), false);
  assert.throws(() => api.snapshot, /destroyed/);
  assert.throws(() => api.openDraft(), /destroyed/);
  assert.throws(() => api.commit({ theme: 'dark' }), /destroyed/);
});

test('Atomic 4.8 production bootstrap keeps Repository internal and mounts Store before classic application import', async () => {
  const source = await readText('src/bootstrap/module-entry.js');
  assert.match(source, /createSettingsRepository, createSettingsStore, mountClassicSettingsStorePort/);
  assert.match(source, /const settingsRepository = createSettingsRepository\(\{ storage \}\);/);
  assert.match(source, /settingsStore = createSettingsStore\(\{/);
  assert.match(source, /initialSnapshot: settingsRepository\.load\(\)/);
  assert.match(source, /persist: changes => settingsRepository\.save\(changes\)/);
  assert.match(source, /settingsPort = mountClassicSettingsStorePort\(portsHost, settingsStore\)/);
  assert.ok(source.indexOf('mountClassicSettingsStorePort') < source.indexOf('await importApplication();'));
  assert.match(source, /settingsPort\?\.destroy\(\)/);
  assert.match(source, /settingsStore\?\.destroy\(\)/);
  assert.doesNotMatch(source, /mountClassicSettingsRepositoryPort/);
});

test('Atomic 4.8 classic Settings dialog uses Store draft lifecycle and Cancel/Escape/backdrop converge on zero-write cancel', async () => {
  const [core, bootstrap, editorTools] = await Promise.all([
    readText('public/app/core.js'),
    readText('public/app/bootstrap.js'),
    readText('public/app/editor-tools.js')
  ]);
  const classic = [core, bootstrap, editorTools].join('\n');
  assert.doesNotMatch(classic, /markdownEditorSettingsRepositoryPort|Settings Repository compatibility port/);
  assert.match(bootstrap, /const restoredSettings = bootstrapSettingsStorePort\.snapshot;/);
  assert.match(core, /const draft = coreSettingsStorePort\.openDraft\(\);/);
  assert.match(core, /onClose: \(\) => coreSettingsStorePort\.cancelDraft\(\)/);
  assert.match(core, /function closeSettings\(\) \{\n      coreSettingsStorePort\.cancelDraft\(\);/);
  assert.match(core, /coreSettingsStorePort\.updateDraft\(draftChanges\);/);
  assert.match(core, /applied = coreSettingsStorePort\.applyDraft\(\);/);
  assert.match(core, /setAppTheme\(applied\.theme, false\)/);
  assert.match(core, /setLanguage\(applied\.language, false\)/);
  assert.match(core, /setLayoutMode\(applied\.layoutMode, false, false\)/);
  assert.match(editorTools, /editorToolsSettingsStorePort\.set\('layoutMode', nextMode\)/);
  assert.match(editorTools, /editorToolsSettingsStorePort\.set\('tableVisualEditing', nextEnabled\)/);
  assert.match(editorTools, /editorToolsSettingsStorePort\.set\('codeVisualEditing', nextEnabled\)/);
});

test('Atomic 4.8 retires the Repository compatibility bridge while Atomic 4.9 sections remain isolated from 4.10 application/UI', async () => {
  const rootEntries = (await readdir(resolve(ROOT, 'src/features/settings'))).sort();
  assert.deepEqual(rootEntries, ['compatibility', 'domain', 'index.js', 'infrastructure', 'sections', 'state']);
  assert.deepEqual(
    (await readdir(resolve(ROOT, 'src/features/settings/compatibility'))).sort(),
    ['classic-settings-store-port.js']
  );
  assert.deepEqual(
    (await readdir(resolve(ROOT, 'src/features/settings/state'))).sort(),
    ['settings-store.js']
  );
  for (const absent of ['application', 'ui']) assert.equal(rootEntries.includes(absent), false);
});
