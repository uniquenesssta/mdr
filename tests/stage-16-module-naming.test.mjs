import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { auditModuleNaming, inspectModulePaths } from '../scripts/architecture/module-naming.mjs';
import { checkGeneratedFiles, writeArchitectureBaseline } from '../scripts/architecture/checks.mjs';
import { createArchitectureFixture, moduleRecord } from './architecture/helpers.mjs';

const fixture = files => createArchitectureFixture(files, Object.keys(files).filter(path => /^(?:src|public|src-tauri\/src)\//.test(path)).map(path => moduleRecord(path)));
const cli = resolve('scripts/architecture/module-naming.mjs');

test('R16-11 rejects migration tokens in directories, compound extensions and camel-case filenames', () => {
  const paths = ['src/a-old.js', 'src/new/owner.js', 'src/a.v2.js', 'src/a-final.test.mjs',
    'scripts/run-copy2.mjs', 'src/OwnerFinal.js', 'src/ownerV2.js', 'src/ownerCopy.js',
    'src/archive.old/owner.js', 'scripts/config.copy'];
  const report = inspectModulePaths(paths);
  assert.deepEqual(report.issues.map(row => row.path).sort(), paths.sort());
  assert.ok(report.issues.every(row => row.rule === 'legacy-file-suffix'));
});

test('R16-11 rejects separated and compact dates and Windows copy numbering', () => {
  const paths = ['src/owner-2026-10-25.js', 'src/owner_20261025.js', 'src/owner.2026.10.25.test.mjs',
    'src/owner (2).js', 'src/owner (3).test.mjs', 'src/owner20261025.js',
    'scripts/owner_20261025120200.mjs', 'src/owner-2026-10-25T120200.js'];
  assert.deepEqual(inspectModulePaths(paths).findings.map(row => row.path).sort(), paths.sort());
});

test('R16-11 lexical domain words and recorded historical names remain legitimate', () => {
  const paths = ['src/folder.js', 'src/newline.js', 'src/copyright.js', 'src/finalize.js', 'src/renewal.js',
    'docs/audit/windows-validation-final.json', 'docs/rewrite-progress/stage-02/02-11-old-shell-cutover.md',
    'tests/architecture/stage-09-final-sync-legacy-removal.test.mjs', 'tests/stage-09-final-sync-legacy-removal.test.mjs'];
  const report = inspectModulePaths(paths);
  assert.deepEqual(report.issues, []);
  assert.equal(report.findings.length, 4);
  assert.ok(report.findings.every(row => row.decision === 'legitimate' && row.reason));
});

test('R16-11 path case collisions are rejected independently of the host filesystem', () => {
  const report = inspectModulePaths(['src/Widget.js', 'src/widget.js']);
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].rule, 'module-path-case-collision');
});

test('R16-11 exact copied JavaScript implementations cannot hide under unrelated names', async () => {
  const code = 'export function compute(value) { return value + 1; }\n';
  const root = await fixture({ 'src/alpha.js': code, 'src/beta.js': code });
  const report = await auditModuleNaming({ root });
  assert.deepEqual(report.identicalModules[0].paths, ['src/alpha.js', 'src/beta.js']);
  assert.ok(report.issues.some(row => row.rule === 'duplicate-module-content'));
});

test('R16-11 exact copied native implementations are checked with the same ownership rule', async () => {
  const code = 'pub fn compute(value: u8) -> u8 { value + 1 }\n';
  const root = await fixture({ 'src-tauri/src/alpha.rs': code, 'src-tauri/src/beta.rs': code });
  assert.equal((await auditModuleNaming({ root })).identicalModules.length, 1);
});

test('R16-11 empty fixture modules are not duplicate business implementations', async () => {
  const root = await fixture({ 'src/alpha.js': 'export {};\n', 'src/beta.js': 'export {};\n' });
  assert.deepEqual((await auditModuleNaming({ root })).issues, []);
});

test('R16-11 new same-named production modules require a scoped responsibility decision', async () => {
  const root = await fixture({ 'src/alpha/controller.js': 'export const owner = "alpha";', 'src/beta/controller.js': 'export const owner = "beta";' });
  const report = await auditModuleNaming({ root });
  assert.equal(report.sameBasenames[0].decision, 'unreviewed');
  assert.ok(report.issues.some(row => row.rule === 'unreviewed-module-basename'));
});

test('R16-11 untracked production discoveries cannot evade the filename check', async () => {
  const root = await fixture({ 'src/main.js': 'export const ready = true;' });
  await writeFile(join(root, 'src/editor-v2.js'), 'export const changed = true;');
  assert.ok((await auditModuleNaming({ root })).issues.some(row => row.path === 'src/editor-v2.js'));
});

test('R16-11 rewriting the architecture baseline cannot exempt dates or copied implementations', async () => {
  const code = 'export function compute(value) { return value + 1; }';
  const root = await fixture({ 'src/document-20261025.js': code, 'src/other.js': code });
  await writeArchitectureBaseline({ root });
  const issues = await checkGeneratedFiles({ root });
  assert.ok(issues.some(row => row.rule === 'legacy-file-suffix' && row.path === 'src/document-20261025.js'));
  assert.ok(issues.some(row => row.rule === 'duplicate-module-content'));
});

test('R16-11 CLI may record a failure but never turns it into an acceptance or changes the source', async () => {
  const source = 'export const ready = true;';
  const root = await fixture({ 'src/owner-final.js': source });
  const result = spawnSync(process.execPath, [cli, '--root=' + root, '--write'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(await readFile(join(root, 'docs/audit/r16-11-module-naming.json'), 'utf8'));
  assert.ok(report.issues.some(row => row.rule === 'legacy-file-suffix'));
  assert.equal(await readFile(join(root, 'src/owner-final.js'), 'utf8'), source);
});

test('R16-11 current same-named owners have distinct reviewed contracts and no copied implementation', async () => {
  const report = await auditModuleNaming();
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.identicalModules, []);
  assert.ok(report.sameBasenames.every(row => row.decision === 'legitimate' && row.reason));
  const commands = report.sameBasenames.find(row => row.name === 'command-registry.js');
  assert.equal(new Set(commands.owners.map(row => row.responsibility)).size, 2);
  assert.match(commands.reason, /typed command IDs/);
  assert.match(commands.reason, /terminal disposal/);
});

test('R16-11 the recorded audit matches current tracked names, implementations and scoped ownership', async () => {
  const { baselineCommit, ...frozen } = JSON.parse(await readFile('docs/audit/r16-11-module-naming.json', 'utf8'));
  assert.match(baselineCommit, /^[a-f0-9]{40}$/);
  assert.deepEqual(await auditModuleNaming(), frozen);
});

test('R16-11 missing required ownership evidence propagates a filesystem failure', async () => {
  const root = await fixture({ 'src/main.js': 'export const ready = true;' });
  await assert.rejects(auditModuleNaming({ root: join(root, 'missing') }), error => error.code === 'ENOENT');
});
