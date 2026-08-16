import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');

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

test('R9-06 final composition routes preview editor and Hybrid geometry producers through Scroll Controller explicitly', async () => {
  const main = await read('src/main.js');
  const hybrid = await read('src/features/hybrid-editor/runtime/hybrid-sync-capabilities.js');
  assert.match(main, /onGeometryChanged: \(\) => scrollController\.notifyGeometryChanged\('preview'\)/);
  assert.match(main, /preparePreviewEditorMetrics: \(\) => scrollController\.notifyGeometryChanged\('editor'\)/);
  assert.match(main, /notifyScrollGeometry: surface => scrollController\.notifyGeometryChanged\(surface\)/);
  assert.match(hybrid, /notifyScrollGeometry/);
  assert.doesNotMatch(main, /\.\/features\/sync\/scroll\/scroll-geometry-session\.js/);
  await assert.rejects(access(file('public/app/scroll-sync.js')));
});

test('R9-06 keeps mapper and frozen mapping ownership separate after final Selection orchestration arrives', async () => {
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/preview-scroll-mapper.js'));
  await access(file('src/features/sync/selection/selection-sync-controller.js'));
  await assert.rejects(access(file('src/sync/selection-controller.js')));
  await access(file('src/sync/selection-mapping.js'));
  const frozenMapping = await read('src/sync/selection-mapping.js');
  assert.doesNotMatch(frozenMapping, /R9-06/);
});

test('R9-06 inventory records one geometry owner and final Stage 9 cardinality', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 381);
  assert.equal(records.has('src/features/sync/scroll/scroll-geometry-session.js'), true);
  assert.equal(records.get('src/features/sync/scroll/scroll-geometry-session.js')[4], 'scroll-geometry-session');
  assert.equal(records.get('src/features/sync/scroll/scroll-sync-controller.js')[4], 'scroll-sync-runtime');
  assert.equal(records.get('src/features/sync/scroll/scroll-source-ownership.js')[4], 'scroll-source-ownership');
});
