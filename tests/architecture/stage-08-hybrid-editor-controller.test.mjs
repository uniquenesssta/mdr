
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');
const APP_FILES = [
  'src/features/hybrid-editor/application/hybrid-decoration-coordinator.js',
  'src/features/hybrid-editor/application/hybrid-editor-controller.js'
];

test('Atomic 8.15 creates the two planned application owners and deletes all three legacy Hybrid aggregates', async () => {
  for (const path of APP_FILES) await access(file(path));
  for (const path of [
    'src/editor/hybrid/controller.js',
    'src/editor/hybrid/widgets.js',
    'src/editor/hybrid/inline-presentation.js'
  ]) await assert.rejects(access(file(path)), path);
});

test('Atomic 8.15 application owners stay integration-neutral and independently bounded', async () => {
  for (const path of APP_FILES) {
    const source = await read(path);
    assert.match(source, /Responsibility:/);
    assert.ok(source.split(/\r?\n/).length < 500, path);
    assert.doesNotMatch(source, /from ['"]@codemirror\/|from ['"]marked['"]|features\/preview|model-kernel/);
    assert.doesNotMatch(source, /globalThis\.window|\bwindow\.|\bdocument\./);
  }
});

test('Atomic 8.15 Hybrid public entry exposes final application owners without leaking CodeMirror compatibility', async () => {
  const index = await read('src/features/hybrid-editor/index.js');
  for (const name of [
    'createHybridDecorationCoordinator',
    'createHybridEditorController'
  ]) assert.match(index, new RegExp(`\\b${name}\\b`));
  assert.doesNotMatch(index, /createCodeMirrorSourceEditorPort|revealHybridSourceRangeEffect|codemirror-source-editor-port/);
  assert.doesNotMatch(index, /getBlockSignature|validateBlocks|scheduleBlockUpdate/);
});

test('Atomic 8.15 editor facade is the sole CodeMirror/vendor/model/Preview integration boundary while the public Hybrid entry remains browser-direct-safe', async () => {
  const facade = await read('src/editor/hybrid-markdown.js');
  const index = await read('src/features/hybrid-editor/index.js');
  assert.match(facade, /from ['"]@codemirror\//);
  assert.match(facade, /from ['"]marked['"]/);
  assert.match(facade, /\.\.\/model-kernel\/index\.js/);
  assert.match(facade, /\.\.\/features\/preview\/render\/presentation\/math-presentation\.js/);
  assert.match(facade, /\.\.\/features\/hybrid-editor\/index\.js/);
  assert.match(facade, /\.\.\/features\/hybrid-editor\/compatibility\/codemirror-source-editor-port\.js/);
  assert.doesNotMatch(facade, /features\/hybrid-editor\/(?:application|widgets|presentation|state|activation)\//);
  assert.doesNotMatch(facade, /\.\/hybrid\/controller\.js/);
  assert.doesNotMatch(index, /from ['"]@codemirror\/|from ['"]marked['"]|codemirror-source-editor-port/);
});

test('Atomic 8.15 preserves the external hybrid-markdown facade surface', async () => {
  const facade = await read('src/editor/hybrid-markdown.js');
  for (const name of [
    'buildHybridMarkdownDecorations',
    'getHybridMarkdownStats',
    'createHybridMarkdownExtension',
    'createHybridMarkdownConfiguration'
  ]) assert.match(facade, new RegExp(`export function ${name}\\b`));
});

test('Atomic 8.15 production inventory has final Stage 8 ownership and no legacy aggregate record', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const paths = new Set(inventory.modules.map(record => record[0]));
  assert.equal(inventory.modules.length, 381);
  for (const path of APP_FILES) assert.equal(paths.has(path), true, path);
  assert.equal(paths.has('src/editor/hybrid-markdown.js'), true);
  for (const path of [
    'src/editor/hybrid/controller.js',
    'src/editor/hybrid/widgets.js',
    'src/editor/hybrid/inline-presentation.js'
  ]) assert.equal(paths.has(path), false, path);
});

test('Atomic 8.15 legacy Hybrid globals stay removed while the current migration baseline advances monotonically', async () => {
  const baseline = JSON.parse(await read('tests/architecture/fixtures/architecture-baseline.json'));
  assert.equal(baseline.businessGlobalWrites.some(record => record.path === 'src/editor/hybrid/controller.js'), false);
  assert.equal(baseline.businessGlobalWrites.some(record => record.path === 'src/editor/hybrid-markdown.js'), false);
  assert.equal(baseline.businessGlobalWrites.length, 9);

  for (const global of [
    'window.markdownEditorScrollController',
    'window.markdownEditorScrollSync',
    'window.markdownEditorSelectionController'
  ]) {
    assert.equal(
      baseline.businessGlobalWrites.some(record => record.global === global),
      false,
      `${global} must stay removed from the current migration baseline`
    );
  }
});
