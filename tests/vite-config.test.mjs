import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import config from '../vite.config.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parentNodeModules = resolve(repositoryRoot, '..', 'node_modules');

test('Vite dev server permits only the repository and intentional parent dependency directory', () => {
  const allow = config.server?.fs?.allow || [];
  assert.deepEqual(allow, [repositoryRoot, parentNodeModules]);
  assert.equal(allow.includes(resolve(repositoryRoot, '..')), false);
});

test('production bundle budgets remain stricter for startup chunks than lazy vendor chunks', () => {
  assert.equal(config.build?.chunkSizeWarningLimit, 700);
  assert.ok(Array.isArray(config.plugins));
  assert.equal(config.plugins.some(plugin => plugin?.name === 'bundle-budget'), true);
});

test('R14-16 image chunk closes over its actual imports without moving shared UI Preview or Platform', () => {
  const chunks = config.build.rollupOptions.output.manualChunks;
  const exportRoot = resolve(repositoryRoot, 'src/features/export');
  const selected = readdirSync(exportRoot, { recursive: true }).filter(path => path.endsWith('.js'))
    .map(path => resolve(exportRoot, path)).filter(path => chunks(path) === 'export-image');
  assert.ok(selected.some(path => path.endsWith('image-exporter.js')));
  assert.ok(selected.some(path => path.endsWith('export-request.js')));
  assert.ok(selected.some(path => path.endsWith('export-task-controller.js')));
  for (const path of selected) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /\bimport\s*(?:\(|['"])/, path);
    for (const match of source.matchAll(/\b(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('.'), path);
      assert.equal(chunks(resolve(dirname(path), match[1])), 'export-image', path + ' -> ' + match[1]);
    }
  }
  for (const path of ['src/main.js','src/features/export/ui/export-progress-dialog-view.js',
    'src/features/export/document/export-preview-enhancer.js','src/ui/components/modal-shell.js','src/platform/create-platform.js']) {
    assert.equal(chunks(resolve(repositoryRoot,path)), undefined, path);
  }
  assert.equal(chunks('/parent/node_modules/katex/dist/katex.mjs'), 'katex-vendor');
  assert.equal(chunks('/parent/node_modules/dom-to-image-more/dist/dom-to-image-more.min.js'), undefined);
});

test('R14-16 actual bundle gate still rejects exactly one byte over startup and async limits', () => {
  const plugin = config.plugins.find(item => item.name === 'bundle-budget');
  const chunk = (fileName, bytes, isEntry = false, imports = []) => ({type:'chunk', fileName, code:'x'.repeat(bytes), isEntry, imports});
  const check = bundle => plugin.generateBundle.call({error(message) { throw new Error(message); }}, {}, bundle);
  check({entry:chunk('entry.js',500000,true), image:chunk('export-image.js',700000)});
  assert.throws(() => check({entry:chunk('entry.js',500001,true)}), /500001 bytes > 500000 byte initial budget/);
  assert.throws(() => check({image:chunk('export-image.js',700001)}), /700001 bytes > 700000 byte async budget/);
  assert.throws(() => check({entry:chunk('entry.js',1,true,['export-image.js']),image:chunk('export-image.js',500001)}),
    /500001 bytes > 500000 byte initial budget/);
});
