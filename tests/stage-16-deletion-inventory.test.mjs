import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildDeletionInventory, verifyDeletionInventory } from '../scripts/stage-16/deletion-inventory.mjs';
import { createArchitectureFixture, moduleRecord } from './architecture/helpers.mjs';

const baselineCommit = '0'.repeat(40);
const fixture = files => createArchitectureFixture(files,
  Object.keys(files).filter(path => /^(?:src|public)\//.test(path) && /\.(?:js|rs|html)$/.test(path))
    .map(path => moduleRecord(path, { frozen: path === 'src/editor/hybrid/ranges.js' })));
const inventory = root => buildDeletionInventory({ root, baselineCommit });
const item = (report, path) => report.candidates.find(entry => entry.path === path);

test('R16-01 literal imports, re-exports and new URL test reads block deletion', async () => {
  const root = await fixture({
    'src/runtime/performance.js': 'export const value=1;',
    'src/main.js': "export {value} from './runtime/performance.js';",
    'tests/reader.test.mjs': "readFile(new URL('../src/runtime/performance.js', import.meta.url));"
  });
  const report = await inventory(root), entry = item(report, 'src/runtime/performance.js');
  assert.equal(entry.status, 'referenced'); assert.equal(entry.deletionAllowed, false);
  assert.ok(entry.references.some(x => x.surface === 'production' && x.kind === 'module'));
  assert.ok(entry.references.some(x => x.surface === 'tests'));
});

test('R16-01 classic loader, HTML and public build copying are separate evidence', async () => {
  const root = await fixture({
    'public/app/core.js': 'window.test=1;',
    'src/main.js': "const paths=['/app/core.js'];const script=document.createElement('script');document.body.appendChild(script);",
    'index.html': '<script src="/app/core.js"></script>', 'vite.config.js': 'export default {};'
  });
  const entry = item(await inventory(root), 'public/app/core.js');
  for (const kind of ['classic-script', 'html-resource', 'public-copy']) assert.ok(entry.references.some(x => x.kind === kind), kind);
  assert.equal(entry.deletionAllowed, false);
});

test('R16-01 Rust mod and explicit path/include edges resolve the actual file', async () => {
  const root = await fixture({
    'src-tauri/src/main.rs': 'mod performance_log;',
    'src-tauri/src/performance_log.rs': 'pub fn run() {}',
    'src-tauri/tests/reader.rs': '#[path = "../src/performance_log.rs"]\nmod log;\nconst TEXT:&str=include_str!("../src/performance_log.rs");'
  });
  const entry = item(await inventory(root), 'src-tauri/src/performance_log.rs');
  assert.ok(entry.references.some(x => x.kind === 'rust-mod' && x.surface === 'rust'));
  assert.ok(entry.references.some(x => x.kind === 'rust-path' && x.surface === 'tests'));
  assert.ok(entry.references.some(x => x.kind === 'rust-include'));
});

test('R16-01 directory mod resolution does not invent a reference to the retired flat Rust file', async () => {
  const root = await fixture({ 'src-tauri/src/main.rs': 'mod performance_log;', 'src-tauri/src/performance_log/mod.rs': 'pub fn run() {}' });
  const report = await inventory(root);
  assert.equal(item(report, 'src-tauri/src/performance_log.rs').status, 'absent');
  assert.equal(item(report, 'src-tauri/src/performance_log.rs').references.length, 0);
  assert.ok(report.rustModules.some(x => x.target === 'src-tauri/src/performance_log/mod.rs'));
});

test('R16-01 ownership metadata without consumer matches is unproven rather than a deletion permit', async () => {
  const root = await fixture({ 'src/runtime/isolated.js': 'export const value=1;', 'src/main.js': 'await import(moduleUrl);' });
  const report = await inventory(root), entry = item(report, 'src/runtime/isolated.js');
  assert.equal(entry.status, 'unproven'); assert.equal(entry.deletionAllowed, false);
  assert.ok(report.uncertainties.some(x => x.kind === 'computed-import'));
});

test('R16-01 frozen models are protected even inside old directory candidates', async () => {
  const root = await fixture({ 'src/editor/hybrid/ranges.js': 'export const value=1;' });
  const report = await inventory(root), entry = item(report, 'src/editor/hybrid/ranges.js');
  assert.equal(entry.status, 'protected'); assert.equal(entry.deletionAllowed, false);
  assert.ok(report.protectedModels.some(x => x.path === entry.path && x.sha256 === entry.sha256));
});

test('R16-01 historical task paths remain represented after prior removal', async () => {
  const root = await fixture({ 'src/main.js': 'export {};' }), report = await inventory(root);
  for (const path of ['public/i18n.js', 'src/styles/main.css', 'src/editor/hybrid/widgets.js', 'public/app/scroll-sync.js']) {
    assert.equal(item(report, path).status, 'absent');
  }
});

test('R16-01 compatibility adapters and actual generated files expand the frozen scope', async () => {
  const root = await fixture({ 'src/features/menu/compatibility/port.js': 'export {};', '.vite/deps/package.json': '{}',
    'tests/classic-port.test.mjs': '// Valid compatibility behavior test, not a deletion candidate.' });
  const report = await inventory(root);
  assert.ok(item(report, 'src/features/menu/compatibility/port.js'));
  assert.ok(item(report, '.vite/deps/package.json'));
  assert.equal(item(report, 'tests/classic-port.test.mjs'), undefined);
});

test('R16-01 source or reference changes invalidate frozen evidence', async () => {
  const root = await fixture({ 'src/main.js': 'export {};' }), frozen = await inventory(root);
  await verifyDeletionInventory({ root, frozen });
  await writeFile(join(root, 'src/main.js'), "import './runtime/performance.js';");
  await assert.rejects(verifyDeletionInventory({ root, frozen }), /evidence drifted/);
});

test('R16-01 force-added candidates invalidate the tracked source inventory', async () => {
  const root = await fixture({ 'src/main.js': 'export {};' }), frozen = await inventory(root);
  await writeFile(join(root, 'src/new-runtime.js'), 'export {};');
  execFileSync('git', ['add', '--', 'src/new-runtime.js'], { cwd: root });
  await assert.rejects(verifyDeletionInventory({ root, frozen }), /evidence drifted/);
});

test('R16-01 modifying a deletion decision or omitting a candidate cannot pass verification', async () => {
  const root = await fixture({ 'src/main.js': 'export {};' }), frozen = await inventory(root);
  const forged = structuredClone(frozen); forged.candidates[0].deletionAllowed = true;
  await assert.rejects(verifyDeletionInventory({ root, frozen: forged }), /evidence drifted/);
  const missing = structuredClone(frozen); missing.candidates.pop();
  await assert.rejects(verifyDeletionInventory({ root, frozen: missing }), /evidence drifted/);
});

test('R16-01 docs changes do not masquerade as product reference drift', async () => {
  const root = await fixture({ 'src/main.js': 'export {};' }), frozen = await inventory(root);
  await writeFile(join(root, 'README.md'), '# Updated progress');
  await verifyDeletionInventory({ root, frozen });
});

test('R16-01 actual frozen evidence remains current and authorizes no deletion', async () => {
  const root = resolve(import.meta.dirname, '..');
  const frozen = JSON.parse(await readFile(join(root, 'docs/audit/r16-01-deletion-inventory.json'), 'utf8'));
  await verifyDeletionInventory({ root, frozen });
  assert.ok(frozen.candidates.length > 0); assert.ok(frozen.protectedModels.length >= 8);
  assert.ok(frozen.candidates.every(entry => entry.deletionAllowed === false));
});
