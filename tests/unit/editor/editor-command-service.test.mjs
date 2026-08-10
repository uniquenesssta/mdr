import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEditorCommandService,
  mountClassicEditorCommandPort
} from '../../../src/features/editor/index.js';

function createEditorAdapter(initialText = '', initialSelection = { start: 0, end: 0 }) {
  let text = String(initialText);
  let selection = { start: initialSelection.start, end: initialSelection.end };
  const transactions = [];

  const lineBounds = lineNumber => {
    const lines = text.split('\n');
    const safeLine = Math.max(1, Math.min(lines.length, Number(lineNumber) || 1));
    let from = 0;
    for (let index = 1; index < safeLine; index += 1) from += lines[index - 1].length + 1;
    return { from, to: from + lines[safeLine - 1].length };
  };

  const adapter = {
    getSelection() {
      return Object.freeze({
        anchor: selection.start,
        head: selection.end,
        start: Math.min(selection.start, selection.end),
        end: Math.max(selection.start, selection.end),
        direction: selection.start <= selection.end ? 'forward' : 'backward'
      });
    },
    sliceText(from = 0, to = text.length) {
      return text.slice(from, to);
    },
    getLineNumberAtPosition(position) {
      const safe = Math.max(0, Math.min(text.length, Number(position) || 0));
      return text.slice(0, safe).split('\n').length;
    },
    getLineStart(lineNumber) {
      return lineBounds(lineNumber).from;
    },
    getLineEnd(lineNumber) {
      return lineBounds(lineNumber).to;
    },
    replaceRange(insert, from, to = from, selectionMode = 'preserve') {
      const value = String(insert ?? '');
      const start = Math.max(0, Math.min(text.length, Number(from) || 0));
      const end = Math.max(start, Math.min(text.length, Number(to) || 0));
      transactions.push(Object.freeze({ insert: value, from: start, to: end, selectionMode }));
      text = text.slice(0, start) + value + text.slice(end);
      if (selectionMode === 'select') selection = { start, end: start + value.length };
      else if (selectionMode === 'start') selection = { start, end: start };
      else selection = { start: start + value.length, end: start + value.length };
      return Object.freeze({ from: start, to: end, insert: value });
    }
  };

  return {
    adapter,
    transactions,
    get text() { return text; },
    get selection() { return { ...selection }; }
  };
}

test('basic inline formatting commands preserve the existing marker and selection semantics with one editor transaction', () => {
  for (const [method, before, after] of [
    ['bold', '**', '**'],
    ['italic', '*', '*'],
    ['strikethrough', '~~', '~~']
  ]) {
    const editor = createEditorAdapter('xabc', { start: 1, end: 4 });
    const service = createEditorCommandService({ adapter: editor.adapter });
    service[method]();
    assert.equal(editor.text, `x${before}abc${after}`);
    assert.deepEqual(editor.transactions, [{ insert: `${before}abc${after}`, from: 1, to: 4, selectionMode: 'select' }]);
  }
});

test('heading and quote commands preserve current line/selection behavior without UI side effects', () => {
  const headingEditor = createEditorAdapter('alpha\n## beta\nend', { start: 9, end: 9 });
  const heading = createEditorCommandService({ adapter: headingEditor.adapter });
  heading.heading(3);
  assert.equal(headingEditor.text, 'alpha\n### beta\nend');
  assert.deepEqual(headingEditor.transactions, [{ insert: '### beta', from: 6, to: 13, selectionMode: 'end' }]);
  assert.throws(() => heading.heading(0), /heading level/i);
  assert.throws(() => heading.heading(7), /heading level/i);

  const quoteEditor = createEditorAdapter('alpha\nbeta', { start: 0, end: 10 });
  const quote = createEditorCommandService({ adapter: quoteEditor.adapter });
  quote.quote('引用');
  assert.equal(quoteEditor.text, '> alpha\n> beta');
  assert.deepEqual(quoteEditor.transactions, [{ insert: '> alpha\n> beta', from: 0, to: 10, selectionMode: 'select' }]);

  const emptyQuoteEditor = createEditorAdapter('', { start: 0, end: 0 });
  createEditorCommandService({ adapter: emptyQuoteEditor.adapter }).quote('引用');
  assert.equal(emptyQuoteEditor.text, '> 引用');
});

test('list commands preserve legacy line anchoring, prefixes and empty-selection fallback using one transaction', () => {
  for (const [method, prefix] of [
    ['unorderedList', '- '],
    ['orderedList', '1. '],
    ['taskList', '- [ ] ']
  ]) {
    const editor = createEditorAdapter('a\nb', { start: 0, end: 3 });
    const service = createEditorCommandService({ adapter: editor.adapter });
    service[method]('无序');
    assert.equal(editor.text, `${prefix}a\n${prefix}b`);
    assert.equal(editor.transactions.length, 1);
    assert.equal(editor.transactions[0].selectionMode, 'end');
  }

  const anchored = createEditorAdapter('xxa\nb', { start: 2, end: 5 });
  createEditorCommandService({ adapter: anchored.adapter }).unorderedList('无序');
  assert.equal(anchored.text, '- a\n- b', 'migration must preserve the existing first-line anchoring semantics');
  assert.deepEqual(anchored.transactions, [{ insert: '- a\n- b', from: 0, to: 5, selectionMode: 'end' }]);

  const empty = createEditorAdapter('', { start: 0, end: 0 });
  createEditorCommandService({ adapter: empty.adapter }).taskList('无序');
  assert.equal(empty.text, '- [ ] 无序');
});

test('inline/code commands preserve current single-line and multiline insertion behavior with one transaction', () => {
  const inline = createEditorAdapter('abc', { start: 0, end: 3 });
  createEditorCommandService({ adapter: inline.adapter }).inlineCode();
  assert.equal(inline.text, '`abc`');
  assert.deepEqual(inline.transactions, [{ insert: '`abc`', from: 0, to: 3, selectionMode: 'select' }]);

  const single = createEditorAdapter('abc', { start: 0, end: 3 });
  createEditorCommandService({ adapter: single.adapter }).code();
  assert.equal(single.text, '`abc`');
  assert.equal(single.transactions.length, 1);

  const block = createEditorAdapter('a\nb', { start: 0, end: 3 });
  createEditorCommandService({ adapter: block.adapter }).code();
  assert.equal(block.text, '```\na\nb\n```');
  assert.deepEqual(block.transactions, [{ insert: '```\na\nb\n```', from: 0, to: 3, selectionMode: 'select' }]);
});

test('Editor Command Service validates its neutral adapter, propagates editor errors and has an independent terminal lifecycle', () => {
  assert.throws(() => createEditorCommandService(), /adapter/i);
  assert.throws(() => createEditorCommandService({ adapter: { getSelection() {} } }), /sliceText|line|replaceRange/i);

  const expected = new Error('replace failed');
  const editor = createEditorAdapter('abc', { start: 0, end: 3 });
  editor.adapter.replaceRange = () => { throw expected; };
  const service = createEditorCommandService({ adapter: editor.adapter });
  assert.throws(() => service.bold(), error => error === expected);

  const healthy = createEditorCommandService({ adapter: createEditorAdapter('abc', { start: 0, end: 3 }).adapter });
  healthy.destroy();
  healthy.destroy();
  assert.throws(() => healthy.bold(), /destroyed/i);
});

test('classic Editor Command port is scoped, stateless and forwards only the Atomic 5.10 command surface', () => {
  const editor = createEditorAdapter('abc', { start: 0, end: 3 });
  const service = createEditorCommandService({ adapter: editor.adapter });
  const host = {};
  const port = mountClassicEditorCommandPort(host, service);

  assert.equal(host.markdownEditorEditorCommandPort, port);
  assert.deepEqual(Object.keys(port).sort(), [
    'bold', 'code', 'destroy', 'heading', 'inlineCode', 'italic', 'orderedList', 'quote', 'strikethrough', 'taskList', 'unorderedList'
  ]);
  port.bold();
  assert.equal(editor.text, '**abc**');
  assert.throws(() => mountClassicEditorCommandPort(host, service), /already mounted/i);

  port.destroy();
  port.destroy();
  assert.equal(host.markdownEditorEditorCommandPort, undefined);
  assert.throws(() => port.italic(), /destroyed/i);

  service.destroy();
});
