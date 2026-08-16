import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');

test('R9-01 controller migration remains canonical after all Stage 9 extractions', async () => {
  await access(file('src/features/sync/index.js'));
  await access(file('src/features/sync/scroll/scroll-sync-controller.js'));
  await assert.rejects(access(file('src/sync/scroll-controller.js')));
  const index = await read('src/features/sync/index.js');
  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');
  assert.match(index, /createScrollSyncController/);
  assert.match(index, /\.\/scroll\/scroll-sync-controller\.js/);
  assert.match(controller, /Responsibility:/);
  assert.match(controller, /wheel|pointer|touch|keyboard/);
  assert.match(controller, /markProgrammaticScroll/);
  assert.match(controller, /compensate/);
  assert.match(controller, /ignoredTargetEvents/);
});

test('R9-01 production caller remains on the public Sync entry and final Selection owner is also behind that boundary', async () => {
  const main = await read('src/main.js');
  const index = await read('src/features/sync/index.js');
  assert.match(main, /createEditorScrollMapper, createPreviewScrollMapper, createScrollSyncController/);
  assert.match(main, /createSelectionSyncController/);
  assert.doesNotMatch(main, /\.\/sync\/scroll-controller\.js|\.\/sync\/selection-controller\.js/);
  assert.match(index, /\.\/selection\/selection-sync-controller\.js/);
  await access(file('src/features/sync/selection/selection-sync-controller.js'));
  await access(file('src/sync/selection-mapping.js'));
});

test('R9-01 and R9-02 contracts remain intact after Geometry Session and final Selection boundaries', async () => {
  await access(file('src/features/sync/scroll/scroll-source-ownership.js'));
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));
  await access(file('src/features/sync/selection/selection-sync-controller.js'));
  await assert.rejects(access(file('src/sync/selection-controller.js')));
});

test('R9-01 frozen public controller contract is consumed directly after classic scroll aggregate deletion', async () => {
  const main = await read('src/main.js');
  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');
  assert.match(controller, /getPublicApi\(\)/);
  for (const token of ['markProgrammaticScroll', 'suspend', 'compensate', 'notifyGeometryChanged', 'scheduleTarget', 'scrollTo', 'syncNow']) {
    assert.match(controller, new RegExp(token));
  }
  assert.match(main, /createVirtualEditor\(editorHost, \{ scrollSync: scrollController\.getPublicApi\(\) \}\)/);
  assert.match(main, /scrollController\.scheduleTarget\('preview'/);
  assert.match(main, /scrollController\.scheduleTarget\('editor'/);
  assert.match(main, /scrollController\.notifyGeometryChanged\('preview'\)/);
  assert.match(main, /scrollController\.notifyGeometryChanged\('editor'\)/);
  assert.doesNotMatch(main, /window\.markdownEditorScrollController|window\.markdownEditorScrollSync/);
  await assert.rejects(access(file('public/app/scroll-sync.js')));
});

test('current inventory records final public Sync owners without restoring obsolete controllers', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const paths = new Set(inventory.modules.map(record => record[0]));
  assert.equal(inventory.modules.length, 381);
  assert.equal(paths.has('src/features/sync/index.js'), true);
  assert.equal(paths.has('src/features/sync/scroll/scroll-sync-controller.js'), true);
  assert.equal(paths.has('src/features/sync/scroll/scroll-source-ownership.js'), true);
  assert.equal(paths.has('src/sync/scroll-controller.js'), false);
  assert.equal(paths.has('src/sync/selection-controller.js'), false);
  assert.equal(paths.has('src/features/sync/selection/selection-sync-controller.js'), true);
  assert.equal(paths.has('src/sync/selection-mapping.js'), true);
});
