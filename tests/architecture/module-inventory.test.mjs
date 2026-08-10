import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildModuleInventory, discoverProductionFiles, normalizeOwnershipManifest } from '../../scripts/stage-01/module-inventory-core.mjs';

const root = resolve(new URL('../..', import.meta.url).pathname);
const rawManifest = JSON.parse(await readFile(
  resolve(root, 'tests/architecture/fixtures/production-modules.json'),
  'utf8'
));
const manifest = normalizeOwnershipManifest(rawManifest);
const frozenBaseline = JSON.parse(await readFile(
  resolve(root, 'docs/rewrite-progress/stage-00/evidence/frozen-model-hashes.json'),
  'utf8'
));

const ALLOWED_SURFACES = new Set([
  'html-shell', 'legacy-classic-script', 'rust-build-script', 'rust-module',
  'rust-entrypoint', 'esm-module', 'esm-facade', 'esm-worker', 'esm-entrypoint',
  'stylesheet', 'build-config'
]);
const ALLOWED_MIGRATIONS = new Set([
  'retain', 'rewrite', 'decompose', 'split-and-remove', 'rewrite-and-remove',
  'remove-after-migration', 'decompose-preserving-contract', 'retain-frozen',
  'rewrite-facade', 'replace-with-composition-root', 'retain-until-final-switch',
  'retain-until-persistence-migration', 'split-by-feature',
  'remove-with-classic-business-compatibility', 'remove-with-classic-document-callers',
  'remove-with-classic-editor-callers', 'remove-with-classic-i18n-callers',
  'remove-with-classic-recent-files-callers', 'remove-with-classic-settings-callers'
]);

test('production module ownership fixture covers the exact runtime source surface', async () => {
  assert.equal(manifest.schemaVersion, 1);
  const records = manifest.modules;
  assert.ok(Array.isArray(records));
  const paths = records.map(record => record.path);
  assert.equal(new Set(paths).size, paths.length, 'module paths must be unique');
  assert.deepEqual([...paths].sort(), await discoverProductionFiles(root));

  for (const record of records) {
    assert.ok(record.path && record.responsibility && record.layer, `missing ownership fields: ${record.path}`);
    assert.ok(record.stateOwner && record.lifecycle, `missing lifecycle fields: ${record.path}`);
    assert.ok(ALLOWED_SURFACES.has(record.surface), `unknown surface for ${record.path}: ${record.surface}`);
    assert.ok(ALLOWED_MIGRATIONS.has(record.migration), `unknown migration for ${record.path}: ${record.migration}`);
  }
});

test('frozen model classification matches the Stage 0 frozen hash contract', () => {
  const frozenByPath = new Map(frozenBaseline.map(record => [record.path, record.sha256]));
  const classifiedFrozen = manifest.modules.filter(record => record.frozen);
  assert.deepEqual(classifiedFrozen.map(record => record.path).sort(), [...frozenByPath.keys()].sort());
  for (const record of classifiedFrozen) {
    assert.equal(record.migration, record.path === 'src-tauri/src/document_store.rs'
      ? 'decompose-preserving-contract'
      : 'retain-frozen');
  }
});

test('module inventory collector records imports, exports, listeners, state and side-effect signals', async () => {
  const inventory = await buildModuleInventory({ root, manifest: rawManifest });
  assert.equal(inventory.moduleCount, manifest.modules.length);
  for (const record of inventory.modules) {
    assert.ok(record.detected && Array.isArray(record.detected.imports));
    assert.ok(Array.isArray(record.detected.exports));
    assert.ok(Array.isArray(record.detected.listeners));
    assert.ok(Array.isArray(record.detected.globalWrites));
    assert.equal(typeof record.detected.sideEffects, 'object');
    assert.match(record.sha256, /^[a-f0-9]{64}$/);
  }
  const main = inventory.modules.find(record => record.path === 'src/main.js');
  assert.ok(main.detected.imports.includes('./platform/index.js'));
  assert.ok(main.detected.globalWrites.length > 0, 'current bootstrap globals must remain visible in the baseline inventory');
  const legacyScripts = inventory.modules.filter(record => record.surface === 'legacy-classic-script');
  assert.equal(legacyScripts.length, 8);
  assert.ok(legacyScripts.every(record => record.lifecycle === 'classic-script'));
});
