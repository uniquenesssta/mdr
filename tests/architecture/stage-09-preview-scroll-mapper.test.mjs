import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');
const LATER_FILES = [
  'src/features/sync/scroll/scroll-geometry-session.js',
  'src/features/sync/selection/selection-sync-controller.js',
  'src/features/sync/selection/editor-selection-reader.js',
  'src/features/sync/selection/preview-selection-reader.js',
  'src/features/sync/selection/selection-highlight-session.js',
  'src/features/sync/selection/selection-retry-scheduler.js',
  'src/features/sync/selection/selection-feedback-guard.js'
];

test('R9-05 creates one canonical PreviewScrollMapper and exports it only through the Sync public entry', async () => {
  const mapper = await read('src/features/sync/scroll/preview-scroll-mapper.js');
  const index = await read('src/features/sync/index.js');
  assert.match(mapper, /export class PreviewScrollMapper/);
  assert.match(mapper, /export function createPreviewScrollMapper/);
  assert.match(index, /PreviewScrollMapper/);
  assert.match(index, /createPreviewScrollMapper/);
  assert.match(index, /\.\/scroll\/preview-scroll-mapper\.js/);
  assert.match(index, /R9-05/);
});

test('R9-05 mapper owns no editor internals source ownership or target scroll writes', async () => {
  const mapper = await read('src/features/sync/scroll/preview-scroll-mapper.js');
  assert.doesNotMatch(mapper, /virtualEditor|editorApi|#editor|documentModel|CodeMirror|@codemirror/);
  assert.doesNotMatch(mapper, /scrollTop\s*=|scrollTo\s*\(|scheduleTarget|beginUserGesture|markProgrammaticScroll|ScrollSourceOwnership/);
  assert.doesNotMatch(mapper, /window\.|globalThis\./);
});

test('R9-05 mapper uses only virtual height-index capabilities or preview source anchors', async () => {
  const mapper = await read('src/features/sync/scroll/preview-scroll-mapper.js');
  for (const name of ['getMountedAnchors', 'getMetrics', 'getContentYForLine', 'getLineForContentY']) {
    assert.match(mapper, new RegExp(`virtualApi\.${name}`));
  }
  assert.match(mapper, /querySelectorAll\('\[data-source-line\]'\)/);
  assert.match(mapper, /querySelector\('\.markdown-body'\)/);
  assert.match(mapper, /dataset\?\.sourceLine/);
  assert.match(mapper, /offsetTop/);
  assert.match(mapper, /offsetHeight/);
});

test('R9-05 application composition injects preview and virtual capabilities and owns teardown before Preview command teardown', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createPreviewScrollMapper/);
  assert.match(main, /previewElement: previewHost/);
  assert.match(main, /virtualApi: previewCommandHandler\.port\.virtual/);
  assert.match(main, /markdownEditorPreviewScrollMapper = previewScrollMapper/);
  assert.match(main, /delete compatibilityPlatformHost\.markdownEditorPreviewScrollMapper/);
  assert.match(main, /previewScrollMapper\?\.destroy\(\)/);
  assert.ok(main.indexOf('destroyPreviewScrollMapper();') < main.indexOf('previewCommandHandler?.destroy();'));
  assert.doesNotMatch(main, /window\.markdownEditorPreviewScrollMapper/);
  assert.doesNotMatch(main, /window\.ResizeObserver/);
});

test('R9-05 removes legacy preview geometry cache and ResizeObserver authority from classic globals', async () => {
  const core = await read('public/app/core.js');
  const legacy = await read('public/app/scroll-sync.js');
  for (const token of ['previewAnchorsCache', 'previewAnchorMetricsCache', 'previewBodyResizeObserver', 'observedPreviewBody', 'previewBodyResizeTimer']) {
    assert.doesNotMatch(core, new RegExp(token));
    assert.doesNotMatch(legacy, new RegExp(token));
  }
  assert.match(legacy, /const previewScrollMapper = scrollSyncCompatibilityHost\?\.markdownEditorPreviewScrollMapper/);
  assert.match(legacy, /previewScrollMapper\.getContentYForLine/);
  assert.match(legacy, /previewScrollMapper\.getLineForContentY/);
  assert.match(legacy, /previewScrollMapper\.getMetrics/);
  assert.match(legacy, /previewScrollMapper\.findAnchor/);
});

test('R9-05 classic annotation and refresh paths update mapper-owned anchors rather than a second cache', async () => {
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(legacy, /previewScrollMapper\.replaceAnchors\(children\)/);
  assert.match(legacy, /refreshPreviewAnchorStructure: \(\) => previewScrollMapper\.refreshStructure\(\)/);
  assert.match(legacy, /invalidatePreviewAnchorMetrics: \(\) => invalidatePreviewAnchorMetrics\(\)/);
  assert.match(legacy, /invalidatePreviewAnchorStructure: \(\) => invalidatePreviewAnchorStructure\(\)/);
});

test('R9-05 leaves Geometry Session and Selection Atomics untouched', async () => {
  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/sync/selection-controller.js'));
  await access(file('src/sync/selection-mapping.js'));
});

test('R9-05 inventory records preview mapper and current package cardinality', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 375);
  assert.equal(records.has('src/features/sync/scroll/editor-scroll-mapper.js'), true);
  assert.equal(records.has('src/features/sync/scroll/preview-scroll-mapper.js'), true);
  assert.equal(records.get('src/features/sync/scroll/preview-scroll-mapper.js')[4], 'preview-scroll-mapper-geometry-cache');
});
