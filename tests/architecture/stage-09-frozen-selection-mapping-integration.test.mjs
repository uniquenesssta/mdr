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

test('R9-11 mounts the exact frozen model-kernel API on the scoped compatibility host and owns cleanup', async () => {
  const main = await read('src/main.js');
  assert.match(main, /compatibilityPlatformHost\.markdownEditorSelectionMapping = selectionMappingApi/);
  assert.match(main, /compatibilityPlatformHost\?\.markdownEditorSelectionMapping === selectionMappingApi/);
  assert.match(main, /delete compatibilityPlatformHost\.markdownEditorSelectionMapping/);
});

test('R9-11 removes the window selection mapping global from production and architecture baseline', async () => {
  const main = await read('src/main.js');
  const legacy = await read('public/app/scroll-sync.js');
  const baseline = await read('tests/architecture/fixtures/architecture-baseline.json');
  assert.doesNotMatch(main, /window\.markdownEditorSelectionMapping/);
  assert.doesNotMatch(legacy, /window\.markdownEditorSelectionMapping/);
  assert.doesNotMatch(baseline, /window\.markdownEditorSelectionMapping/);
});

test('R9-11 classic selection mapping call sites consume only the injected frozen capability', async () => {
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(legacy, /const frozenSelectionMapping = scrollSyncCompatibilityHost\?\.markdownEditorSelectionMapping/);
  assert.match(legacy, /frozenSelectionMapping\.createPreviewRangesForSourceSelection\(/);
  assert.match(legacy, /frozenSelectionMapping\.mapPreviewDomPointToSource\(/);
  assert.doesNotMatch(legacy, /const mapping = window\.|selectionMappingApi/);
});

test('R9-11 production code has no direct import of frozen selection-mapping outside model-kernel', async () => {
  const paths = [
    'src/main.js',
    'src/features/sync/index.js',
    'src/sync/selection-controller.js',
    'public/app/scroll-sync.js'
  ];
  for (const path of paths) {
    const source = await read(path);
    assert.doesNotMatch(source, /from ['"][^'"]*sync\/selection-mapping\.js['"]/, path);
  }
  const kernel = await read('src/model-kernel/index.js');
  assert.match(kernel, /from '\.\.\/sync\/selection-mapping\.js'/);
});

test('R9-11 does not copy frozen mapping algorithms into Sync modules and does not start R9-12', async () => {
  const facade = await read('src/features/sync/index.js');
  const controller = await read('src/sync/selection-controller.js');
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(facade, /R9-11/);
  assert.match(facade, /R9-12/);
  assert.doesNotMatch(facade + controller, /function\s+(createMarkdownSourceProjection|createPreviewDomProjection|createPreviewRangesForSourceSelection|mapPreviewDomPointToSource)\b/);
  assert.match(legacy, /buildNormalizedTextMap/);
  assert.match(legacy, /editor\.value/);
  await access(file('public/app/scroll-sync.js'));
});
