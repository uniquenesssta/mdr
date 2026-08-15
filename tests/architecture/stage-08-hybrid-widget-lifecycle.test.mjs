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

test('Atomic 8.5 editor callers keep lifecycle ownership behind the Hybrid Editor boundary after HTML migration', async () => {
  const widgets = await text('src/features/hybrid-editor/widgets/html/html-block-widget.js');
  const controller = await text('src/editor/hybrid/controller.js');
  assert.doesNotMatch(widgets, /from ['"]\.\/widget-lifecycle\.js['"]/);
  assert.match(widgets, /lifecycle\/widget-lifecycle\.js/);
  assert.match(widgets, /attachHybridWidgetLifecycle/);
  assert.match(widgets, /destroyHybridWidgetLifecycle/);
  assert.match(controller, /destroyHybridWidgetGeometryScheduler\(this\.view\)/);
  assert.doesNotMatch(controller, /from ['"]\.\/widget-lifecycle\.js['"]/);
});

test('Atomic 8.5 keeps migrated HTML and component widgets on shared idempotent destroy paths', async () => {
  const htmlBlock = await text('src/features/hybrid-editor/widgets/html/html-block-widget.js');
  const codeBlock = await text('src/features/hybrid-editor/widgets/code-block/code-block-widget.js');
  const tableBlock = await text('src/features/hybrid-editor/widgets/table/table-widget.js');
  const imageBlock = await text('src/features/hybrid-editor/widgets/image/image-widget.js');
  const inlineMath = await text('src/features/hybrid-editor/widgets/math/inline-math-widget.js');
  const blockMath = await text('src/features/hybrid-editor/widgets/math/block-math-widget.js');
  const mermaidBlock = await text('src/features/hybrid-editor/widgets/mermaid/mermaid-widget.js');
  assert.match(htmlBlock, /__markdownEditorHtmlBlockCleanup/);
  assert.match(htmlBlock, /if \(cleaned\) return;\s*cleaned = true;/);
  assert.match(htmlBlock, /disposeSourceAction\(\)/);
  assert.match(htmlBlock, /destroy\(dom\) \{[\s\S]*__markdownEditorHtmlBlockCleanup[\s\S]*destroyHybridWidgetLifecycle\(dom\)/);
  assert.match(codeBlock, /__markdownEditorCodeBlockCleanup/);
  assert.match(tableBlock, /__markdownEditorTableBlockCleanup/);
  assert.match(imageBlock, /__markdownEditorImageBlockCleanup/);
  assert.match(inlineMath, /__markdownEditorInlineMathCleanup/);
  assert.match(blockMath, /__markdownEditorMathBlockCleanup/);
  assert.match(mermaidBlock, /__markdownEditorMermaidBlockCleanup/);
  await assert.rejects(access(file('src/editor/hybrid/widgets.js')));
});

test('Atomic 8.5 lifecycle boundary remains intact after Atomic 8.10 Image migration', async () => {
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  const paths = inventory.modules.map(item => item[0]);
  assert.equal(inventory.modules.length, 370);
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
