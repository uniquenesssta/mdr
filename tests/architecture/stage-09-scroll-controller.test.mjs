import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');

const LATER_FILES = [
  'src/features/sync/selection/selection-sync-controller.js',
];

test('R9-03 Scroll Controller owns only source and target cancellable RAF slots', async () => {
  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');
  assert.match(controller, /this\.frames = \{ source: null, target: null \}/);
  assert.match(controller, /this\.frameVersions = \{ source: 0, target: 0 \}/);
  assert.match(controller, /queueFrame\(name, publish\)/);
  assert.match(controller, /cancelQueuedFrame\(name\)/);
  assert.doesNotMatch(controller, /geometryFrame|selectionFrame|previewFrame|editorFrame/);
  assert.doesNotMatch(controller, /requestAnimationFrame\s*\(/);
  assert.doesNotMatch(controller, /cancelAnimationFrame\s*\(/);
});

test('R9-03 controller remains mapper-orchestration plus target-write logic after R9-06 Geometry Session extraction', async () => {
  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));
  assert.match(controller, /this\.mapperCallbacks/);
  assert.match(controller, /scheduleSourceSync/);
  assert.match(controller, /flushSourceSync/);
  assert.match(controller, /scheduleTarget/);
  assert.match(controller, /flushTargetWrite/);
  assert.match(controller, /applyScrollTop/);
  assert.doesNotMatch(controller, /selectionMapping|CodeMirror|virtual height index|querySelector|createElement|canvas|getContext/);
  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);
});

test('R9-03 keeps ScrollSourceOwnership as the sole owner of source identity windows suspension and sequence', async () => {
  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');
  const ownership = await read('src/features/sync/scroll/scroll-source-ownership.js');
  assert.match(ownership, /this\.sourceSide/);
  assert.match(ownership, /this\.programmaticUntil/);
  assert.match(ownership, /this\.suspendedUntil/);
  assert.match(ownership, /this\.sequence/);
  assert.doesNotMatch(controller, /this\.sourceSide\s*=/);
  assert.doesNotMatch(controller, /this\.programmaticUntil\s*=/);
  assert.doesNotMatch(controller, /this\.suspendedUntil\s*=/);
  assert.doesNotMatch(controller, /this\.sequence\s*=/);
});

test('R9-03 application composition injects browser RAF capabilities through the public Sync factory', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createScrollSyncController\(editorHost, previewHost, \{/);
  assert.match(main, /requestFrame: callback => window\.requestAnimationFrame\(callback\)/);
  assert.match(main, /cancelFrame: frameId => window\.cancelAnimationFrame\(frameId\)/);
  assert.match(main, /createScrollSyncController \} from ['"]\.\/features\/sync\/index\.js['"]/);
  assert.doesNotMatch(main, /\.\/features\/sync\/scroll\/scroll-sync-controller\.js/);
});

test('R9-03 preserves the public Sync surface and keeps the classic aggregate behind it', async () => {
  const index = await read('src/features/sync/index.js');
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(index, /ScrollSyncController/);
  assert.match(index, /createScrollSyncController/);
  assert.match(index, /ScrollSourceOwnership/);
  assert.match(index, /createScrollSourceOwnership/);
  assert.match(index, /R9-06/);
  assert.match(legacy, /const scrollController = window\.markdownEditorScrollController/);
  assert.doesNotMatch(legacy, /scroll-source-ownership|ScrollSourceOwnership/);
});

test('R9-03 keeps production-module cardinality stable because no new production responsibility is introduced', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 381);
  assert.equal(records.has('src/features/sync/scroll/scroll-sync-controller.js'), true);
  assert.equal(records.get('src/features/sync/scroll/scroll-sync-controller.js')[4], 'scroll-sync-runtime');
  assert.equal(records.has('src/features/sync/scroll/scroll-source-ownership.js'), true);
});
