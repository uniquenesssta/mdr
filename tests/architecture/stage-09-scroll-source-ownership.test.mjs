import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');

test('R9-02 creates one canonical ScrollSourceOwnership module and public factory', async () => {
  const source = await read('src/features/sync/scroll/scroll-source-ownership.js');
  const index = await read('src/features/sync/index.js');
  assert.match(source, /export class ScrollSourceOwnership/);
  assert.match(source, /export function createScrollSourceOwnership/);
  assert.match(index, /ScrollSourceOwnership/);
  assert.match(index, /createScrollSourceOwnership/);
  assert.match(index, /\.\/scroll\/scroll-source-ownership\.js/);
});

test('R9-02 source owner is DOM-free and owns only source reason time windows suspension and sequence', async () => {
  const source = await read('src/features/sync/scroll/scroll-source-ownership.js');
  assert.match(source, /this\.sourceSide/);
  assert.match(source, /this\.sourceReason/);
  assert.match(source, /this\.sourceLastEventAt/);
  assert.match(source, /this\.programmaticUntil/);
  assert.match(source, /this\.suspendedUntil/);
  assert.match(source, /this\.sequence/);
  assert.doesNotMatch(source, /addEventListener|removeEventListener|requestAnimationFrame|cancelAnimationFrame|scrollTop|scrollTo\(|document\.|window\./);
});

test('R9-02 controller delegates source authority and retains only orchestration and target runtime state', async () => {
  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');
  assert.match(controller, /createScrollSourceOwnership/);
  assert.match(controller, /this\.sourceOwnership\.beginUserGesture/);
  assert.match(controller, /this\.sourceOwnership\.markProgrammaticScroll/);
  assert.match(controller, /this\.sourceOwnership\.suspend/);
  assert.match(controller, /this\.sourceOwnership\.nextSequence/);
  assert.match(controller, /this\.sourceOwnership\.classify/);
  assert.doesNotMatch(controller, /this\.sourceSide\s*=/);
  assert.doesNotMatch(controller, /this\.sourceReason\s*=/);
  assert.doesNotMatch(controller, /this\.sourceLastEventAt\s*=/);
  assert.doesNotMatch(controller, /this\.programmaticUntil\s*=/);
  assert.doesNotMatch(controller, /this\.suspendedUntil\s*=/);
  assert.doesNotMatch(controller, /this\.sequence\s*=/);
});

test('R9-02 source ownership remains intact in final Stage 9 topology', async () => {
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));
  await access(file('src/features/sync/selection/selection-sync-controller.js'));
  await assert.rejects(access(file('src/sync/selection-controller.js')));
  await access(file('src/sync/selection-mapping.js'));
});

test('R9-02 final composition keeps one validated source owner inside Scroll Controller with explicit external ownership support and no classic or window authority', async () => {
  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');
  const main = await read('src/main.js');
  assert.match(controller, /const sourceOwnership = options\.sourceOwnership \|\| createScrollSourceOwnership\(\)/);
  assert.match(controller, /assertSourceOwnership\(sourceOwnership\)/);
  assert.match(controller, /this\.sourceOwnership = sourceOwnership/);
  assert.match(controller, /this\.ownsSourceOwnership = !options\.sourceOwnership/);
  assert.match(controller, /if \(this\.ownsSourceOwnership\) this\.sourceOwnership\.destroy\?\.\(\)/);
  assert.doesNotMatch(main, /ScrollSourceOwnership|createScrollSourceOwnership/);
  assert.doesNotMatch(main, /window\.markdownEditorScrollController|window\.markdownEditorScrollSync/);
  await assert.rejects(access(file('public/app/scroll-sync.js')));
});

test('R9-02 inventory records one source owner and final Stage 9 cardinality', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 381);
  assert.equal(records.has('src/features/sync/scroll/scroll-source-ownership.js'), true);
  assert.equal(records.get('src/features/sync/scroll/scroll-source-ownership.js')[4], 'scroll-source-ownership');
  assert.equal(records.get('src/features/sync/scroll/scroll-sync-controller.js')[4], 'scroll-sync-runtime');
});
