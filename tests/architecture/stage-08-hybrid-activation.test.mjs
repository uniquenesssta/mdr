import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const file = path => new URL(path, root);
const text = path => readFile(file(path), 'utf8');

test('Atomic 8.3 has three explicit Activation owners and removes the legacy double-activation authority', async () => {
  for (const path of [
    'src/features/hybrid-editor/activation/strict-double-activation.js',
    'src/features/hybrid-editor/activation/source-activation.js',
    'src/features/hybrid-editor/activation/outside-pointer-closure.js'
  ]) await access(file(path));
  await assert.rejects(access(file('src/editor/hybrid/double-activation.js')));

  const index = await text('src/features/hybrid-editor/index.js');
  assert.match(index, /activation\/strict-double-activation\.js/);
  assert.match(index, /activation\/source-activation\.js/);
  assert.match(index, /activation\/outside-pointer-closure\.js/);
});

test('Atomic 8.3 production callers retain Activation ownership after Atomic 8.12 Mermaid migration', async () => {
  const widgets = await text('src/editor/hybrid/widgets.js');
  const mermaidWidget = await text('src/features/hybrid-editor/widgets/mermaid/mermaid-widget.js');
  const sourceAction = await text('src/features/hybrid-editor/widgets/shared/widget-source-action.js');
  const tableCellEditor = await text('src/features/hybrid-editor/widgets/table/table-cell-editor.js');
  const controller = await text('src/editor/hybrid/controller.js');
  assert.match(widgets, /features\/hybrid-editor\/index\.js/);
  assert.doesNotMatch(widgets, /bindStrictDoubleActivation|bindSourceActivation|bindOutsidePointerClosure/);
  assert.match(mermaidWidget, /bindStrictDoubleActivation/);
  assert.doesNotMatch(mermaidWidget, /bindSourceActivation|bindOutsidePointerClosure/);
  assert.match(sourceAction, /bindStrictDoubleActivation/);
  assert.match(sourceAction, /bindSourceActivation/);
  assert.match(tableCellEditor, /bindOutsidePointerClosure/);
  assert.doesNotMatch(widgets, /double-activation\.js|features\/hybrid-editor\/activation\//);
  assert.doesNotMatch(widgets, /document\.addEventListener\(['"]pointerdown|document\.removeEventListener\(['"]pointerdown/);
  assert.doesNotMatch(mermaidWidget, /document\.addEventListener\(['"]pointerdown|document\.removeEventListener\(['"]pointerdown/);
  assert.doesNotMatch(tableCellEditor, /document\.addEventListener\(['"]pointerdown|document\.removeEventListener\(['"]pointerdown/);
  assert.doesNotMatch(controller, /closeActiveSourceFromPointer/);
  assert.match(controller, /createHybridSourceEditController/);
  assert.doesNotMatch(controller, /features\/hybrid-editor\/activation\//);
});

test('Atomic 8.3 Session owns document listener disposer lifecycle without a second component-state authority', async () => {
  const session = await text('src/features/hybrid-editor/state/hybrid-component-session.js');
  assert.match(session, /this\.documentListenerDisposers = new Set\(\)/);
  assert.match(session, /registerDocumentListener\(target, type, listener, options\)/);
  assert.match(session, /#disposeDocumentListeners\(\)/);
  assert.match(session, /target\.removeEventListener\(type, listener, options\)/);
  assert.equal((session.match(/this\.current = null/g) || []).length >= 1, true);
});

test('Atomic 8.3 Activation boundary remains intact after Atomic 8.6 Shared Widget UI extraction', async () => {
  await access(file('src/features/hybrid-editor/application/hybrid-source-edit-controller.js'));
  const widgets = await text('src/editor/hybrid/widgets.js');
  const sourceAction = await text('src/features/hybrid-editor/widgets/shared/widget-source-action.js');
  assert.doesNotMatch(widgets, /function editSourceBlock\(/);
  assert.match(sourceAction, /export function openWidgetSource\(/);
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  const paths = inventory.modules.map(item => item[0]);
  assert.equal(inventory.modules.length, 363);
  assert.ok(!paths.includes('src/editor/hybrid/double-activation.js'));
  for (const path of [
    'src/features/hybrid-editor/activation/strict-double-activation.js',
    'src/features/hybrid-editor/activation/source-activation.js',
    'src/features/hybrid-editor/activation/outside-pointer-closure.js'
  ]) assert.ok(paths.includes(path), path);
});
