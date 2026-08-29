import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');
const controllerPath = 'src/features/sync/selection/selection-sync-controller.js';

test('R9-08 creates the canonical SelectionFeedbackGuard and exports it only through the Sync public entry', async () => {
  const index = await read('src/features/sync/index.js');
  const guard = await read('src/features/sync/selection/selection-feedback-guard.js');
  assert.match(index, /R9-08/);
  assert.match(guard, /export class SelectionFeedbackGuard/);
  assert.match(guard, /export function createSelectionFeedbackGuard/);
  assert.match(index, /\.\/selection\/selection-feedback-guard\.js/);
});

test('R9-08 Feedback Guard owns sequence source revision and release lifecycle without DOM mapping highlight retry or scroll policy', async () => {
  const source = await read('src/features/sync/selection/selection-feedback-guard.js');
  assert.match(source, /this\.sequence/);
  assert.match(source, /this\.source/);
  assert.match(source, /this\.revision/);
  assert.match(source, /token\.sequence !== this\.sequence/);
  assert.match(source, /incomingRevision < this\.revision/);
  assert.doesNotMatch(source, /document\.|window\.|globalThis\.|addEventListener|removeEventListener|selectionMapping|CSS\.highlights|Range\(|scrollTo|scheduleTarget/);
  assert.doesNotMatch(source, /selectionSyncLock|applyingSide|feedbackLocked|isFeedbackLocked/);
});

test('R9-08 final SelectionSyncController consumes the Guard and owns no applying-side release or preview revision duplicates', async () => {
  const controller = await read(controllerPath);
  assert.match(controller, /feedbackGuard\.begin\('editor'\)/);
  assert.match(controller, /feedbackGuard\.begin\('preview'\)/);
  assert.match(controller, /feedbackGuard\.shouldIgnore/);
  assert.match(controller, /feedbackGuard\.advanceRevision\(\)/);
  assert.match(controller, /feedbackGuard\.release/);
  assert.match(controller, /feedbackGuard\.reset\(\)/);
  assert.doesNotMatch(controller, /this\.applyingSide\s*=|this\.releaseTimer\s*=|this\.previewRevision\s*=/);
});

test('R9-08 legacy selectionSyncLock authority remains deleted after classic scroll-sync removal', async () => {
  const core = await read('public/app/core.js');
  const controller = await read(controllerPath);
  assert.doesNotMatch(core, /selectionSyncLock/);
  assert.doesNotMatch(controller, /selectionSyncLock/);
  await assert.rejects(access(file('public/app/scroll-sync.js')));
});

test('R9-08 composition creates exactly one Guard injects it directly into final Controller and destroys it', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createSelectionFeedbackGuard/);
  assert.match(main, /const selectionFeedbackGuard = createSelectionFeedbackGuard\(\{/);
  assert.match(main, /feedbackGuard: selectionFeedbackGuard/);
  assert.match(main, /selectionFeedbackGuard\.destroy\(\)/);
  assert.doesNotMatch(main, /markdownEditorSelectionFeedbackGuard = selectionFeedbackGuard/);
  assert.doesNotMatch(main, /window\.markdownEditorSelectionFeedbackGuard/);
  assert.doesNotMatch(main, /\.\/features\/sync\/selection\/selection-feedback-guard\.js/);
});

test('R9-08 keeps frozen mapping and prior Stage 9 scroll/read owners separate from the final Controller', async () => {
  await access(file('src/features/sync/scroll/scroll-source-ownership.js'));
  await access(file('src/features/sync/scroll/scroll-sync-controller.js'));
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/preview-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));
  await access(file('src/features/sync/selection/editor-selection-reader.js'));
  await access(file('src/features/sync/selection/preview-selection-reader.js'));
  await access(file(controllerPath));
  await access(file('src/sync/selection-mapping.js'));
  const mapping = await read('src/sync/selection-mapping.js');
  assert.doesNotMatch(mapping, /R9-08/);
});

test('R9-08 production inventory records one Feedback Guard responsibility and final Stage 9 cardinality', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 381);
  assert.equal(records.get('src/features/sync/selection/selection-feedback-guard.js')?.[4], 'selection-feedback-guard-lifecycle');
});

test('R9-08 keeps Reader ownership separate from feedback policy after final Selection Controller migration', async () => {
  const editorReader = await read('src/features/sync/selection/editor-selection-reader.js');
  const previewReader = await read('src/features/sync/selection/preview-selection-reader.js');
  assert.doesNotMatch(editorReader, /SelectionFeedbackGuard|feedbackGuard/);
  assert.doesNotMatch(previewReader, /SelectionFeedbackGuard|feedbackGuard/);
  await access(file(controllerPath));
});
