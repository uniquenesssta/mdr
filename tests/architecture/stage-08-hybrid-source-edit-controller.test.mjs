import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const file = path => new URL(path, root);
const text = path => readFile(file(path), 'utf8');

test('Atomic 8.4 has one public Source Edit Controller and an explicit editor transaction port', async () => {
  const application = 'src/features/hybrid-editor/application/hybrid-source-edit-controller.js';
  const editorPort = 'src/features/hybrid-editor/compatibility/codemirror-source-editor-port.js';
  const bridge = 'src/features/hybrid-editor/compatibility/classic-hybrid-source-edit-controller-port.js';
  await access(file(application));
  await access(file(editorPort));
  await access(file(bridge));
  const index = await text('src/features/hybrid-editor/index.js');
  assert.match(index, /application\/hybrid-source-edit-controller\.js/);
  assert.doesNotMatch(index, /compatibility\/codemirror-source-editor-port\.js/);
  assert.match(index, /compatibility\/classic-hybrid-source-edit-controller-port\.js/);
  const legacyController = await text('src/editor/hybrid/controller.js');
  assert.match(legacyController, /compatibility\/codemirror-source-editor-port\.js/);
});

test('Atomic 8.4 application owner is implementation/DOM-free and editor actions exist only behind the editor port', async () => {
  const controller = await text('src/features/hybrid-editor/application/hybrid-source-edit-controller.js');
  assert.doesNotMatch(controller, /@codemirror|EditorView|StateEffect|view\.dispatch\(|view\.focus\(|view\.blur\(|scrollDOM|contentDOM|window\.|document\./);
  for (const operation of [
    'getDocumentLength', 'getScrollViewportMetrics', 'markProgrammaticScroll', 'focus',
    'revealSourceRange', 'inspectUpdate', 'positionAtCoordinates', 'setSelection', 'blur'
  ]) assert.match(controller, new RegExp(`editorPort\\.${operation}`), operation);
});

test('Atomic 8.4 removes source range and outside-pointer close authority from legacy widgets/controller/Activation', async () => {
  const widgets = await text('src/editor/hybrid/widgets.js');
  const sourceAction = await text('src/features/hybrid-editor/widgets/shared/widget-source-action.js');
  const legacyController = await text('src/editor/hybrid/controller.js');
  const outside = await text('src/features/hybrid-editor/activation/outside-pointer-closure.js');
  assert.doesNotMatch(widgets, /activeHybridSourceRanges|setActiveHybridSourceRange|getActiveHybridSourceRange|clearActiveHybridSourceRange|revealHybridSourceRangeEffect/);
  assert.doesNotMatch(widgets, /scrollIntoView\(|view\.state\.doc\.length[\s\S]{0,1200}source-opened/);
  assert.doesNotMatch(widgets, /getClassicHybridSourceEditControllerPort\(view\)/);
  assert.match(sourceAction, /getClassicHybridSourceEditControllerPort\(view\)/);
  assert.doesNotMatch(legacyController, /mapActiveSourceRange|selectionIntersectsRange|closeActiveSourceFromPointer|clearActiveHybridSourceRange|getActiveHybridSourceRange|setActiveHybridSourceRange/);
  assert.match(legacyController, /createHybridSourceEditController/);
  assert.match(legacyController, /createCodeMirrorSourceEditorPort/);
  assert.doesNotMatch(outside, /closeActiveSourceFromPointer|posAtCoords|view\.dispatch|contentDOM/);
});

test('Atomic 8.4 source-edit boundary remains intact after Atomic 8.6 Shared Widget UI extraction', async () => {
  await access(file('src/features/hybrid-editor/application/hybrid-source-edit-controller.js'));
  await access(file('src/features/hybrid-editor/lifecycle/widget-lifecycle.js'));
  await access(file('src/features/hybrid-editor/lifecycle/widget-geometry-scheduler.js'));
  await assert.rejects(access(file('src/editor/hybrid/widget-lifecycle.js')));
});

test('Atomic 8.4 production inventory records the new responsibility boundaries', async () => {
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  const paths = inventory.modules.map(item => item[0]);
  assert.equal(inventory.modules.length, 346);
  for (const path of [
    'src/features/hybrid-editor/application/hybrid-source-edit-controller.js',
    'src/features/hybrid-editor/compatibility/codemirror-source-editor-port.js',
    'src/features/hybrid-editor/compatibility/classic-hybrid-source-edit-controller-port.js'
  ]) assert.ok(paths.includes(path), path);
});
