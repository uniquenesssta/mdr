import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { checkGeneratedFiles, writeArchitectureBaseline } from '../scripts/architecture/checks.mjs';
import { createArchitectureFixture, moduleRecord } from './architecture/helpers.mjs';

const baselinePath = 'tests/architecture/fixtures/architecture-baseline.json';
const cliPath = resolve(import.meta.dirname, '../scripts/verify-generated-files.mjs');
const repositoryRoot = resolve(import.meta.dirname, '..');
const ignore = 'node_modules/\n.vite/\ndist/\ntarget/\n/logs/\n/artifacts/\n/.cargo-target/\n/.windows-driver-host/\n/.windows-driver-host.zip\n/.markdown-editor-windows-driver-host/\n/.markdown-editor-windows-driver-host.zip\n*.log\n';
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const fixture = (rules = ignore, files = {}) => createArchitectureFixture({
  '.gitignore': rules, 'src/main.js': 'export const ready = true;\n', ...files
}, [moduleRecord('src/main.js', { surface: 'esm-entrypoint' })]);
async function track(root, path) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), '{"fixture":true}\n');
  git(root, ['add', '-f', '--', path]);
}

for (const path of [
  '.vite/deps/package.json', '.VITE/deps/cache.json', 'dist/assets/bundle.js',
  'target/debug/app.exe', 'src-tauri/target/debug/app.exe', 'node_modules/library/index.js',
  'artifacts/browser/report.json', '.cargo-target/debug/app.exe',
  '.windows-driver-host/src-tauri/Cargo.toml', '.windows-driver-host.zip',
  '.markdown-editor-windows-driver-host/src-tauri/Cargo.toml', '.markdown-editor-windows-driver-host.zip'
]) test('R16-09 force-added output remains forbidden after exact baseline regeneration: ' + path, async () => {
  const root = await fixture(); await track(root, path); await writeArchitectureBaseline({ root });
  const issues = await checkGeneratedFiles({ root });
  assert.ok(issues.some(issue => issue.rule === 'tracked-generated-file-regression' && issue.path === path));
  assert.ok(issues.some(issue => issue.rule === 'generated-file-baseline-exemption' && issue.path === path));
});

for (const path of ['.vite/', 'dist/', 'target/', 'src-tauri/target/', 'artifacts/', '.windows-driver-host/']) {
  test('R16-09 shared ignore must protect the whole output directory: ' + path, async () => {
    const root = await fixture(ignore + '!' + path + '\n');
    assert.ok((await checkGeneratedFiles({ root })).some(issue => issue.rule === 'generated-output-ignore-missing' && issue.detail?.output === path));
  });
}

test('R16-09 local excludes cannot replace the shared output ignore policy', async () => {
  const root = await fixture(ignore.replace('target/\n', ''));
  await writeFile(join(root, '.git/info/exclude'), 'target/\n');
  assert.ok((await checkGeneratedFiles({ root })).some(issue => issue.rule === 'generated-output-ignore-missing' && issue.detail?.output === 'target/'));
});

test('R16-09 ignored local output and user documents remain on disk and outside the tracked output set', async () => {
  const root = await fixture(ignore, { 'documents/notes.md': '# User document\n',
    'src-tauri/tests/fixtures/store/changes.jsonl': '{"journal":true}\n',
    'tests/fixtures/import/article.md': '# Fixed input\n' });
  for (const path of ['.vite/deps/cache.json', 'dist/assets/bundle.js', 'target/debug/app.exe', 'logs/local.jsonl']) {
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), 'retained\n');
  }
  assert.deepEqual(await checkGeneratedFiles({ root }), []);
  assert.equal(await readFile(join(root, 'logs/local.jsonl'), 'utf8'), 'retained\n');
  assert.equal(await readFile(join(root, 'dist/assets/bundle.js'), 'utf8'), 'retained\n');
  assert.equal(await readFile(join(root, 'documents/notes.md'), 'utf8'), '# User document\n');
  assert.ok(git(root, ['ls-files']).includes('src-tauri/tests/fixtures/store/changes.jsonl'));
});

test('R16-09 CLI names the forced cache and fails even when its exact baseline contains it', async () => {
  const root = await fixture(); await track(root, '.vite/deps/package.json'); await writeArchitectureBaseline({ root });
  const result = spawnSync(process.execPath, [cliPath, '--root=' + root], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /tracked-generated-file-regression/);
  assert.match(result.stderr, /generated-file-baseline-exemption/); assert.match(result.stderr, /\.vite\/deps\/package\.json/);
});

test('R16-09 actual repository retires both cache blobs and every active generated-file exemption', async () => {
  const baseline = JSON.parse(await readFile(join(repositoryRoot, baselinePath), 'utf8'));
  assert.deepEqual(baseline.trackedGeneratedFiles, []);
  assert.equal(git(repositoryRoot, ['ls-files', '--', '.vite']).trim(), '');
  const retirement = baseline.auditCorrections.r16GeneratedRetirement;
  assert.equal(retirement.atomic, 'R16-09');
  assert.equal(retirement.removedTrackedGeneratedFiles.length, 2);
  for (const item of retirement.removedTrackedGeneratedFiles) {
    const bytes = execFileSync('git', ['show', retirement.sourceCommit + ':' + item.path], { cwd: repositoryRoot });
    assert.equal(bytes.length, item.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
    assert.equal(git(repositoryRoot, ['rev-parse', retirement.sourceCommit + ':' + item.path]).trim(), item.blobSha);
  }
  assert.deepEqual(await checkGeneratedFiles({ root: repositoryRoot }), []);
});
