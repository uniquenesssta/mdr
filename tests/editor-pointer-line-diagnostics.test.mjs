import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { createPointerLineDiagnostics } from '../src/features/editor/infrastructure/pointer-selection/precise-pointer-selection.js';
import { redactTelemetryDetails } from '../src/features/telemetry/index.js';
import { readPointerLineContext } from '../src/features/editor/infrastructure/pointer-selection/caret-boundary-reader.js';

function harness() {
  const records = [];
  const view = { state: EditorState.create({ doc: 'table last row\n\nnext line', selection: { anchor: 14 } }),
    coordsAtPos: () => ({ top: 190, bottom: 210, left: 100, right: 100 }),
    dom: { classList: { contains: () => true } } };
  const tracker = createPointerLineDiagnostics(view, (operation, options) => records.push({ operation, ...options }));
  const context = { pointerX: 100, pointerY: 200, renderedRow: 3, mappedLine: 1,
    expectedLine: 2, expectedPosition: 15, trailingBlockBoundary: true, tableBoundary: true,
    targetTop: 190, targetBottom: 210 };
  const down = { button: 0, clientX: 100, clientY: 200 };
  function change(spec) {
    const startState = view.state;
    const transaction = startState.update(spec);
    view.state = transaction.state;
    tracker.update({ startState, state: view.state, transactions: [transaction], changes: transaction.changes,
      docChanged: transaction.docChanged, selectionSet: Boolean(spec.selection) });
  }
  return { records, view, tracker, context, down, change };
}

test('pointer line check exposes the table trailing row mapping without relabeling it as the clicked next line', () => {
  const h = harness();
  h.tracker.pointerDown(h.down, h.context);
  h.tracker.pointerUp(h.down);
  assert.equal(h.records[0].operation, 'editor.pointer-line-check');
  assert.equal(h.records[0].status, 'warning');
  assert.equal(h.records[0].details.mappedLine, 1);
  assert.equal(h.records[0].details.expectedLine, 2);
  assert.equal(h.records[0].details.caretLine, 1);
  assert.equal(h.records[0].details.lineMismatch, true);
  assert.equal(h.records[0].details.tableBoundary, true);
});

test('one pointer gesture emits one click check even when a later widget mouseup bubbles into the editor', () => {
  const h = harness();
  h.tracker.pointerDown(h.down, h.context);
  h.tracker.pointerUp(h.down);
  h.tracker.pointerUp(h.down);
  assert.equal(h.records.length, 1);
});

test('layout reflow is measured on the same source row while wrong rows and displaced carets still warn', () => {
  for (const defect of ['none', 'wrong-row', 'displaced-caret']) {
    const h = harness();
    h.change({ selection: { anchor: 15 } });
    const original = { ...h.context, targetTop: 190, targetBottom: 230 };
    const moved = { left: 0, right: 600, top: 300, bottom: 320, height: 20 };
    class LineElement { getBoundingClientRect() { return moved; } }
    const element = new LineElement();
    h.view.dom.ownerDocument = { defaultView: { Element: LineElement } };
    h.view.contentDOM = { contains: node => node === element, querySelectorAll: () => [element] };
    h.view.posAtDOM = () => 15;
    h.view.coordsAtPos = () => defect === 'displaced-caret'
      ? { left: 100, right: 100, top: 360, bottom: 380 } : { left: 100, right: 100, top: 300, bottom: 320 };
    h.tracker.pointerDown(h.down, original);
    if (defect === 'wrong-row') h.change({ selection: { anchor: 16 } });
    h.tracker.pointerUp(h.down);
    const entry = h.records[0];
    assert.equal(entry.details.layoutChanged, true);
    assert.equal(entry.details.verticalErrorPx, defect === 'displaced-caret' ? 160 : 100);
    assert.equal(entry.status, defect === 'none' ? 'ok' : 'warning');
    assert.equal(entry.details.lineMismatch, defect === 'wrong-row');
    assert.equal(entry.details.geometryMismatch, defect === 'displaced-caret');
  }
});

test('input line check correlates actual insertion into the table with the original click', () => {
  const h = harness();
  h.tracker.pointerDown(h.down, h.context);
  h.tracker.pointerUp(h.down);
  h.change({ changes: { from: 14, insert: '秘密正文' }, selection: { anchor: 18 }, userEvent: 'input.type.compose' });
  const input = h.records[1];
  assert.equal(input.operation, 'editor.input-line-check');
  assert.equal(input.status, 'warning');
  assert.equal(input.details.clickId, h.records[0].details.clickId);
  assert.equal(input.details.inputStartLine, 1);
  assert.equal(input.details.expectedInputLine, 2);
  assert.equal(JSON.stringify(h.records).includes('秘密正文'), false);
  assert.deepEqual({ ...redactTelemetryDetails(input.details) }, input.details);
});

test('rendered empty table boundary reports both the hidden last source row and the following real line', () => {
  const state = EditorState.create({ doc: '| last |\n\nnext' });
  const rect = { top: 100, bottom: 120, height: 20 };
  class LineElement {
    textContent = '';
    previousElementSibling = { matches: () => true, childNodes: [], dataset: { hybridBlockType: 'table' } };
    closest(selector) { return selector === '.cm-line' ? this : null; }
    getBoundingClientRect() { return rect; }
  }
  const element = new LineElement();
  const view = { state,
    dom: { ownerDocument: { defaultView: { Element: LineElement }, elementsFromPoint: () => [element] } },
    contentDOM: { contains: value => value === element, querySelectorAll: () => [element] },
    scrollDOM: { getBoundingClientRect: () => ({ top: 0, bottom: 200 }) },
    posAtDOM: () => state.doc.line(1).to };
  view.lineBlockAt = () => ({ type: [{ widget: {}, to: state.doc.line(1).to }] });
  const context = readPointerLineContext(view, { target: element, clientX: 50, clientY: 110 });
  assert.equal(context.mappedLine, 1);
  assert.equal(context.expectedLine, 2);
  assert.equal(context.expectedPosition, state.doc.line(2).from);
  assert.equal(context.renderedRow, 1);
  assert.equal(context.tableBoundary, true);
  view.posAtDOM = node => node === element ? state.doc.line(2).from : state.doc.line(1).to;
  const blank = readPointerLineContext(view, { target: element, clientX: 50, clientY: 110 });
  assert.equal(blank.mappedLine, 2);
  assert.equal(blank.expectedLine, 2);
  assert.equal(blank.tableBoundary, false);
});

test('correct click and multiline input preserve correlation as the expected position moves', () => {
  const h = harness();
  h.view.state = EditorState.create({ doc: 'table last row\n\nnext line', selection: { anchor: 15 } });
  h.tracker.pointerDown(h.down, h.context);
  h.tracker.pointerUp(h.down);
  h.change({ changes: { from: 15, insert: 'a\nb' }, selection: { anchor: 18 }, userEvent: 'input.paste' });
  h.change({ changes: { from: 18, insert: 'c' }, selection: { anchor: 19 }, userEvent: 'input.type' });
  assert.deepEqual(h.records.map(record => record.status), ['ok', 'ok', 'ok']);
  assert.equal(h.records[1].details.expectedInputLine, 2);
  assert.equal(h.records[2].details.expectedInputLine, 3);
  assert.equal(h.records[2].details.inputStartLine, 3);
});

test('typing a newline in the middle of a clicked line follows the insertion rather than the old line start', () => {
  const h = harness();
  h.view.state = EditorState.create({ doc: 'first line\nsecond', selection: { anchor: 5 } });
  h.tracker.pointerDown(h.down, { ...h.context, expectedLine: 1, expectedPosition: 0 });
  h.tracker.pointerUp(h.down);
  h.change({ changes: { from: 5, insert: '\n' }, selection: { anchor: 6 }, userEvent: 'input' });
  h.change({ changes: { from: 6, insert: 'x' }, selection: { anchor: 7 }, userEvent: 'input.type' });
  assert.deepEqual(h.records.map(record => record.status), ['ok', 'ok', 'ok']);
  assert.equal(h.records[2].details.expectedInputLine, 2);
});

test('click check also detects different rendered rows inside the same wrapped source line', () => {
  const h = harness();
  h.view.coordsAtPos = () => ({ top: 250, bottom: 270, left: 100, right: 101 });
  h.tracker.pointerDown(h.down, { ...h.context, expectedLine: 1 });
  h.tracker.pointerUp(h.down);
  assert.equal(h.records[0].details.lineMismatch, false);
  assert.equal(h.records[0].details.geometryMismatch, true);
  assert.equal(h.records[0].details.verticalErrorPx, 50);
  assert.equal(h.records[0].status, 'warning');
});

test('missing caret geometry is a warning even when both source line numbers happen to agree', () => {
  const h = harness();
  h.view.coordsAtPos = () => null;
  h.tracker.pointerDown(h.down, { ...h.context, expectedLine: 1 });
  h.tracker.pointerUp(h.down);
  assert.equal(h.records[0].details.lineMismatch, false);
  assert.equal(h.records[0].details.geometryUnavailable, true);
  assert.equal(h.records[0].status, 'warning');
});

test('source exit normalization records the selected editable line as the pointer intent', () => {
  const h = harness();
  h.tracker.pointerDown(h.down, { ...h.context, expectedLine: 1 });
  h.change({ selection: { anchor: 15 }, userEvent: 'select.pointer.normalized' });
  h.tracker.pointerUp(h.down);
  assert.equal(h.records[0].details.selectionNormalized, true);
  assert.equal(h.records[0].details.expectedLine, 2);
  assert.equal(h.records[0].status, 'ok');
  h.change({ changes: { from: 15, insert: 'English' }, selection: { anchor: 22 }, userEvent: 'input.type' });
  assert.equal(h.records[1].details.lineMismatch, false);
});

test('keyboard navigation and later selection changes discard the old click intent', () => {
  for (const navigation of ['ArrowDown', 'Home', 'PageUp', 'selection']) {
    const h = harness();
    h.tracker.pointerDown(h.down, h.context);
    h.tracker.pointerUp(h.down);
    if (navigation === 'selection') h.change({ selection: { anchor: 16 } });
    else h.tracker.keyDown({ key: navigation });
    h.change({ changes: { from: 16, insert: 'x' }, userEvent: 'input.type' });
    assert.equal(h.records.length, 1, navigation);
  }
});

test('drag and word selections are recorded without falsely treating replacement input as a wrong single-line click', () => {
  for (const range of [false, true]) {
    const h = harness();
    if (range) h.view.state = EditorState.create({ doc: 'table last row\n\nnext line', selection: { anchor: 0, head: 14 } });
    h.tracker.pointerDown(h.down, h.context);
    h.tracker.pointerUp({ ...h.down, clientX: range ? 100 : 120 });
    assert.equal(h.records[0].details.lineMismatch, false);
    h.change({ changes: { from: 0, to: 14, insert: 'x' }, userEvent: 'input.type' });
    assert.equal(h.records.length, 1);
  }
});

test('each click receives a new correlation id and destroyed/right-click sessions record nothing', () => {
  const h = harness();
  for (let i = 0; i < 2; i++) { h.tracker.pointerDown(h.down, h.context); h.tracker.pointerUp(h.down); }
  assert.deepEqual(h.records.map(record => record.details.clickId), [1, 2]);
  h.tracker.pointerDown({ ...h.down, button: 2 }, h.context);
  h.tracker.pointerUp(h.down);
  h.tracker.destroy();
  h.tracker.pointerDown(h.down, h.context);
  h.tracker.pointerUp(h.down);
  h.change({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' });
  assert.equal(h.records.length, 2);
});
