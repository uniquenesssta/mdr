import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSourceFingerprint, fingerprintEntries, BUILD_FINGERPRINT_FILE, hashBytes } from '../scripts/build/source-fingerprint.mjs';
import { buildFingerprintPlugin } from '../scripts/build/fingerprint-plugin.mjs';
import { verifyBuiltApplication } from './e2e/lib/built-application-check.mjs';

// Small isolated fixtures remain under the OS temp directory; no recursive deletion.
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mdr-stale-dist-'));
  for (const dir of ['src', 'public', 'scripts/build', 'dist/assets']) await mkdir(join(root, dir), { recursive: true });
  for (const [path, value] of Object.entries({
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'package.json': '{"type":"module"}', 'package-lock.json': '{"lockfileVersion":3}',
    'vite.config.js': 'export default {};', 'src/main.js': 'export const text="中文🧪";',
    'public/icon.svg': '<svg/>', 'scripts/build/fingerprint-plugin.mjs': '// build owner',
    'dist/index.html': '<script type="module" src="/assets/app.js"></script>',
    'dist/assets/app.js': 'export const current=true;', 'dist/icon.svg': '<svg/>'
  })) await writeFile(join(root, path), value);
  const distRoot = join(root, 'dist');
  const plugin = buildFingerprintPlugin();
  plugin.configResolved({ root, build: { outDir: distRoot } });
  const build = async () => {
    await plugin.buildStart();
    await plugin.writeBundle({ dir: distRoot }, { index: { fileName: 'index.html' }, app: { fileName: 'assets/app.js' } });
  };
  await build();
  return { root, distRoot, plugin, build, check: () => verifyBuiltApplication({ projectRoot: root, distRoot }),
    manifest: () => readFile(join(distRoot, BUILD_FINGERPRINT_FILE), 'utf8').then(JSON.parse),
    writeManifest: value => writeFile(join(distRoot, BUILD_FINGERPRINT_FILE), JSON.stringify(value)) };
}

test('R15-12 current source plus exact emitted/public bytes is accepted', async t => {
  const f = await fixture(t), result = await f.check(), manifest = await f.manifest();
  assert.equal(result.accepted, true); assert.equal(result.sourceSha256, manifest.source.sha256);
  assert.equal(result.sourceFiles, 7); assert.equal(result.outputFiles, 3);
  assert.deepEqual(manifest.outputs.map(x => x.path), ['assets/app.js', 'icon.svg', 'index.html']);
  assert.equal(manifest.source.files.some(x => x.path.includes(f.root)), false);
});

for (const path of ['src/main.js', 'index.html', 'public/icon.svg', 'vite.config.js', 'package.json', 'package-lock.json', 'scripts/build/fingerprint-plugin.mjs']) {
  test('R15-12 changed input rejects old dist: ' + path, async t => {
    const f = await fixture(t); await writeFile(join(f.root, path), 'changed');
    await assert.rejects(f.check(), error => error.code === 'STALE_DIST' && error.reason === 'source-changed' && error.message.includes(path)
      && error.message.includes('Run npm run build before npm run test:browser'));
  });
}

test('R15-12 added and removed source paths invalidate the manifest', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'src/new.js'), 'new');
  await assert.rejects(f.check(), /src\/new.js/);
  await f.build(); await rename(join(f.root, 'src/new.js'), join(f.root, 'parked.js'));
  await assert.rejects(f.check(), /src\/new.js/);
});

test('R15-12 same-size content changes invalidate fingerprints without relying on mtime', async t => {
  const f = await fixture(t), before = await readFile(join(f.root, 'public/icon.svg'));
  await writeFile(join(f.root, 'public/icon.svg'), '<svg >');
  assert.equal((await readFile(join(f.root, 'public/icon.svg'))).length, before.length);
  await assert.rejects(f.check(), /source-changed/);
});

test('R15-12 docs tests Git and generated output do not change source identity', async t => {
  const f = await fixture(t), before = await createSourceFingerprint(f.root);
  for (const dir of ['docs', 'tests', '.git', 'logs']) await mkdir(join(f.root, dir));
  for (const name of ['README.md', 'docs/notes.md', 'tests/check.test.mjs', '.git/HEAD', 'logs/dev.log', 'dist/old.js']) {
    await writeFile(join(f.root, name), 'unrelated');
  }
  assert.deepEqual(await createSourceFingerprint(f.root), before);
  await f.check();
});

for (const path of ['index.html', 'assets/app.js', 'icon.svg']) test('R15-12 replaced output bytes are rejected: ' + path, async t => {
  const f = await fixture(t); await writeFile(join(f.distRoot, path), 'old output');
  await assert.rejects(f.check(), error => error.reason === 'output-changed' && error.message.includes(path));
});

test('R15-12 missing emitted output is rejected', async t => {
  const f = await fixture(t); await rename(join(f.distRoot, 'assets/app.js'), join(f.root, 'parked-app.js'));
  await assert.rejects(f.check(), /output-missing.*assets\/app.js/);
});

test('R15-12 absent fingerprint from an old build fails with an actionable message', async t => {
  const f = await fixture(t); await rename(join(f.distRoot, BUILD_FINGERPRINT_FILE), join(f.root, 'parked-manifest.json'));
  await assert.rejects(f.check(), error => error.code === 'STALE_DIST' && /manifest-missing/.test(error.message)
    && /Built dist is stale or was not produced from the current source/.test(error.message));
});

for (const value of ['<html>SPA fallback</html>', '{broken', '{}']) test('R15-12 malformed manifest rejected: ' + value, async t => {
  const f = await fixture(t); await writeFile(join(f.distRoot, BUILD_FINGERPRINT_FILE), value);
  await assert.rejects(f.check(), /manifest-invalid/);
});

for (const mutation of ['schema', 'source-digest', 'empty-output', 'no-index', 'duplicate', 'traversal', 'absolute', 'windows-path', 'bad-digest']) {
  test('R15-12 invalid manifest cannot authorize a build: ' + mutation, async t => {
    const f = await fixture(t), m = await f.manifest();
    if (mutation === 'schema') m.schemaVersion++;
    if (mutation === 'source-digest') m.source.sha256 = '0'.repeat(64);
    if (mutation === 'empty-output') m.outputs = [];
    if (mutation === 'no-index') m.outputs = m.outputs.filter(x => x.path !== 'index.html');
    if (mutation === 'duplicate') m.outputs.push({ ...m.outputs[0] });
    if (mutation === 'traversal') m.outputs[0].path = '../outside.js';
    if (mutation === 'absolute') m.outputs[0].path = '/outside.js';
    if (mutation === 'windows-path') m.outputs[0].path = 'C:\\outside.js';
    if (mutation === 'bad-digest') m.outputs[0].sha256 = 'no hash';
    await f.writeManifest(m); await assert.rejects(f.check(), /manifest-invalid/);
  });
}

test('R15-12 missing source input fails closed', async t => {
  const f = await fixture(t); await rename(join(f.root, 'package-lock.json'), join(f.root, 'parked-lock.json'));
  await assert.rejects(f.check(), /source-unreadable/);
});

test('R15-12 symlinked source directory cannot silently escape the input scope', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'outside'));
  await symlink(join(f.root, 'outside'), join(f.root, 'src/linked'), 'junction');
  await assert.rejects(f.check(), /source-unreadable/);
});

test('R15-12 source edit during build rejects publication and does not bless old output', async t => {
  const f = await fixture(t), prior = await readFile(join(f.distRoot, BUILD_FINGERPRINT_FILE), 'utf8');
  await f.plugin.buildStart(); await writeFile(join(f.root, 'src/main.js'), 'during-build');
  await assert.rejects(f.plugin.writeBundle({ dir: f.distRoot }, {}), /changed during build/);
  assert.equal(await readFile(join(f.distRoot, BUILD_FINGERPRINT_FILE), 'utf8'), prior);
  await assert.rejects(f.check(), /source-changed/);
});

test('R15-12 a fresh rebuild recovers from stale source with a new fingerprint', async t => {
  const f = await fixture(t), before = await f.manifest();
  await writeFile(join(f.root, 'src/main.js'), 'new source'); await assert.rejects(f.check(), /source-changed/);
  await f.build(); assert.notEqual((await f.manifest()).source.sha256, before.source.sha256); await f.check();
});

test('R15-12 canonical fingerprint uses names and binary content hashes', () => {
  const a = [{ path: 'a', sha256: hashBytes(Buffer.from([0, 255])) }];
  assert.match(fingerprintEntries(a), /^[a-f0-9]{64}$/);
  assert.notEqual(fingerprintEntries(a), fingerprintEntries([{ ...a[0], path: 'b' }]));
  assert.notEqual(a[0].sha256, hashBytes(Buffer.from([0, 254])));
});
