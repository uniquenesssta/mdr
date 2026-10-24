// Shared R16 admission facts: retired inputs, runtime observations and exact-run evidence.
import assert from 'node:assert/strict';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { posix, resolve } from 'node:path';

const anchors = ['public/app/core.js', 'public/i18n.js', 'src/runtime/tauri.js',
  'src/styles/main.css', 'src/ui/compatibility/index.js', 'src-tauri/src/local_file.rs'];
const roots = ['public/app', 'src/runtime', 'src/ui/compatibility'];
export const SINGLE_IMPLEMENTATION_TEXT = '# R16 single implementation 中文\n\n**Current entry** edits and previews without retired files.\n';

export function retiredSourcePaths(inventory) {
  assert.ok(Array.isArray(inventory.candidates) && Array.isArray(inventory.protectedModels), 'Missing deletion evidence.');
  const protectedPaths = new Set(inventory.protectedModels.map(row => row.path));
  const paths = inventory.candidates.map(row => row.path).filter(path => /^(?:src|public|src-tauri)\//.test(path) && !protectedPaths.has(path)).sort();
  assert.equal(new Set(paths).size, paths.length, 'Duplicate retired input.');
  for (const path of paths) assert.ok(!path.split('/').includes('..') && !path.includes('\\'), 'Invalid retired input path.');
  for (const path of anchors) assert.ok(paths.includes(path), 'Missing mandatory retired input: ' + path);
  return paths;
}

async function absent(path) {
  try { await lstat(path); } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return; throw error; }
  assert.fail('Retired input was restored: ' + path);
}
async function emptyTree(path) {
  let stat;
  try { stat = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Retired tree contains a file/link: ' + path);
  for (const row of await readdir(path, { withFileTypes: true })) {
    assert.ok(row.isDirectory() && !row.isSymbolicLink(), 'Retired tree contains a restored input: ' + resolve(path, row.name));
    await emptyTree(resolve(path, row.name));
  }
}
export async function verifyRetiredInputsAbsent({ projectRoot, distRoot = resolve(projectRoot, 'dist') }) {
  const inventory = JSON.parse(await readFile(resolve(projectRoot, 'docs/audit/r16-01-deletion-inventory.json'), 'utf8'));
  const paths = retiredSourcePaths(inventory);
  const retiredRoots = new Set([...roots, ...paths.filter(path => path.includes('/compatibility/')).map(path => path.split('/compatibility/')[0] + '/compatibility')]);
  for (const path of paths) {
    await absent(resolve(projectRoot, path));
    await absent(resolve(distRoot, path));
    if (path.startsWith('public/')) await absent(resolve(distRoot, path.slice(7)));
  }
  for (const path of retiredRoots) {
    await emptyTree(resolve(projectRoot, path));
    await emptyTree(resolve(distRoot, path));
    if (path.startsWith('public/')) await emptyTree(resolve(distRoot, path.slice(7)));
  }
  return { absent: true, paths, publicAssets: paths.filter(path => path.startsWith('public/')).length, retiredRoots: [...retiredRoots].sort() };
}

export function isRetiredRuntimeUrl(value, paths) {
  let path;
  try { path = decodeURIComponent(new URL(value, 'https://owned.invalid').pathname).replaceAll('\\', '/').toLowerCase(); }
  catch { return true; }
  return roots.some(root => [root, root.replace(/^public\//, '')].some(prefix => path.startsWith('/' + prefix.toLowerCase() + '/')))
    || paths.some(source => [source, source.replace(/^public\//, '')].some(candidate => path === '/' + candidate.toLowerCase()));
}
export function assertSingleImplementationRuntime(runtime, { platform, paths }) {
  assert.ok(['browser', 'tauri'].includes(platform));
  for (const field of ['ready', 'exactText', 'previewRendered']) assert.equal(runtime[field], true, field + ': current entry did not complete.');
  for (const field of ['shells', 'editors', 'previews']) assert.equal(runtime[field], 1, field + ': missing or duplicate owner.');
  assert.equal(runtime.e2ePublished, false, 'Default entry must not require an E2E global.');
  assert.equal(runtime.globalTauriPublished, false);
  assert.deepEqual(runtime.businessGlobals, []);
  assert.equal(runtime.nativeIpc, platform === 'tauri', 'Browser emulation is not native evidence.');
  assert.equal(runtime.nativeCanaryExact, platform === 'tauri' ? true : null, 'Real native canary read failed.');
  assert.ok(runtime.scripts.length > 0 && runtime.scripts.every(row => row.type === 'module'));
  assert.ok(runtime.scripts.some(row => /\/assets\/[^/]+\.js(?:[?#]|$)/.test(row.url)), 'Missing built module entry.');
  for (const url of [...runtime.scripts.map(row => row.url), ...runtime.resources]) assert.equal(isRetiredRuntimeUrl(url, paths), false, 'Retired runtime resource requested: ' + url);
}

export function assessSingleImplementationEvidence({ browser, native, commit, paths }) {
  for (const [platform, result] of [['browser', browser], ['tauri', native]]) {
    assert.ok(result, 'Missing ' + platform + ' single-implementation evidence.');
    assert.equal(result.stage, 'R16.13'); assert.equal(result.platform, platform);
    assert.equal(result.commit, commit, 'Stale ' + platform + ' single-implementation evidence.');
    assert.equal(result.status, 'passed');
    for (const sample of [result.before, result.after]) {
      assert.equal(sample.absent, true); assert.deepEqual(sample.paths, paths, 'Incomplete retired-input proof.');
      assert.equal(sample.publicAssets, paths.filter(path => path.startsWith('public/')).length);
    }
    assert.equal(result.build.accepted, true); assert.match(result.build.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(result.build.sourceFiles > 0 && result.build.outputFiles > 0);
    assertSingleImplementationRuntime(result.runtime, { platform, paths });
  }
  assert.equal(browser.build.sourceSha256, native.build.sourceSha256, 'Browser and Tauri embedded different frontend sources.');
  return { accepted: true, commit, platforms: ['browser', 'tauri'], retiredSources: paths.length,
    retiredPublicAssets: browser.before.publicAssets, sourceSha256: browser.build.sourceSha256 };
}
