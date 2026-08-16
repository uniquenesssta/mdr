import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');

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
    assert.match(mapper, new RegExp(`virtualApi\\.${name}`));
  }
  assert.match(mapper, /querySelectorAll\('\[data-source-line\]'\)/);
  assert.match(mapper, /querySelector\('\.markdown-body'\)/);
  assert.match(mapper, /dataset\?\.sourceLine/);
  assert.match(mapper, /offsetTop/);
  assert.match(mapper, /offsetHeight/);
});

test('R9-05 final composition injects preview virtual capabilities and owns mapper teardown before Preview command teardown', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createPreviewScrollMapper/);
  assert.match(main, /previewElement: previewHost/);
  assert.match(main, /virtualApi: previewVirtualGeometry/);
  assert.match(main, /previewScrollMapper\?\.destroy\(\)/);
  assert.ok(main.indexOf('destroyPreviewScrollMapper();') < main.indexOf('previewCommandHandler?.destroy();'));
  assert.doesNotMatch(main, /markdownEditorPreviewScrollMapper/);
  assert.doesNotMatch(main, /window\.ResizeObserver/);
});

test('R9-05 preview geometry cache and ResizeObserver authority live only inside PreviewScrollMapper after classic aggregate removal', async () => {
  const core = await read('public/app/core.js');
  const mapper = await read('src/features/sync/scroll/preview-scroll-mapper.js');
  for (const token of ['previewAnchorsCache', 'previewAnchorMetricsCache', 'previewBodyResizeObserver', 'observedPreviewBody', 'previewBodyResizeTimer']) {
    assert.doesNotMatch(core, new RegExp(token));
  }
  assert.match(mapper, /this\.anchorsCache/);
  assert.match(mapper, /this\.metricsCache/);
  assert.match(mapper, /this\.resizeObserver/);
  assert.match(mapper, /this\.observedBody/);
  await assert.rejects(access(file('public/app/scroll-sync.js')));
});

test('R9-05 final annotation and refresh paths update mapper-owned anchors rather than a second cache', async () => {
  const mapper = await read('src/features/sync/scroll/preview-scroll-mapper.js');
  const main = await read('src/main.js');
  assert.match(mapper, /annotateSourceLines\(sourceText, tokens = \[\], blocks = \[\]\)/);
  assert.match(mapper, /this\.replaceAnchors\(anchors\)/);
  assert.match(main, /annotatePreviewSourceLines: \(source, tokens, blocks\) => previewScrollMapper\.annotateSourceLines\(source, tokens, blocks\)/);
  assert.match(main, /refreshPreviewAnchorStructure: \(\) => previewScrollMapper\.refreshStructure\(\)/);
  assert.match(main, /invalidatePreviewAnchorMetrics: \(\) => previewScrollMapper\.invalidateMetrics\(\)/);
  assert.match(main, /invalidatePreviewAnchorStructure: \(\) => previewScrollMapper\.invalidateStructure\(\)/);
});

test('R9-05 remains intact after final Selection orchestration and legacy removal', async () => {
  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/features/sync/selection/selection-sync-controller.js'));
  await assert.rejects(access(file('src/sync/selection-controller.js')));
  await access(file('src/sync/selection-mapping.js'));
});

test('R9-05 inventory records preview mapper and final Stage 9 cardinality', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 381);
  assert.equal(records.has('src/features/sync/scroll/editor-scroll-mapper.js'), true);
  assert.equal(records.has('src/features/sync/scroll/preview-scroll-mapper.js'), true);
  assert.equal(records.get('src/features/sync/scroll/preview-scroll-mapper.js')[4], 'preview-scroll-mapper-geometry-cache');
});
