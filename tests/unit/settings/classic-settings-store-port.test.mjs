import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSettingsStore,
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

test('R16-08 direct Settings Store preserves committed and draft operations without a host facade', () => {
  const api = createStore();
  for (const name of ['get','openDraft','updateDraft','applyDraft','cancelDraft','commit','set']) assert.equal(typeof api[name], 'function');
  assert.equal(api.snapshot.theme, 'light');
  api.openDraft(); api.updateDraft({ theme: 'dark' });
  assert.equal(api.draft.theme, 'dark'); assert.equal(api.hasDraft, true);
  assert.equal(api.snapshot.theme, 'light');
  api.applyDraft(); assert.equal(api.snapshot.theme, 'dark');
  assert.equal('repository' in api, false); assert.equal('storage' in api, false); api.destroy();
});
test('R16-08 Settings draft has one owner and Store disposal is terminal and idempotent', () => {
  const api = createStore(), second = createStore(), draft = api.openDraft();
  assert.equal(api.openDraft(), draft);
  api.updateDraft({ theme: 'dark' }); assert.equal(second.hasDraft, false);
  api.destroy(); api.destroy();
  assert.throws(() => api.snapshot, /destroyed/);
  assert.throws(() => api.openDraft(), /destroyed/);
  assert.throws(() => api.commit({ theme: 'dark' }), /destroyed/); second.destroy();
});

test('R16-08 bootstrap retains the internal Repository and injects the committed Store before starting the application', async () => {
  const source = await readText('src/bootstrap/module-entry.js');
  assert.match(source, /const settingsRepository = createSettingsRepository\(\{ storage \}\);/);
  assert.match(source, /const settingsStore = own\(createSettingsStore\(\{/);
  assert.match(source, /initialSnapshot: settingsRepository\.load\(\)/);
  assert.match(source, /persist: changes => settingsRepository\.save\(changes\)/);
  assert.ok(source.indexOf('own(createSettingsStore(') < source.indexOf('await importApplication()'));
  assert.match(source, /await startApplication\(\{ platform, documentSessionStore, settingsStore,/);
  assert.match(source, /lifetime\.destroy\(\)/);
  assert.doesNotMatch(source, /mountClassicSettings|compatibility-business-ports/);
});

test('Atomic 4.8 Store remains the Settings state authority after Atomic 4.10 migrates dialog ownership', async () => {
  const [entry, core, bootstrap, editorTools] = await Promise.all([
    readText('src/bootstrap/module-entry.js'),
    Promise.all([
      readText('src/features/documents/ui/document-workspace.js'),
      readText('src/features/menu/shell-menus.js'),
      readText('src/features/persistence/ui/workspace-status.js'),
      readText('src/features/layout/workspace-preferences.js')
    ]).then(sources => sources.join('\n')),
    readText('src/bootstrap/workspace-startup.js'),
    readText('src/features/layout/workspace-preferences.js')
  ]);
  const classic = [core, bootstrap, editorTools].join('\n');
  assert.doesNotMatch(classic, /markdownEditorSettingsRepositoryPort|Settings Repository compatibility port/);
  assert.match(bootstrap, /const restoredSettings = bootstrapSettingsStorePort\.snapshot;/);
  assert.match(entry, /createSettingsStore\(\{/);
  assert.match(entry, /createSettingsFeature\(\{/);
  assert.ok(entry.indexOf('createSettingsStore({') < entry.indexOf('createSettingsFeature({'));
  assert.match(core, /markdown-editor:settings-changed/);
  assert.doesNotMatch(core, /function\s+(?:openSettings|closeSettings)\b/);
  assert.match(editorTools, /editorToolsSettingsStorePort\.set\('layoutMode', nextMode\)/);
  assert.match(editorTools, /editorToolsSettingsStorePort\.set\('tableVisualEditing', nextEnabled\)/);
  assert.match(editorTools, /editorToolsSettingsStorePort\.set\('codeVisualEditing', nextEnabled\)/);
});

test('Atomic 4.8 retires the Repository compatibility bridge while Atomic 4.10 adds UI/application beside the unchanged Store boundary', async () => {
  const rootEntries = (await readdir(resolve(ROOT, 'src/features/settings'))).sort();
  assert.deepEqual(rootEntries.filter(name => name !== 'compatibility'), ['application', 'create-settings-feature.js', 'domain', 'index.js', 'infrastructure', 'sections', 'state', 'ui']);
  await assert.rejects(import('../../../src/features/settings/compatibility/classic-settings-store-port.js'), { code: 'ERR_MODULE_NOT_FOUND' });
  assert.deepEqual(
    (await readdir(resolve(ROOT, 'src/features/settings/state'))).sort(),
    ['settings-store.js']
  );
  assert.deepEqual(
    (await readdir(resolve(ROOT, 'src/features/settings/application'))).sort(),
    ['settings-apply-coordinator.js', 'settings-controller.js']
  );
});
