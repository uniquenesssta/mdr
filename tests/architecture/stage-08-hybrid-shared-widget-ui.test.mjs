import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const file = path => new URL(path, root);
const text = path => readFile(file(path), 'utf8');

const sharedPaths = [
  'src/features/hybrid-editor/widgets/shared/widget-button.js',
  'src/features/hybrid-editor/widgets/shared/widget-toolbar.js',
  'src/features/hybrid-editor/widgets/shared/widget-focus-policy.js',
  'src/features/hybrid-editor/widgets/shared/widget-source-action.js'
];

test('Atomic 8.6 exposes four responsibility-specific Shared Widget UI primitives through the Hybrid Editor public entry', async () => {
  for (const path of sharedPaths) await access(file(path));
  const index = await text('src/features/hybrid-editor/index.js');
  for (const module of [
    'widget-button.js', 'widget-toolbar.js', 'widget-focus-policy.js', 'widget-source-action.js'
  ]) assert.match(index, new RegExp(`widgets\/shared\/${module.replace('.', '\.')}`), module);
});

test('Atomic 8.6 shared primitives contain no component-type policy or state ownership', async () => {
  const forbiddenComponentKinds = /\b(?:code|table|image|math|mermaid|html|prefix|task)\b/i;
  for (const path of sharedPaths) {
    const source = await text(path);
    assert.doesNotMatch(source, forbiddenComponentKinds, path);
    assert.doesNotMatch(source, /HYBRID_COMPONENT_MODES|transitionHybridComponent|registerHybridComponentCloser|closeHybridComponent/, path);
  }
  const sourceAction = await text(sharedPaths[3]);
  assert.doesNotMatch(sourceAction, /switch\s*\(|componentType\s*===|componentType\s*!==/);
});

test('Atomic 8.6 migrated HTML consumes Shared Widget UI without duplicating shared primitives', async () => {
  const widget = await text('src/features/hybrid-editor/widgets/html/html-block-widget.js');
  const view = await text('src/features/hybrid-editor/widgets/html/html-block-view.js');
  assert.match(widget, /bindWidgetSourceAction/);
  assert.match(widget, /openWidgetSource/);
  assert.match(view, /createWidgetButton/);
  assert.match(view, /createWidgetToolbar/);
  assert.doesNotMatch(widget + view, /function createWidgetButton|function editSourceBlock|function enableBlockSourceEditing/);
  assert.doesNotMatch(widget + view, /features\/hybrid-editor\/index\.js/);
});

test('Atomic 8.6 toolbar and source primitives remain shared after Atomic 8.13 HTML extraction', async () => {
  const htmlView = await text('src/features/hybrid-editor/widgets/html/html-block-view.js');
  const htmlWidget = await text('src/features/hybrid-editor/widgets/html/html-block-widget.js');
  const mermaidActions = await text('src/features/hybrid-editor/widgets/mermaid/mermaid-actions.js');
  const mermaidWidget = await text('src/features/hybrid-editor/widgets/mermaid/mermaid-widget.js');
  assert.match(htmlView, /createWidgetToolbar/);
  assert.match(htmlView, /createWidgetButton/);
  assert.match(htmlWidget, /bindWidgetSourceAction/);
  assert.match(htmlWidget, /openWidgetSource/);
  assert.match(mermaidActions, /createWidgetToolbar/);
  assert.match(mermaidActions, /createWidgetActionGroup/);
  assert.match(mermaidActions, /createWidgetButton/);
  assert.match(mermaidWidget, /bindWidgetSourceAction/);
  assert.match(mermaidWidget, /openWidgetSource/);
  await assert.rejects(access(file('src/editor/hybrid/widgets.js')));
});

test('Atomic 8.6 Shared Widget UI boundary remains intact after Atomic 8.10 Image migration', async () => {
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  const paths = inventory.modules.map(item => item[0]);
  assert.equal(inventory.modules.length, 371);
  for (const path of sharedPaths) assert.ok(paths.includes(path), path);
  const shared = await Promise.all(sharedPaths.map(path => text(path)));
  assert.doesNotMatch(shared.join('\n'), /HybridPrefixWidget|TaskCheckboxWidget|HorizontalRuleWidget/);
});
