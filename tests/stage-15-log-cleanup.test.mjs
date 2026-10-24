import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { checkGeneratedFiles, writeArchitectureBaseline } from '../scripts/architecture/checks.mjs';
import { createArchitectureFixture, moduleRecord, GENERATED_OUTPUT_IGNORE_RULES } from './architecture/helpers.mjs';

const baselinePath = 'tests/architecture/fixtures/architecture-baseline.json';
const cliPath = resolve(import.meta.dirname, '../scripts/verify-generated-files.mjs');
const rootOfRepository = resolve(import.meta.dirname, '..');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const fixture = (ignore = '/logs/\n', extra = {}) => createArchitectureFixture({
  '.gitignore': GENERATED_OUTPUT_IGNORE_RULES.filter(rule => rule !== '/logs/').join('\n') + '\n' + ignore,
  'src/main.js': 'export const ready = true;\n', ...extra
}, [moduleRecord('src/main.js', { surface: 'esm-entrypoint' })]);
async function track(root, path) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), '{"test":true}\n');
  git(root, ['add', '-f', '--', path]);
}
async function changeBaseline(root, change) {
  const path = join(root, baselinePath), baseline = JSON.parse(await readFile(path, 'utf8'));
  change(baseline); await writeFile(path, JSON.stringify(baseline));
}

for (const path of ['logs/new.jsonl', 'logs/nested/output.txt', 'logs/runtime.LOG', 'LOGS/mixed.jsonl']) {
  test('R15-13 rejects every tracked runtime log directory entry: ' + path, async () => {
    const root = await fixture(); await track(root, path);
    const issues = await checkGeneratedFiles({ root });
    assert.ok(issues.some(issue => issue.rule === 'tracked-runtime-log' && issue.path === path));
  });
}

test('R15-13 an exact generated-file baseline cannot exempt a tracked runtime log', async () => {
  const root = await fixture(), path = 'logs/previously-accepted.jsonl'; await track(root, path);
  await changeBaseline(root, baseline => baseline.trackedGeneratedFiles.push(path));
  const issues = await checkGeneratedFiles({ root });
  assert.ok(issues.some(issue => issue.rule === 'tracked-runtime-log' && issue.path === path));
  assert.ok(issues.some(issue => issue.rule === 'runtime-log-baseline-exemption' && issue.path === path));
});

test('R15-13 a retired runtime log cannot remain in the active exemption baseline', async () => {
  const root = await fixture(), path = 'logs/retired.jsonl';
  await changeBaseline(root, baseline => baseline.trackedGeneratedFiles.push(path));
  assert.ok((await checkGeneratedFiles({ root })).some(issue => issue.rule === 'runtime-log-baseline-exemption' && issue.path === path));
});

for (const [label, ignore] of [
  ['absent directory rule', '# no runtime log rule\n'],
  ['extension-only ignore', '*.jsonl\n'],
  ['explicit directory negation', '/logs/\n!/logs/\n']
]) test('R15-13 requires the directory to be ignored: ' + label, async () => {
  const root = await fixture(ignore);
  assert.ok((await checkGeneratedFiles({ root })).some(issue => issue.rule === 'runtime-logs-ignore-missing' && issue.path === '.gitignore'));
});

test('R15-13 local Git excludes cannot substitute for the shared repository ignore rule', async () => {
  const root = await fixture('# no shared log rule\n');
  await writeFile(join(root, '.git/info/exclude'), '/logs/\n');
  assert.ok((await checkGeneratedFiles({ root })).some(issue => issue.rule === 'runtime-logs-ignore-missing'));
});

test('R15-13 ignored local logs remain on disk without entering the tracked inventory', async () => {
  const root = await fixture();
  await mkdir(join(root, 'logs/nested'), { recursive: true });
  await writeFile(join(root, 'logs/nested/local.jsonl'), '{"local":true}\n');
  assert.deepEqual(await checkGeneratedFiles({ root }), []);
  assert.equal(await readFile(join(root, 'logs/nested/local.jsonl'), 'utf8'), '{"local":true}\n');
  assert.equal(git(root, ['ls-files', '--', 'logs']).trim(), '');
});

test('R15-13 a child negation cannot undo an ignored parent directory under Git rules', async () => {
  const root = await fixture('/logs/\n!logs/keep.jsonl\n');
  assert.deepEqual(await checkGeneratedFiles({ root }), []);
});

test('R15-13 legitimate journal JSONL fixtures outside the log directory remain allowed', async () => {
  const root = await fixture('/logs/\n', { 'src-tauri/tests/fixtures/store/changes.jsonl': '{"fixture":true}\n' });
  assert.deepEqual(await checkGeneratedFiles({ root }), []);
});

test('R15-13 non-log generated outputs also become non-exemptible after R16-09 retirement', async () => {
  const root = await fixture('/logs/\n', { '.vite/deps/package.json': '{"type":"module"}' });
  await track(root, '.vite/deps/package.json'); await writeArchitectureBaseline({ root });
  assert.ok((await checkGeneratedFiles({ root })).some(issue => issue.rule === 'generated-file-baseline-exemption' && issue.path === '.vite/deps/package.json'));
  await track(root, 'dist/unexpected.js');
  assert.ok((await checkGeneratedFiles({ root })).some(issue => issue.rule === 'tracked-generated-file-regression' && issue.path === 'dist/unexpected.js'));
});

test('R15-13 missing non-log generated exceptions still require an explicit baseline update', async () => {
  const root = await fixture();
  await changeBaseline(root, baseline => baseline.trackedGeneratedFiles.push('.vite/deps/missing.json'));
  assert.ok((await checkGeneratedFiles({ root })).some(issue => issue.rule === 'generated-file-baseline-stale'));
});

test('R15-13 the existing CLI fails with the tracked log path even after baseline regeneration', async () => {
  const root = await fixture(), path = 'logs/forced.jsonl'; await track(root, path);
  await writeArchitectureBaseline({ root });
  const result = spawnSync(process.execPath, [cliPath, '--root=' + root], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /tracked-runtime-log/); assert.match(result.stderr, /logs\/forced.jsonl/);
});

test('R15-13 the actual repository has no tracked runtime logs and keeps its shared ignore rule', async () => {
  const paths = git(rootOfRepository, ['ls-files', '-z']).split('\0').filter(path => /^logs(?:\/|$)/i.test(path));
  assert.deepEqual(paths, []);
  assert.deepEqual((await checkGeneratedFiles({ root: rootOfRepository })).filter(issue => /runtime-log/.test(issue.rule)), []);
});
