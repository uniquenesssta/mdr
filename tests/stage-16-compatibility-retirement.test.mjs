import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { collectModuleSpecifiers } from '../scripts/architecture/source-analysis.mjs';
import { createCommandRegistry } from '../src/shared/commands/command-registry.js';

const retirement = JSON.parse(await readFile('docs/audit/r16-08-compatibility-retirements.json', 'utf8'));
const manifest = JSON.parse(await readFile('tests/architecture/fixtures/production-modules.json', 'utf8'));
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();

test('R16-08 accounts for every retired module and preserves its exact accepted source provenance', async () => {
  assert.equal(retirement.retiredModules.length, 53);
  const retired = new Set(retirement.retiredModules.map(row => row.path));
  assert.equal(retired.size, 53);
  for (const row of retirement.retiredModules) {
    await assert.rejects(access(row.path), { code: 'ENOENT' });
    assert.equal(git(['rev-parse', retirement.sourceCommit + ':' + row.path]), row.sourceBlob, row.path);
    const current = await readFile(row.currentBoundary, 'utf8');
    for (const symbol of row.retiredExports) assert.equal(current.includes(symbol), false, symbol);
  }
  for (const [path] of manifest.modules) {
    if (!path.endsWith('.js')) continue;
    const source = await readFile(path, 'utf8');
    for (const { specifier } of collectModuleSpecifiers(source)) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
      const target = specifier.startsWith('/') ? specifier.slice(1) : posix.normalize(posix.join(posix.dirname(path), specifier));
      assert.equal(retired.has(target) || retired.has(target + '.js'), false, path + ': ' + target);
    }
  }
});

test('R16-08 keeps historical UI scope exact while proving the current ownership change', () => {
  const previous = JSON.parse(git(['show', retirement.sourceCommit + ':tests/architecture/fixtures/production-modules.json']));
  const owned = rows => rows.filter(row => row[0].startsWith('src/styles/') || ['ui-shell','ui-dom','ui-components','ui-compatibility'].includes(row[2])).map(row => row[0]);
  assert.deepEqual(retirement.historicalUiModules, owned(previous.modules));
  assert.equal(retirement.historicalUiModules.length, 72);
  const current = owned(manifest.modules);
  assert.equal(current.length, 69);
  assert.deepEqual(current.filter(path => !retirement.historicalUiModules.includes(path)), ['src/ui/dom/static-content.js']);
  assert.deepEqual(retirement.historicalUiModules.filter(path => !current.includes(path)).sort(),
    retirement.retiredModules.filter(row => row.path.startsWith('src/ui/compatibility/') || row.path === 'public/compatibility/business-content.html').map(row => row.path).sort());
});

test('R16-08 command registration validates the whole batch before publishing and an old disposer cannot remove new ownership', () => {
  const registry = createCommandRegistry('retirement test');
  let reads = 0;
  const dispose = registry.register({ get value() { reads++; return () => 1; } });
  assert.equal(reads, 1);
  assert.throws(() => registry.register({ newCommand: () => 2, value: () => 3 }), /already registered/);
  assert.equal(registry.has('newCommand'), false);
  assert.equal(registry.invoke('value'), 1);
  dispose();
  const next = registry.register({ value: () => 4 });
  dispose();
  assert.equal(registry.invoke('value'), 4);
  registry.destroy(); registry.destroy(); next();
  assert.throws(() => registry.invoke('value'), /destroyed/);
  assert.throws(() => registry.register({ late: () => 5 }), /destroyed/);
});

test('R16-08 owns startup rollback and page exit without publishing a replacement service host', async () => {
  const entry = await readFile('src/bootstrap/module-entry.js', 'utf8');
  const main = await readFile('src/main.js', 'utf8');
  assert.match(entry, /lifetime\.listen\(runtime, 'pagehide', destroy/);
  assert.match(entry, /startApplication\(\{ platform, documentSessionStore/);
  assert.match(main, /startupLifetime\.listen\(window, 'pagehide', \(\) => startupLifetime\.destroy\(\)/);
  for (const owner of ['exportFileWriter','exportImageView','exportTaskController','imageAssetPreloader',
    'previewState','previewScheduler','previewFocusController','previewRecoveryView','layoutState','linkPreview']) {
    assert.ok(main.includes('ownApplicationExit(() => ' + owner + '.destroy());'), owner);
  }
  assert.doesNotMatch(entry + main, /compatibility-business-ports|mountClassic|createCompatibilityBusinessContentPort|markdownEditorModalShells/);
  const editor = await readFile('src/features/editor/infrastructure/virtual-editor.js', 'utf8');
  assert.doesNotMatch(editor, /installTextareaCompatibility|host\.virtualEditor|Object\.defineProperty\(host, ['"]value/);
});
