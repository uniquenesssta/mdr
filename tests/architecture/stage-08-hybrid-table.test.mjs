import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const file = path => new URL(path, root);
const text = path => readFile(file(path), 'utf8');

const tablePaths = [
  'src/features/hybrid-editor/widgets/table/table-widget.js',
  'src/features/hybrid-editor/widgets/table/table-view.js',
  'src/features/hybrid-editor/widgets/table/table-cell-editor.js',
  'src/features/hybrid-editor/widgets/table/table-keyboard-navigation.js',
  'src/features/hybrid-editor/widgets/table/table-writeback.js'
];

test('Atomic 8.9 creates all five responsibility-specific Table modules and exposes only the widget factory through the public entry', async () => {
  for (const path of tablePaths) await access(file(path));
  const index = await text('src/features/hybrid-editor/index.js');
  assert.match(index, /from '\.\/widgets\/table\/table-widget\.js'/);
  for (const internal of ['table-view', 'table-cell-editor', 'table-keyboard-navigation', 'table-writeback']) {
    assert.doesNotMatch(index, new RegExp(`widgets/table/${internal}`), internal);
  }
  const module = await import(new URL('../../src/features/hybrid-editor/index.js', import.meta.url));
  assert.equal(typeof module.createTableBlockWidgetType, 'function');
});

test('Atomic 8.9 Table feature graph is browser-direct-safe and receives the frozen model capability only by injection', async () => {
  const sources = await Promise.all(tablePaths.map(path => text(path)));
  const joined = sources.join('\n');
  assert.doesNotMatch(joined, /from '@codemirror\//);
  assert.doesNotMatch(joined, /from ['"][^'"]*(?:model-kernel|document-model|table-model)/);
  assert.doesNotMatch(joined, /window\.|globalThis\.window/);
  assert.match(await text(tablePaths[0]), /createTableBlockWidgetType\(WidgetType, options = \{\}\)/);
  assert.match(await text(tablePaths[0]), /typeof options\.encodeTableCell !== 'function'/);
});

test('Atomic 8.9 separates Table view, cell editor, keyboard navigation and writeback responsibilities', async () => {
  const [widget, view, editor, navigation, writeback] = await Promise.all(tablePaths.map(path => text(path)));
  assert.match(view, /createTableView/);
  assert.match(view, /createTableCellPresentation/);
  assert.doesNotMatch(view, /view\.dispatch|bindOutsidePointerClosure|transitionHybridComponent|encodeTableCell/);
  assert.match(editor, /createTableCellEditor/);
  assert.match(editor, /getTableCellNavigationTarget/);
  assert.match(editor, /writeTableCellValue/);
  assert.match(editor, /__markdownEditorDestroyTableCell/);
  assert.doesNotMatch(editor, /createWidgetToolbar|transitionHybridComponent|view\.dispatch/);
  assert.match(navigation, /event\?\.key === 'Tab'/);
  assert.match(navigation, /event\?\.key === 'Enter'/);
  assert.doesNotMatch(navigation, /view\.dispatch|encodeTableCell|transitionHybridComponent/);
  assert.equal((writeback.match(/view\.dispatch\(/g) || []).length, 1);
  assert.match(writeback, /options\.encodeTableCell/);
  assert.doesNotMatch(writeback, /document\.|createElement|transitionHybridComponent/);
  assert.match(widget, /createTableView/);
  assert.match(widget, /createTableCellEditor/);
  assert.match(widget, /transitionHybridComponent/);
  assert.match(widget, /registerHybridComponentCloser/);
});

test('Atomic 8.9 removes legacy Table authority and composes WidgetType, frozen encoder and history only in the editor controller', async () => {
  const [widgets, controller] = await Promise.all([
    text('src/editor/hybrid/widgets.js'), text('src/editor/hybrid/controller.js')
  ]);
  assert.doesNotMatch(widgets, /class TableBlockWidget|function createEditableTableCellInput|function getTableCellTargetKey|function scheduleTableCellEdit|reportTableCellEditFailure/);
  assert.doesNotMatch(widgets, /encodeTableCell/);
  assert.match(controller, /createTableBlockWidgetType/);
  assert.match(controller, /const TableBlockWidget = createTableBlockWidgetType\(WidgetType/);
  assert.match(controller, /encodeTableCell/);
  assert.match(controller, /createHistoryAnnotation: \(\) => isolateHistory\.of\('full'\)/);
  assert.doesNotMatch(controller, /TableBlockWidget[\s\S]{0,80}from '\.\/widgets\.js'/);
});

test('Atomic 8.9 preserves Session/source/lifecycle ownership and leaves the frozen Table model untouched by the feature graph', async () => {
  const [widget, editor, model] = await Promise.all([
    text(tablePaths[0]), text(tablePaths[2]), text('src/editor/hybrid/table-model.js')
  ]);
  assert.match(widget, /bindWidgetSourceAction/);
  assert.match(widget, /openWidgetSource/);
  assert.match(widget, /attachHybridWidgetLifecycle/);
  assert.match(widget, /section\.__markdownEditorTableBlockCleanup/);
  assert.match(editor, /bindOutsidePointerClosure/);
  assert.match(model, /export function parseTableRow/);
  assert.match(model, /export function encodeTableCell/);
  assert.doesNotMatch(widget + editor, /parseTableRow/);
});

test('Atomic 8.9 Table ownership remains intact after Atomic 8.10 Image migration', async () => {
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  assert.equal(inventory.modules.length, 358);
  const paths = new Set(inventory.modules.map(row => row[0]));
  for (const path of tablePaths) assert.equal(paths.has(path), true, path);
  for (const imagePath of [
    'src/features/hybrid-editor/widgets/image/image-widget.js',
    'src/features/hybrid-editor/widgets/image/image-error-view.js'
  ]) assert.equal(paths.has(imagePath), true, imagePath);
  for (const mathPath of [
    'src/features/hybrid-editor/widgets/math/inline-math-widget.js',
    'src/features/hybrid-editor/widgets/math/block-math-widget.js'
  ]) await assert.rejects(access(file(mathPath)), undefined, mathPath);
});
