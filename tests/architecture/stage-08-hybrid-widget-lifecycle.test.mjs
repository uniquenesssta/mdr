import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const file = path => new URL(path, root);
const text = path => readFile(file(path), 'utf8');

test('Atomic 8.5 has separate lifecycle and geometry scheduler owners behind the public entry', async () => {
  const lifecyclePath = 'src/features/hybrid-editor/lifecycle/widget-lifecycle.js';
  const schedulerPath = 'src/features/hybrid-editor/lifecycle/widget-geometry-scheduler.js';
  await access(file(lifecyclePath));
  await access(file(schedulerPath));
  await assert.rejects(access(file('src/editor/hybrid/widget-lifecycle.js')));
  const index = await text('src/features/hybrid-editor/index.js');
  assert.match(index, /lifecycle\/widget-lifecycle\.js/);
  assert.match(index, /lifecycle\/widget-geometry-scheduler\.js/);
});

test('Atomic 8.5 separates element observation from the geometry side-effect queue without changing the frozen refresh contract', async () => {
  const lifecycle = await text('src/features/hybrid-editor/lifecycle/widget-lifecycle.js');
  const scheduler = await text('src/features/hybrid-editor/lifecycle/widget-geometry-scheduler.js');
  assert.match(lifecycle, /ResizeObserverCtor|elementLifecycles|lastWidth|lastHeight/);
  assert.match(lifecycle, /scheduleHybridWidgetGeometry/);
  assert.doesNotMatch(lifecycle, /scheduleEditorMetricsRebuild|notifyGeometryChanged|notifyEditorGeometry|hybrid\.widget-geometry/);
  assert.match(scheduler, /scheduleEditorMetricsRebuild\?\.\(40\)/);
  assert.match(scheduler, /notifyGeometryChanged\?\.\('editor'\)/);
  assert.match(scheduler, /notifyEditorGeometry\?\.\(`hybrid-widget:/);
  assert.match(scheduler, /hybrid\.widget-geometry/);
  assert.match(scheduler, /\}, 120\)/);
  assert.doesNotMatch(scheduler, /new ResizeObserverCtor|elementLifecycles/);
});

test('Atomic 8.5 legacy editor callers depend on the Hybrid Editor public entry only', async () => {
  const widgets = await text('src/editor/hybrid/widgets.js');
  const controller = await text('src/editor/hybrid/controller.js');
  assert.doesNotMatch(widgets, /from ['"]\.\/widget-lifecycle\.js['"]/);
  assert.doesNotMatch(widgets, /features\/hybrid-editor\/lifecycle\//);
  assert.match(widgets, /attachHybridWidgetLifecycle/);
  assert.match(widgets, /destroyHybridWidgetLifecycle/);
  assert.match(controller, /destroyHybridWidgetGeometryScheduler\(this\.view\)/);
  assert.doesNotMatch(controller, /from ['"]\.\/widget-lifecycle\.js['"]/);
});

test('Atomic 8.5 keeps every block widget on the shared idempotent destroy path', async () => {
  const widgets = await text('src/editor/hybrid/widgets.js');
  const destroyCalls = widgets.match(/destroy\(dom\)\s*\{\s*destroyBlockLifecycle\(dom\);\s*\}/g) || [];
  assert.equal(destroyCalls.length, 6);
  assert.match(widgets, /function destroyBlockLifecycle\(element\)/);
  assert.match(widgets, /destroyHybridWidgetLifecycle\(element\)/);
});

test('Atomic 8.5 lifecycle boundary remains intact after Atomic 8.6 Shared Widget UI extraction', async () => {
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  const paths = inventory.modules.map(item => item[0]);
  assert.equal(inventory.modules.length, 343);
  assert.ok(paths.includes('src/features/hybrid-editor/lifecycle/widget-lifecycle.js'));
  assert.ok(paths.includes('src/features/hybrid-editor/lifecycle/widget-geometry-scheduler.js'));
  assert.ok(!paths.includes('src/editor/hybrid/widget-lifecycle.js'));
  for (const shared of [
    'src/features/hybrid-editor/widgets/shared/widget-button.js',
    'src/features/hybrid-editor/widgets/shared/widget-toolbar.js',
    'src/features/hybrid-editor/widgets/shared/widget-focus-policy.js',
    'src/features/hybrid-editor/widgets/shared/widget-source-action.js'
  ]) await access(file(shared));
});
