import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { retiredSourcePaths, verifyRetiredInputsAbsent, isRetiredRuntimeUrl,
  assertSingleImplementationRuntime, assessSingleImplementationEvidence } from '../scripts/stage-16/single-implementation.mjs';

const paths = ['public/app/core.js', 'public/i18n.js', 'src/runtime/tauri.js', 'src/styles/main.css',
  'src/ui/compatibility/index.js', 'src-tauri/src/local_file.rs'].sort();
const inventory = () => ({ candidates: [...paths.map(path => ({ path, status: 'absent' })),
  { path: 'src/model-kernel/tree.js', status: 'protected' }], protectedModels: [{ path: 'src/model-kernel/tree.js' }] });
async function fixture(extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mdr-r1613-contract-'));
  for (const [path, text] of Object.entries({ 'docs/audit/r16-01-deletion-inventory.json': JSON.stringify(inventory()), ...extra })) {
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text);
  }
  return root;
}
function runtime(platform = 'browser') {
  return { ready: true, exactText: true, previewRendered: true, shells: 1, editors: 1, previews: 1,
    e2ePublished: false, globalTauriPublished: false, businessGlobals: [], nativeIpc: platform === 'tauri',
    nativeCanaryExact: platform === 'tauri' ? true : null,
    scripts: [{ type: 'module', url: 'http://owned/assets/index-current.js' }], resources: [] };
}
function pair() {
  const make = platform => ({ stage: 'R16.13', platform, commit: 'a'.repeat(40), status: 'passed',
    before: { absent: true, paths, publicAssets: 2 }, after: { absent: true, paths, publicAssets: 2 },
    build: { accepted: true, sourceSha256: 'b'.repeat(64), sourceFiles: 1, outputFiles: 1 }, runtime: runtime(platform) });
  return { browser: make('browser'), native: make('tauri'), commit: 'a'.repeat(40), paths };
}

test('R16-13 retired inputs preserve protected models and cannot hide behind a rewritten status', () => {
  const data = inventory(); data.candidates[0].status = 'protected';
  assert.deepEqual(retiredSourcePaths(data), paths);
});
test('R16-13 incomplete, duplicate and escaping retirement records fail admission', () => {
  for (const mutate of [data => data.candidates.shift(), data => data.candidates.push(data.candidates[0]),
    data => data.candidates.push({ path: 'src/../../outside.js' })]) {
    const data = inventory(); mutate(data); assert.throws(() => retiredSourcePaths(data));
  }
});
test('R16-13 absent inputs and harmless empty historical directories pass without deleting anything', async () => {
  const root = await fixture(); await mkdir(join(root, 'public/app/empty'), { recursive: true });
  assert.deepEqual((await verifyRetiredInputsAbsent({ projectRoot: root })).paths, paths);
});
test('R16-13 restored native, runtime and compatibility sources are rejected', async () => {
  for (const path of ['src-tauri/src/local_file.rs', 'src/runtime/tauri.js', 'src/ui/compatibility/index.js']) {
    const root = await fixture({ [path]: 'restored' }); await assert.rejects(verifyRetiredInputsAbsent({ projectRoot: root }), /restored/i);
  }
});
test('R16-13 an untracked unknown file under a retired root cannot evade the path inventory', async () => {
  const root = await fixture({ 'src/runtime/unlisted.js': 'restored' });
  await assert.rejects(verifyRetiredInputsAbsent({ projectRoot: root }), /restored/i);
});
test('R16-13 stale public and source-shaped build outputs fail even if omitted from the build manifest', async () => {
  for (const path of ['dist/app/core.js', 'dist/app/unlisted.js', 'dist/src/runtime/tauri.js']) {
    const root = await fixture({ [path]: 'stale' }); await assert.rejects(verifyRetiredInputsAbsent({ projectRoot: root }), /restored/i);
  }
});
test('R16-13 restored public inputs remain rejected after baseline status edits', async () => {
  const data = inventory(); data.candidates[0].status = 'referenced';
  const root = await fixture({ 'docs/audit/r16-01-deletion-inventory.json': JSON.stringify(data), 'public/app/core.js': 'restored' });
  await assert.rejects(verifyRetiredInputsAbsent({ projectRoot: root }), /restored/i);
});
test('R16-13 runtime resources normalize case, encoded paths and queries without rejecting current assets', () => {
  for (const url of ['/APP/Core.js?rev=2', '/%61pp/core.js', '/src/runtime/unknown.js', '/src/styles/main.css#x', '/%zz']) assert.equal(isRetiredRuntimeUrl(url, paths), true);
  assert.equal(isRetiredRuntimeUrl('/assets/index-current.js', paths), false);
});
test('R16-13 default browser and actual native runtime observations pass their distinct boundaries', () => {
  for (const platform of ['browser', 'tauri']) assert.doesNotThrow(() => assertSingleImplementationRuntime(runtime(platform), { platform, paths }));
});
test('R16-13 missing, duplicated, global, restored and emulated runtime observations fail', () => {
  for (const mutate of [r => r.ready = false, r => r.exactText = false, r => r.previewRendered = false,
    r => r.shells = 2, r => r.e2ePublished = true, r => r.businessGlobals.push('markdownEditorOld'),
    r => r.scripts[0].type = '', r => r.resources.push('/app/unlisted.js'), r => r.nativeIpc = true]) {
    const r = runtime(); mutate(r); assert.throws(() => assertSingleImplementationRuntime(r, { platform: 'browser', paths }));
  }
  const native = runtime('tauri'); native.nativeCanaryExact = false;
  assert.throws(() => assertSingleImplementationRuntime(native, { platform: 'tauri', paths }));
});
test('R16-13 aggregation requires both exact-commit runs, full before/after proof and matching built sources', () => {
  assert.equal(assessSingleImplementationEvidence(pair()).accepted, true);
  for (const mutate of [p => p.native = null, p => p.browser.commit = 'c'.repeat(40), p => p.native.status = 'failed',
    p => p.browser.after.absent = false, p => p.native.after.paths = [], p => p.native.build.sourceSha256 = 'c'.repeat(64),
    p => p.native.runtime.nativeCanaryExact = false]) {
    const p = pair(); mutate(p); assert.throws(() => assessSingleImplementationEvidence(p));
  }
});
test('R16-13 current checkout and actual dist contain none of the retired application inputs', async () => {
  const result = await verifyRetiredInputsAbsent({ projectRoot: process.cwd() });
  const frozen = JSON.parse(await readFile('docs/audit/r16-01-deletion-inventory.json', 'utf8'));
  assert.deepEqual(result.paths, retiredSourcePaths(frozen)); assert.equal(result.absent, true);
});
