import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');

test('R9-11 composition obtains frozen mapping only from model-kernel and never imports the frozen implementation directly', async () => {
  const main = await read('src/main.js');
  assert.match(main, /selectionMappingApi\s*\n?\s*}\s*from '\.\/model-kernel\/index\.js'/);
  assert.doesNotMatch(main, /from ['"][^'"]*sync\/selection-mapping\.js['"]/);
});

test('R9-11 frozen model-kernel API remains the exact capability injected into the final Selection Controller', async () => {
  const main = await read('src/main.js');
  assert.match(main, /selectionMapping:\s*selectionMappingApi/);
  assert.doesNotMatch(main, /markdownEditorSelectionMapping/);
  assert.doesNotMatch(main, /window\.markdownEditorSelectionMapping/);
});

test('R9-11 window selection mapping global remains absent after R9-12 removes the classic compatibility script', async () => {
  const main = await read('src/main.js');
  const baseline = await read('tests/architecture/fixtures/architecture-baseline.json');
  assert.doesNotMatch(main, /window\.markdownEditorSelectionMapping/);
  assert.doesNotMatch(baseline, /window\.markdownEditorSelectionMapping/);
  await assert.rejects(access(file('public/app/scroll-sync.js')));
});

test('R9-11 final selection mapping call sites consume only the injected frozen capability', async () => {
  const controller = await read('src/features/sync/selection/selection-sync-controller.js');
  assert.match(controller, /this\.selectionMapping\.createPreviewRangesForSourceSelection\(/);
  assert.match(controller, /this\.selectionMapping\.mapPreviewDomPointToSource\(/);
  assert.doesNotMatch(controller, /from ['"][^'"]*selection-mapping\.js['"]/);
  assert.doesNotMatch(
    controller,
    /(?:^|\n)\s*selectionMappingApi\b|(?:=|:|,|\(|\[|\breturn\s+)\s*selectionMappingApi\b|\bselectionMappingApi\s*[.(\[]/m
  );
});

test('R9-11 production code has no direct import of frozen selection-mapping outside model-kernel', async () => {
  const paths = [
    'src/main.js',
    'src/features/sync/index.js',
    'src/features/sync/selection/selection-sync-controller.js'
  ];
  for (const path of paths) {
    const source = await read(path);
    assert.doesNotMatch(source, /from ['"][^'"]*sync\/selection-mapping\.js['"]/, path);
  }
  const kernel = await read('src/model-kernel/index.js');
  assert.match(kernel, /from '\.\.\/sync\/selection-mapping\.js'/);
});

test('R9-11 frozen mapping algorithms remain uncopied while R9-12 removes only legacy fallback authority', async () => {
  const facade = await read('src/features/sync/index.js');
  const controller = await read('src/features/sync/selection/selection-sync-controller.js');
  const mapping = await read('src/sync/selection-mapping.js');
  assert.match(facade, /R9-11/);
  assert.match(facade, /R9-12/);
  assert.doesNotMatch(facade + controller, /function\s+(createMarkdownSourceProjection|createPreviewDomProjection|createPreviewRangesForSourceSelection|mapPreviewDomPointToSource)\b/);
  assert.match(mapping, /export const selectionMappingApi = Object\.freeze/);
  await assert.rejects(access(file('public/app/scroll-sync.js')));
});
