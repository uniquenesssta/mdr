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

test('Atomic 8.5 keeps remaining legacy widgets plus migrated Code Block and Table on shared idempotent destroy paths', async () => {
  const widgets = await text('src/editor/hybrid/widgets.js');
  const codeBlock = await text('src/features/hybrid-editor/widgets/code-block/code-block-widget.js');
  const tableBlock = await text('src/features/hybrid-editor/widgets/table/table-widget.js');
  const imageBlock = await text('src/features/hybrid-editor/widgets/image/image-widget.js');
  const inlineMath = await text('src/features/hybrid-editor/widgets/math/inline-math-widget.js');
  const blockMath = await text('src/features/hybrid-editor/widgets/math/block-math-widget.js');
  const destroyCalls = widgets.match(/destroy\(dom\)\s*\{\s*destroyBlockLifecycle\(dom\);\s*\}/g) || [];
  assert.equal(destroyCalls.length, 2);
  assert.match(widgets, /function destroyBlockLifecycle\(element\)/);
  assert.match(widgets, /destroyHybridWidgetLifecycle\(element\)/);
  assert.match(codeBlock, /section\.__markdownEditorCodeBlockCleanup = \(\) => \{/);
  assert.match(codeBlock, /if \(cleaned\) return;\s*cleaned = true;/);
  assert.match(codeBlock, /destroy\(dom\) \{[\s\S]*dom\?\.__markdownEditorCodeBlockCleanup\?\.\(\);[\s\S]*destroyHybridWidgetLifecycle\(dom\);/);
  assert.match(tableBlock, /section\.__markdownEditorTableBlockCleanup = \(\) => \{/);
  assert.match(tableBlock, /if \(cleaned\) return;\s*cleaned = true;/);
  assert.match(tableBlock, /__markdownEditorDestroyTableCell/);
  assert.match(tableBlock, /destroy\(dom\) \{[\s\S]*dom\?\.__markdownEditorTableBlockCleanup\?\.\(\);[\s\S]*destroyHybridWidgetLifecycle\(dom\);/);
  assert.match(imageBlock, /figure\.__markdownEditorImageBlockCleanup = \(\) => \{/);
  assert.match(imageBlock, /if \(cleaned\) return;\s*cleaned = true;/);
  assert.match(imageBlock, /loadVersion\.destroy\(\)/);
  assert.match(imageBlock, /destroy\(dom\) \{[\s\S]*dom\?\.__markdownEditorImageBlockCleanup\?\.\(\);[\s\S]*destroyHybridWidgetLifecycle\(dom\);/);
  assert.match(inlineMath, /__markdownEditorInlineMathCleanup/);
  assert.match(inlineMath, /destroy\(dom\) \{[\s\S]*__markdownEditorInlineMathCleanup/);
  assert.match(blockMath, /__markdownEditorMathBlockCleanup/);
  assert.match(blockMath, /destroy\(dom\) \{[\s\S]*__markdownEditorMathBlockCleanup[\s\S]*destroyHybridWidgetLifecycle\(dom\)/);
});

test('Atomic 8.5 lifecycle boundary remains intact after Atomic 8.10 Image migration', async () => {
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  const paths = inventory.modules.map(item => item[0]);
  assert.equal(inventory.modules.length, 360);
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
