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

test('Atomic 8.6 legacy widgets consume Shared Widget UI only through the Hybrid Editor public entry', async () => {
  const widgets = await text('src/editor/hybrid/widgets.js');
  assert.match(widgets, /features\/hybrid-editor\/index\.js/);
  for (const symbol of [
    'createWidgetButton', 'createWidgetToolbar', 'createWidgetActionGroup',
    'bindWidgetSourceAction', 'openWidgetSource'
  ]) assert.match(widgets, new RegExp(symbol), symbol);
  assert.doesNotMatch(widgets, /features\/hybrid-editor\/widgets\/shared\//);
  assert.doesNotMatch(widgets, /function createWidgetButton|function editSourceBlock|function enableBlockSourceEditing/);
});

test('Atomic 8.6 toolbar and source primitives replace only shared DOM/action mechanics while component-specific content remains local', async () => {
  const widgets = await text('src/editor/hybrid/widgets.js');
  assert.equal((widgets.match(/(?:const header|const toolbar) = createWidgetToolbar\(/g) || []).length, 3);
  assert.equal((widgets.match(/createWidgetActionGroup\(/g) || []).length, 1);
  assert.equal((widgets.match(/bindWidgetSourceAction\(/g) || []).length, 4);
  assert.ok((widgets.match(/createWidgetButton\(/g) || []).length >= 4);
  assert.doesNotMatch(widgets, /document\.createElement\(['"]header['"]\)/);
  assert.doesNotMatch(widgets, /class ImageBlockWidget/);
  const imageWidget = await text('src/features/hybrid-editor/widgets/image/image-widget.js');
  for (const symbol of ['createWidgetButton', 'createWidgetToolbar', 'bindWidgetSourceAction', 'openWidgetSource']) {
    assert.match(imageWidget, new RegExp(symbol), symbol);
  }
  assert.doesNotMatch(widgets, /class CodeBlockWidget|class TableBlockWidget/);
  assert.doesNotMatch(widgets, /class HybridPrefixWidget|class HorizontalRuleWidget/);
});

test('Atomic 8.6 Shared Widget UI boundary remains intact after Atomic 8.10 Image migration', async () => {
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  const paths = inventory.modules.map(item => item[0]);
  assert.equal(inventory.modules.length, 358);
  for (const path of sharedPaths) assert.ok(paths.includes(path), path);
  const shared = await Promise.all(sharedPaths.map(path => text(path)));
  assert.doesNotMatch(shared.join('\n'), /HybridPrefixWidget|TaskCheckboxWidget|HorizontalRuleWidget/);
});
