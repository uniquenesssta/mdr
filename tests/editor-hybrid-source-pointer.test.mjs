import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { history, undo, redo, undoDepth } from '@codemirror/commands';
import { createCodeMirrorSourceEditorPort } from '../src/features/editor/infrastructure/codemirror-source-editor-port.js';
import { completeHybridParagraphComposition, hybridParagraphInputExtension } from '../src/features/editor/infrastructure/pointer-selection/precise-pointer-selection.js';

const table = '| a | b |\n| - | - |\n| c | d |';
function harness(doc) {
  const transactions = [];
  const view = { state: EditorState.create({ doc, extensions: [markdown(), hybridParagraphInputExtension, history()] }), dispatch(spec) {
    const transaction = spec.startState === this.state ? spec : this.state.update(spec); transactions.push(transaction); this.state = transaction.state;
  } };
  view.dispatch = view.dispatch.bind(view);
  return { view, transactions, port: createCodeMirrorSourceEditorPort(view) };
}

function type(h, text, userEvent = 'input.type') {
  const from = h.view.state.selection.main.head;
  h.view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length }, userEvent });
}

test('closing table source skips its separator and selects the following editable paragraph', () => {
  const source = table + '\n\nafter table';
  const h = harness(source);
  assert.equal(h.port.setSelection(table.length + 1, { sourceRange: { componentType: 'table', to: table.length } }), table.length + 2);
  assert.equal(h.view.state.doc.toString(), source);
  assert.equal(h.view.state.selection.main.head, source.indexOf('after table'));
  assert.equal(h.transactions[0].isUserEvent('select.pointer.normalized'), true);
});

test('closing table source at EOF changes no text until input creates the append paragraph', () => {
  const h = harness(table + '\n');
  assert.equal(h.port.setSelection(table.length + 1, { sourceRange: { componentType: 'table', to: table.length } }), table.length + 1);
  assert.equal(h.view.state.doc.toString(), table + '\n');
  assert.equal(undoDepth(h.view.state), 0);
  type(h, 'English');
  assert.equal(h.view.state.doc.toString(), table + '\n\nEnglish');
  assert.equal(h.view.state.doc.lineAt(h.view.state.selection.main.head).number, 5);
});

test('ordinary and code source selections retain their exact target and never append table separators', () => {
  const h = harness(table + '\n\nafter table');
  assert.equal(h.port.setSelection(3), 3);
  assert.equal(h.port.setSelection(table.length + 1, { sourceRange: { componentType: 'code', to: table.length } }), table.length + 1);
  assert.equal(h.view.state.doc.toString(), table + '\n\nafter table');
  assert.equal(h.transactions.every(transaction => !transaction.docChanged), true);
  h.port.destroy();
  assert.throws(() => h.port.setSelection(3), /destroyed/);
});

test('a read-only source exit never creates a paragraph or changes the document', () => {
  const h = harness(table + '\n');
  h.view.state = EditorState.create({ doc: table + '\n', extensions: [EditorState.readOnly.of(true)] });
  assert.equal(h.port.setSelection(table.length + 1, { sourceRange: { componentType: 'table', to: table.length } }), table.length + 1);
  assert.equal(h.view.state.doc.toString(), table + '\n');
  assert.equal(h.transactions[0].docChanged, false);
});

test('a clicked separator stages an independent paragraph without changing the document', () => {
  for (const [prefix, componentType] of [['> quoted text', 'quote'], ['- list item', 'list'],
    ['![image](test.png)', 'image'], ['$$\nx+y\n$$', 'math'], ['<div>raw</div>', 'html']]) {
    const source = prefix + '\n\nnext block';
    const h = harness(source);
    h.view.dom = { classList: { contains: name => name === 'cm-hybrid-mode' } };
    assert.equal(h.port.setSelection(prefix.length + 1, { sourceRange: { componentType, to: prefix.length } }), prefix.length + 1, prefix);
    assert.equal(h.view.state.doc.toString(), source);
    assert.equal(h.transactions[0].docChanged, false);
    assert.equal(h.transactions[0].isUserEvent('select.pointer.normalized'), true);
    type(h, 'English');
    assert.equal(h.view.state.doc.toString(), prefix + '\n\nEnglish\n\nnext block', prefix);
  }
});

test('independent blank rows, source mode and read-only selections never insert separators', () => {
  for (const [hybrid, readOnly, source, position] of [
    [true, false, '> quote\n\n\nnext', 9],
    [false, false, '> quote\n\nnext', 8],
    [true, true, '> quote\n\nnext', 8]
  ]) {
    const h = harness(source);
    h.view.state = EditorState.create({ doc: source, extensions: [markdown(), EditorState.readOnly.of(readOnly)] });
    h.view.dom = { classList: { contains: () => hybrid } };
    h.port.setSelection(position);
    assert.equal(h.view.state.doc.toString(), source);
  }
});

test('repeated separator clicks reuse the same paragraph without growing the document', () => {
  for (const prefix of ['> first\n> second', '- list item', '![image](test.png)', '<div>html</div>']) {
   for (const separator of ['\n\n', '\n\n\n']) {
    const source = prefix + separator + 'next';
    const h = harness(source);
    h.view.dom = { classList: { contains: () => true } };
    h.port.setSelection(prefix.length + 1);
    const expected = h.view.state.doc.toString(), anchor = h.view.state.selection.main.head;
    assert.equal(expected, source, 'A first click must not create whitespace');
    for (let i = 0; i < 10; i += 1) {
      assert.equal(h.port.setSelection(prefix.length + 1), anchor);
      assert.equal(h.view.state.doc.toString(), expected, prefix);
      assert.equal(h.transactions.at(-1).docChanged, false);
      assert.equal(h.transactions.at(-1).isUserEvent('select.pointer.normalized'), true);
    }
    type(h, '你', 'input.type.compose');
    completeHybridParagraphComposition(h.view);
    assert.equal(h.view.state.doc.toString(), prefix + '\n\n你\n\nnext');
   }
  }
});

test('source-end exit stages missing separators and writes them together with the next input', () => {
  for (const [componentType, prefix, needed] of [['code', '```\ncode\n```', 1],
    ['math', '$$\nx+y\n$$', 2], ['html', '<div>html</div>', 2], ['table', table, 2]]) {
    for (const suffix of ['', '\n', '\n\n']) {
      const h = harness(prefix + suffix);
      const position = h.port.setSelection(h.view.state.doc.length, {
        sourceRange: { componentType, to: h.view.state.doc.length }, appendAfterSource: true
      });
      assert.equal(h.view.state.doc.toString(), prefix + suffix);
      assert.equal(position, h.view.state.doc.length);
      assert.equal(h.transactions[0].docChanged, false);
      type(h, 'text', 'input.paste');
      assert.equal(h.view.state.doc.toString(), prefix + '\n'.repeat(Math.max(needed, suffix.length)) + 'text');
    }
  }
});

test('paragraph separators share input undo/redo and clicks never reinsert text after undo', () => {
  const source = '<div>HTML</div>\n\n---\n\n## Heading', h = harness(source);
  h.view.dom = { classList: { contains: () => true } };
  h.port.setSelection(source.indexOf('\n') + 1);
  assert.equal(undoDepth(h.view.state), 0);
  type(h, 'text');
  const inserted = h.view.state.doc.toString();
  assert.equal(undoDepth(h.view.state), 1);
  assert.equal(undo(h.view), true);
  assert.equal(h.view.state.doc.toString(), source);
  h.port.setSelection(source.indexOf('\n') + 1);
  h.port.setSelection(source.indexOf('\n') + 1);
  assert.equal(h.view.state.doc.toString(), source);
  assert.equal(undoDepth(h.view.state), 0);
  assert.equal(redo(h.view), true);
  assert.equal(h.view.state.doc.toString(), inserted);
});

test('moving to another line cancels a staged paragraph and programmatic changes do not materialize it', () => {
  const source = '> quote\n\nafter', h = harness(source);
  h.view.dom = { classList: { contains: () => true } };
  h.port.setSelection(8);
  h.view.dispatch({ selection: { anchor: source.length } });
  type(h, 'X');
  assert.equal(h.view.state.doc.toString(), source + 'X');
  const other = harness(source);
  other.view.dom = h.view.dom;
  other.port.setSelection(8);
  other.view.dispatch({ changes: { from: 8, insert: 'Z' } });
  assert.equal(other.view.state.doc.toString(), '> quote\nZ\nafter');
});

test('cancelled IME leaves no paragraph separators and composition completion shares input history', () => {
  const source = '> quote\n\nafter', h = harness(source);
  h.view.dom = { classList: { contains: () => true } };
  h.port.setSelection(8);
  type(h, 'n', 'input.type.compose.start');
  assert.equal(h.view.state.doc.toString(), '> quote\nn\nafter');
  h.view.dispatch({ changes: { from: 8, to: 9, insert: '' }, selection: { anchor: 8 }, userEvent: 'input.type.compose' });
  assert.equal(completeHybridParagraphComposition(h.view), false);
  assert.equal(h.view.state.doc.toString(), source);
  h.port.setSelection(8);
  type(h, '你', 'input.type.compose.start');
  assert.equal(completeHybridParagraphComposition(h.view), true);
  assert.equal(h.view.state.doc.toString(), '> quote\n\n你\n\nafter');
  assert.equal(undo(h.view), true);
  assert.equal(h.view.state.doc.toString(), source);
});

test('source exit uses the clicked DOM line when the generic coordinate estimate points at the next line', () => {
  const h = harness('source\n\n---\n\n## Heading\n\nafter');
  const state = h.view.state, target = state.doc.line(4);
  const rect = { left: 0, right: 600, top: 100, bottom: 120, height: 20 };
  class LineElement {
    textContent = '';
    closest(selector) { return selector === '.cm-line' ? this : null; }
    getBoundingClientRect() { return rect; }
  }
  const element = new LineElement();
  Object.assign(h.view, {
    dom: { ownerDocument: { defaultView: { Element: LineElement }, elementsFromPoint: () => [element] } },
    contentDOM: { contains: value => value === element },
    posAtDOM: () => target.from,
    posAtCoords: () => state.doc.line(5).from,
    posAndSideAtCoords: () => ({ pos: state.doc.line(5).from, assoc: 1 }),
    coordsAtPos: () => rect,
    defaultLineHeight: 20
  });
  assert.equal(h.port.positionAtCoordinates({ x: 40, y: 110 }), target.from);
  assert.equal(h.view.state.doc.toString(), state.doc.toString());
});
