import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const file = path => new URL(path, root);
const text = path => readFile(file(path), 'utf8');
const htmlPaths = [
  'src/features/hybrid-editor/widgets/html/html-block-widget.js',
  'src/features/hybrid-editor/widgets/html/html-block-view.js'
];

test('Atomic 8.13 creates separate HTML Widget and View modules and exposes only the factory through the public entry', async () => {
  for (const path of htmlPaths) await access(file(path));
  const index = await text('src/features/hybrid-editor/index.js');
  assert.match(index, /from '\.\/widgets\/html\/html-block-widget\.js'/);
  assert.doesNotMatch(index, /html-block-view\.js|renderHtmlBlockSource|createHtmlBlockView/);
  const module = await import(new URL('../../src/features/hybrid-editor/index.js', import.meta.url));
  assert.equal(typeof module.createHtmlBlockWidgetType, 'function');
});

test('Atomic 8.13 HTML feature graph is browser-direct-safe and receives WidgetType and telemetry only by injection', async () => {
  const sources = await Promise.all(htmlPaths.map(path => text(path)));
  const joined = sources.join('\n');
  assert.doesNotMatch(joined, /from '@codemirror\//);
  assert.doesNotMatch(joined, /from ['"][^'"]*(?:model-kernel|document-model|table-model|preview)/);
  assert.doesNotMatch(joined, /window\.|globalThis\.window|markdownEditorPerf/);
  assert.match(sources[0], /createHtmlBlockWidgetType\(WidgetType, options = \{\}\)/);
  assert.match(sources[0], /options\.recordInteraction/);
});

test('Atomic 8.13 HTML View owns raw presentation only and does not introduce sanitizer or interaction authority', async () => {
  const [widget, view] = await Promise.all(htmlPaths.map(path => text(path)));
  assert.match(view, /template\.innerHTML = String\(source \|\| ''\)/);
  assert.match(view, /template\.content\.cloneNode\(true\)/);
  assert.match(view, /cm-hybrid-html-body markdown-body/);
  assert.match(view, /data|dataset\.hybridDoubleZone/);
  assert.doesNotMatch(view, /DOMPurify|sanitize|transitionHybridComponent|bindWidgetSourceAction|openWidgetSource|attachHybridWidgetLifecycle/);
  assert.doesNotMatch(widget, /innerHTML|createElement\(['"]template['"]\)/);
});

test('Atomic 8.13 HTML Widget owns SOURCE delegation and explicit idempotent cleanup without duplicating shared policy', async () => {
  const widget = await text(htmlPaths[0]);
  for (const symbol of ['bindWidgetSourceAction', 'openWidgetSource', 'attachHybridWidgetLifecycle', 'destroyHybridWidgetLifecycle']) {
    assert.match(widget, new RegExp(symbol), symbol);
  }
  assert.match(widget, /sourceKeys: \[\]/);
  assert.match(widget, /componentType: 'html'/);
  assert.match(widget, /editFrom: this\.from/);
  assert.match(widget, /editTo: this\.to/);
  assert.match(widget, /__markdownEditorHtmlBlockCleanup/);
  assert.match(widget, /if \(cleaned\) return;\s*cleaned = true;/);
  assert.match(widget, /disposeSourceAction\(\)/);
  assert.doesNotMatch(widget, /bindStrictDoubleActivation|bindSourceActivation|getClassicHybridSourceEditControllerPort/);
});

test('Atomic 8.13 removes legacy HTML authority and composes HTML through the Hybrid Editor public entry', async () => {
  await assert.rejects(access(file('src/editor/hybrid/widgets.js')));
  const controller = await text('src/editor/hybrid/controller.js');
  assert.match(controller, /createHtmlBlockWidgetType/);
  assert.match(controller, /const HtmlBlockWidget = createHtmlBlockWidgetType\(WidgetType/);
  assert.match(controller, /recordHtmlInteraction/);
  assert.doesNotMatch(controller, /from ['"]\.\/widgets\.js['"]/);
  assert.doesNotMatch(controller, /class HtmlBlockWidget|template\.innerHTML/);
});

test('Atomic 8.13 inventory records the two HTML responsibilities and removes the legacy aggregate', async () => {
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  const paths = new Set(inventory.modules.map(row => row[0]));
  assert.equal(inventory.modules.length, 364);
  for (const path of htmlPaths) assert.equal(paths.has(path), true, path);
  assert.equal(paths.has('src/editor/hybrid/widgets.js'), false);
  const view = inventory.modules.find(row => row[0] === htmlPaths[1]);
  const widget = inventory.modules.find(row => row[0] === htmlPaths[0]);
  assert.equal(view[4], 'none');
  assert.equal(widget[5], 'widget-lifecycle');
});
