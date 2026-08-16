import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const file = path => new URL(path, root);
const text = path => readFile(file(path), 'utf8');

test('Atomic 8.4 keeps one Source Edit Controller while CodeMirror transaction compatibility stays at the final editor integration boundary', async () => {
  const application = 'src/features/hybrid-editor/application/hybrid-source-edit-controller.js';
  const editorPort = 'src/features/hybrid-editor/compatibility/codemirror-source-editor-port.js';
  const bridge = 'src/features/hybrid-editor/compatibility/classic-hybrid-source-edit-controller-port.js';
  await access(file(application));
  await access(file(editorPort));
  await access(file(bridge));
  const index = await text('src/features/hybrid-editor/index.js');
  assert.match(index, /application\/hybrid-source-edit-controller\.js/);
  assert.match(index, /compatibility\/classic-hybrid-source-edit-controller-port\.js/);
  assert.doesNotMatch(index, /compatibility\/codemirror-source-editor-port\.js|createCodeMirrorSourceEditorPort|revealHybridSourceRangeEffect/);
  const facade = await text('src/editor/hybrid-markdown.js');
  assert.match(facade, /createCodeMirrorSourceEditorPort/);
  assert.match(facade, /compatibility\/codemirror-source-editor-port\.js/);
  assert.match(facade, /from '\.\.\/features\/hybrid-editor\/index\.js'/);
  await assert.rejects(access(file('src/editor/hybrid/controller.js')));
});

test('Atomic 8.4 application owner is implementation/DOM-free and editor actions exist only behind the editor port', async () => {
  const controller = await text('src/features/hybrid-editor/application/hybrid-source-edit-controller.js');
  assert.doesNotMatch(controller, /@codemirror|EditorView|StateEffect|view\.dispatch\(|view\.focus\(|view\.blur\(|scrollDOM|contentDOM|window\.|document\./);
  for (const operation of [
    'getDocumentLength', 'getScrollViewportMetrics', 'markProgrammaticScroll', 'focus',
    'revealSourceRange', 'inspectUpdate', 'positionAtCoordinates', 'setSelection', 'blur'
  ]) assert.match(controller, new RegExp(`editorPort\\.${operation}`), operation);
});

test('Atomic 8.4 source-range authority remains removed from widgets and the final editor integration layer', async () => {
  const widgets = await text('src/features/hybrid-editor/widgets/html/html-block-widget.js');
  const sourceAction = await text('src/features/hybrid-editor/widgets/shared/widget-source-action.js');
  const facade = await text('src/editor/hybrid-markdown.js');
  const application = await text('src/features/hybrid-editor/application/hybrid-editor-controller.js');
  const outside = await text('src/features/hybrid-editor/activation/outside-pointer-closure.js');
  assert.doesNotMatch(widgets, /activeHybridSourceRanges|setActiveHybridSourceRange|getActiveHybridSourceRange|clearActiveHybridSourceRange|revealHybridSourceRangeEffect/);
  assert.doesNotMatch(widgets, /scrollIntoView\(|view\.state\.doc\.length[\s\S]{0,1200}source-opened/);
  assert.doesNotMatch(widgets, /getClassicHybridSourceEditControllerPort\(view\)/);
  assert.match(sourceAction, /getClassicHybridSourceEditControllerPort\(view\)/);
  assert.doesNotMatch(facade + application, /mapActiveSourceRange|selectionIntersectsRange|closeActiveSourceFromPointer|clearActiveHybridSourceRange|setActiveHybridSourceRange/);
  assert.match(facade, /createHybridSourceEditController/);
  assert.match(facade, /createCodeMirrorSourceEditorPort/);
  assert.match(application, /sourceEditController\.handleEditorUpdate\(update\)/);
  assert.match(application, /sourceEditController\.closeFromPointer\(pointer\)/);
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
  assert.equal(inventory.modules.length, 374);
  for (const path of [
    'src/features/hybrid-editor/application/hybrid-source-edit-controller.js',
    'src/features/hybrid-editor/compatibility/codemirror-source-editor-port.js',
    'src/features/hybrid-editor/compatibility/classic-hybrid-source-edit-controller-port.js'
  ]) assert.ok(paths.includes(path), path);
});
