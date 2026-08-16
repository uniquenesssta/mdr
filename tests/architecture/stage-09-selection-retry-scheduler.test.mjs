import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');

test('R9-10 creates canonical SelectionRetryScheduler and exports it only through the Sync public entry', async () => {
  const index = await read('src/features/sync/index.js');
  const scheduler = await read('src/features/sync/selection/selection-retry-scheduler.js');
  assert.match(index, /R9-10/);
  assert.match(scheduler, /export class SelectionRetryScheduler/);
  assert.match(scheduler, /export function createSelectionRetryScheduler/);
  assert.match(index, /\.\/selection\/selection-retry-scheduler\.js/);
});

test('R9-10 Retry Scheduler owns only bounded frame generation version and cancellation state without mapping DOM feedback highlight or scroll policy', async () => {
  const source = await read('src/features/sync/selection/selection-retry-scheduler.js');
  assert.match(source, /DEFAULT_MAX_RETRIES = 3/);
  assert.match(source, /this\.generation/);
  assert.match(source, /this\.version/);
  assert.match(source, /this\.attempts/);
  assert.match(source, /this\.pending/);
  assert.match(source, /this\.cancelPending\(\)/);
  assert.doesNotMatch(source, /document\.|window\.|globalThis\.|selectionMapping|markdownEditorDocumentModel|editorSelectionReader|previewSelectionReader|feedbackGuard|SelectionHighlightSession|CSS\.highlights|scrollTo|addEventListener|setTimeout/);
});

test('R9-10 legacy SelectionSyncController delegates retry scheduling and no longer owns retry count or retry RAF state', async () => {
  const controller = await read('src/sync/selection-controller.js');
  assert.match(controller, /SelectionSyncController requires SelectionRetryScheduler/);
  assert.match(controller, /this\.retryScheduler\.schedule\(\{/);
  assert.match(controller, /version: key/);
  assert.match(controller, /getVersion: \(\) => this\.makeEditorKey\(\)/);
  assert.match(controller, /this\.retryScheduler\.cancel\(\)/);
  assert.doesNotMatch(controller, /DEFAULT_MAX_RETRIES|result\.maxRetries|attempt <|this\.editorFrame = nextFrame\(\(\) => \{\s*this\.editorFrame = 0;\s*this\.runEditor/s);
});

test('R9-10 retry orchestration is requested only for recoverable pending results and classic mapping no longer owns retry limits', async () => {
  const controller = await read('src/sync/selection-controller.js');
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(controller, /if \(result\?\.status === 'pending'\)/);
  const runEditorBlock = controller.slice(controller.indexOf('  runEditor('), controller.indexOf('  schedulePreview('));
  assert.match(runEditorBlock, /retryScheduler\.schedule/);
  assert.doesNotMatch(runEditorBlock, /mapping-failed/);
  assert.doesNotMatch(legacy, /maxRetries/);
  assert.match(legacy, /status: 'pending'/);
  assert.match(legacy, /status: virtualController\?\.active && !matchingAnchors\.length \? 'pending' : 'mapping-failed'/);
});

test('R9-10 composition creates one Scheduler from explicit frame capabilities injects it and destroys it without a compatibility/global retry owner', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createSelectionRetryScheduler/);
  assert.match(main, /const selectionRetryScheduler = createSelectionRetryScheduler\(\{/);
  assert.match(main, /retryScheduler: selectionRetryScheduler/);
  assert.match(main, /selectionRetryScheduler\.destroy\(\)/);
  assert.doesNotMatch(main, /window\.markdownEditorSelectionRetryScheduler|markdownEditorSelectionRetryScheduler =/);
  assert.doesNotMatch(main, /\.\/features\/sync\/selection\/selection-retry-scheduler\.js/);
});

test('R9-10 stale replacement lifecycle is explicit and old callbacks are invalidated before work executes', async () => {
  const scheduler = await read('src/features/sync/selection/selection-retry-scheduler.js');
  assert.match(scheduler, /this\.pending !== pending/);
  assert.match(scheduler, /!Object\.is\(currentVersion, pending\.version\)/);
  assert.match(scheduler, /this\.stale \+= 1/);
  assert.match(scheduler, /this\.invalidateSeries\(\)/);
  assert.match(scheduler, /this\.cancelFrame\(frameId\)/);
  assert.match(scheduler, /destroy\(\)/);
});

test('R9-10 keeps frozen selection mapping and later final Selection controller migration untouched', async () => {
  await access(file('src/sync/selection-mapping.js'));
  await assert.rejects(access(file('src/features/sync/selection/selection-sync-controller.js')));
  const mapping = await read('src/sync/selection-mapping.js');
  assert.doesNotMatch(mapping, /R9-10/);
  const highlight = await read('src/features/sync/selection/selection-highlight-session.js');
  const feedback = await read('src/features/sync/selection/selection-feedback-guard.js');
  assert.doesNotMatch(highlight, /SelectionRetryScheduler|retryScheduler/);
  assert.doesNotMatch(feedback, /SelectionRetryScheduler|retryScheduler/);
});

test('R9-10 production inventory records one Retry Scheduler owner and cardinality 381', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 381);
  assert.equal(records.get('src/features/sync/selection/selection-retry-scheduler.js')?.[4], 'selection-retry-scheduler-lifecycle');
  assert.match(records.get('src/sync/selection-controller.js')?.[3] || '', /R9-10 Retry Scheduler/);
});
