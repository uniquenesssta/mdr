import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');

const SELECTION_LATER_FILES = [
  'src/features/sync/selection/selection-sync-controller.js',
  'src/features/sync/selection/editor-selection-reader.js',
  'src/features/sync/selection/preview-selection-reader.js',
  'src/features/sync/selection/selection-highlight-session.js',
  'src/features/sync/selection/selection-retry-scheduler.js',
  'src/features/sync/selection/selection-feedback-guard.js'
];

test('R9-06 creates one canonical ScrollGeometrySession and exposes it only through the Sync public entry', async () => {
  const session = await read('src/features/sync/scroll/scroll-geometry-session.js');
  const index = await read('src/features/sync/index.js');
  assert.match(session, /export class ScrollGeometrySession/);
  assert.match(session, /export function createScrollGeometrySession/);
  assert.match(index, /ScrollGeometrySession/);
  assert.match(index, /createScrollGeometrySession/);
  assert.match(index, /\.\/scroll\/scroll-geometry-session\.js/);
  assert.match(index, /R9-06/);
});

test('R9-06 Geometry Session owns only pending recalibration and geometry statistics without DOM RAF or source mutation', async () => {
  const session = await read('src/features/sync/scroll/scroll-geometry-session.js');
  assert.match(session, /this\.pendingSourceSide/);
  assert.match(session, /this\.geometryResyncs/);
  assert.match(session, /sourceOwnership\.getSourceSide\(\)/);
  assert.doesNotMatch(session, /addEventListener|removeEventListener|requestAnimationFrame|cancelAnimationFrame|document\.|window\.|globalThis\./);
  assert.doesNotMatch(session, /beginUserGesture|touchSource|markProgrammaticScroll|suspend\(|this\.sourceSide\s*=|this\.sourceReason\s*=/);
});

test('R9-06 Scroll Controller delegates geometry authority while retaining generic source/target orchestration', async () => {
  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');
  assert.match(controller, /createScrollGeometrySession/);
  assert.match(controller, /this\.geometrySession\.compensate\(side, delta, reason\)/);
  assert.match(controller, /this\.geometrySession\.notifyGeometryChanged\(side\)/);
  assert.match(controller, /this\.geometrySession\.settleSourceSync\(side, \{ published \}\)/);
  assert.match(controller, /this\.geometrySession\.getState\(\)/);
  assert.match(controller, /this\.geometrySession\.destroy\(\)/);
  assert.doesNotMatch(controller, /pendingGeometryResync|geometryResyncs:\s*0/);
  assert.match(controller, /this\.frames = \{ source: null, target: null \}/);
  assert.match(controller, /scheduleTarget/);
  assert.match(controller, /applyScrollTop/);
});

test('R9-06 preserves the frozen R9-01 public geometry API and runtime-stat projection through delegation', async () => {
  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');
  assert.match(controller, /compensate: \(side, delta, reason\) => this\.compensate\(side, delta, reason\)/);
  assert.match(controller, /notifyGeometryChanged: side => this\.notifyGeometryChanged\(side\)/);
  assert.match(controller, /\.\.\.this\.geometrySession\.getState\(\)/);
  assert.match(controller, /markProgrammaticScroll/);
  assert.match(controller, /scheduleTarget/);
  assert.match(controller, /syncNow/);
});

test('R9-06 current layout preview and classic geometry producers still route through the controller compatibility surface', async () => {
  const main = await read('src/main.js');
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(main, /onGeometryChanged: \(\) => scrollController\.notifyGeometryChanged\('preview'\)/);
  assert.match(main, /onGeometryChanged\(\) \{ scrollController\.notifyGeometryChanged\(\); \}/);
  assert.match(legacy, /scrollController\.notifyGeometryChanged\('editor'\)/);
  assert.match(legacy, /scrollController\.notifyGeometryChanged\('preview'\)/);
  assert.match(legacy, /scrollController\.notifyGeometryChanged\(\)/);
  assert.doesNotMatch(main, /\.\/features\/sync\/scroll\/scroll-geometry-session\.js/);
});

test('R9-06 leaves Editor Preview mapper authority intact and does not advance Selection Atomics', async () => {
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/preview-scroll-mapper.js'));
  for (const path of SELECTION_LATER_FILES) await assert.rejects(access(file(path)), path);
  await access(file('src/sync/selection-controller.js'));
  await access(file('src/sync/selection-mapping.js'));
  const frozenMapping = await read('src/sync/selection-mapping.js');
  assert.doesNotMatch(frozenMapping, /R9-06/);
});

test('R9-06 inventory records one geometry owner and current package cardinality', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 376);
  assert.equal(records.has('src/features/sync/scroll/scroll-geometry-session.js'), true);
  assert.equal(records.get('src/features/sync/scroll/scroll-geometry-session.js')[4], 'scroll-geometry-session');
  assert.equal(records.get('src/features/sync/scroll/scroll-sync-controller.js')[4], 'scroll-sync-runtime');
  assert.equal(records.get('src/features/sync/scroll/scroll-source-ownership.js')[4], 'scroll-source-ownership');
});
