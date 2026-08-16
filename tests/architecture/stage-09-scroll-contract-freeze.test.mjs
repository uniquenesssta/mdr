import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');

const PLANNED_LATER_FILES = [
  'src/features/sync/selection/selection-sync-controller.js',
  'src/features/sync/selection/editor-selection-reader.js',
  'src/features/sync/selection/preview-selection-reader.js',
  'src/features/sync/selection/selection-highlight-session.js',
  'src/features/sync/selection/selection-retry-scheduler.js',
  'src/features/sync/selection/selection-feedback-guard.js'
];

test('R9-01 controller migration remains canonical after R9-02 source ownership extraction', async () => {
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

test('R9-01 production caller remains on the public Sync entry without changing Selection ownership', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createScrollSyncController \} from ['"]\.\/features\/sync\/index\.js['"]/);
  assert.doesNotMatch(main, /\.\/sync\/scroll-controller\.js/);
  assert.match(main, /createSelectionSyncController \} from ['"]\.\/sync\/selection-controller\.js['"]/);
  await access(file('src/sync/selection-controller.js'));
  await access(file('src/sync/selection-mapping.js'));
});

test('R9-01 and R9-02 contracts remain intact after the R9-06 Geometry Session boundary is added', async () => {
  await access(file('src/features/sync/scroll/scroll-source-ownership.js'));
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));
  for (const path of PLANNED_LATER_FILES) await assert.rejects(access(file(path)), path);
});

test('R9-01 legacy browser aggregate remains a compatibility client of the frozen controller contract', async () => {
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(legacy, /const scrollController = window\.markdownEditorScrollController/);
  assert.match(legacy, /function suspendAutomaticScrollSync\(duration = 360\)/);
  assert.match(legacy, /function markProgrammaticScroll\(side, duration = 700\)/);
  assert.match(legacy, /scrollController\.markProgrammaticScroll\(side, duration\)/);
  assert.match(legacy, /scrollController\.scheduleTarget\(side, top, \{ reason: 'linked-scroll' \}\)/);
  assert.match(legacy, /scrollController\.scrollTo\('editor'/);
  assert.match(legacy, /scrollController\.scrollTo\('preview'/);
  assert.match(legacy, /scrollController\.notifyGeometryChanged\('editor'\)/);
  assert.match(legacy, /scrollController\.notifyGeometryChanged\('preview'\)/);
  assert.match(legacy, /Object\.assign\(window\.markdownEditorScrollSync/);
});

test('current inventory records public Sync, controller and source owner without restoring obsolete scroll controller', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const paths = new Set(inventory.modules.map(record => record[0]));
  assert.equal(inventory.modules.length, 376);
  assert.equal(paths.has('src/features/sync/index.js'), true);
  assert.equal(paths.has('src/features/sync/scroll/scroll-sync-controller.js'), true);
  assert.equal(paths.has('src/features/sync/scroll/scroll-source-ownership.js'), true);
  assert.equal(paths.has('src/sync/scroll-controller.js'), false);
  assert.equal(paths.has('src/sync/selection-controller.js'), true);
  assert.equal(paths.has('src/sync/selection-mapping.js'), true);
});
