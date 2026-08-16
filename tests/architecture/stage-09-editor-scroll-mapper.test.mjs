import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');

test('R9-04 creates one canonical EditorScrollMapper and exports it only through the Sync public entry', async () => {
  const mapper = await read('src/features/sync/scroll/editor-scroll-mapper.js');
  const index = await read('src/features/sync/index.js');
  assert.match(mapper, /export class EditorScrollMapper/);
  assert.match(mapper, /export function createEditorScrollMapper/);
  assert.match(index, /EditorScrollMapper/);
  assert.match(index, /createEditorScrollMapper/);
  assert.match(index, /\.\/scroll\/editor-scroll-mapper\.js/);
  assert.match(index, /R9-04/);
});

test('R9-04 mapper is DOM-free and owns neither source state nor scroll writes nor full-text measurement', async () => {
  const mapper = await read('src/features/sync/scroll/editor-scroll-mapper.js');
  assert.doesNotMatch(mapper, /from ['"]@codemirror/);
  assert.doesNotMatch(mapper, /document\.|window\.|globalThis\.|querySelector|createElement\s*\(|getContext\s*\(|measureText\s*\(/);
  assert.doesNotMatch(mapper, /scrollTop\s*=|scrollTo\s*\(|scheduleTarget|beginUserGesture|markProgrammaticScroll|ScrollSourceOwnership/);
  assert.doesNotMatch(mapper, /split\(['"]\n|sliceText|\.value\b/);
});

test('R9-04 mapper composes frozen model line ranges with neutral CodeMirror geometry reads', async () => {
  const mapper = await read('src/features/sync/scroll/editor-scroll-mapper.js');
  for (const name of ['getTextLength', 'getLineCount', 'getLineNumberAtPosition', 'getLineStart', 'getLineEnd']) {
    assert.match(mapper, new RegExp(`model\\.${name}`));
  }
  for (const name of ['getSelection', 'getScrollMetrics', 'getLineAtHeight', 'getHeightForLine', 'getHeightForPosition']) {
    assert.match(mapper, new RegExp(`editorApi\\.${name}`));
  }
});

test('R9-04 final composition injects editor/model capabilities through the public Sync factory and owns mapper teardown', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createEditorScrollMapper, createPreviewScrollMapper, createScrollSyncController/);
  assert.match(main, /createEditorScrollMapper\(\{ editorApi: virtualEditor, model: documentModel \}\)/);
  assert.match(main, /editorScrollMapper\?\.destroy\(\)/);
  assert.doesNotMatch(main, /markdownEditorEditorScrollMapper/);
  assert.doesNotMatch(main, /window\.markdownEditorEditorScrollMapper/);
});

test('R9-04 final Sync code has no legacy Canvas textarea metric authority and delegates editor geometry only to EditorScrollMapper', async () => {
  const controller = await read('src/features/sync/selection/selection-sync-controller.js');
  const main = await read('src/main.js');
  const combined = controller + main;
  assert.match(controller, /this\.editorMapper\.getLineNumberAtPosition/);
  assert.match(controller, /this\.editorMapper\.getContentYForPosition/);
  assert.match(main, /editorScrollMapper\.getLineAtContentY/);
  assert.match(main, /editorScrollMapper\.getContentYForLine/);
  assert.doesNotMatch(combined, /editorMeasureCanvas|editorMeasureContext|editorMetricText|editorMetricLines|editorLineRows|editorVisualOffsets/);
  assert.doesNotMatch(combined, /createElement\(['"]canvas['"]\)|getContext\(['"]2d['"]\)|measureText\s*\(|rebuildEditorLineMetrics|scheduleEditorMetricsRebuild/);
  const core = await read('public/app/core.js');
  assert.doesNotMatch(core, /scheduleEditorMetricsRebuild/);
  assert.match(core, /coreEditorUiCommandPort\.has\('preparePreviewEditorMetrics'\)/);
  assert.match(core, /coreEditorUiCommandPort\.invoke\('preparePreviewEditorMetrics'\)/);
  await assert.rejects(access(file('public/app/scroll-sync.js')));
});

test('R9-04 remains intact after final Selection migration without restoring old mapping or Controller authority', async () => {
  await access(file('src/features/sync/scroll/preview-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));
  await access(file('src/features/sync/selection/selection-sync-controller.js'));
  await assert.rejects(access(file('src/sync/selection-controller.js')));
  await access(file('src/sync/selection-mapping.js'));
});

test('R9-04 inventory records one editor mapper and final Stage 9 cardinality', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 381);
  assert.equal(records.has('src/features/sync/scroll/editor-scroll-mapper.js'), true);
  assert.equal(records.get('src/features/sync/scroll/editor-scroll-mapper.js')[4], 'editor-scroll-mapper-lifecycle');
  assert.equal(records.has('src/features/sync/scroll/preview-scroll-mapper.js'), true);
});
