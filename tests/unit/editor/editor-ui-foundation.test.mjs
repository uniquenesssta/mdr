import test from 'node:test';
import assert from 'node:assert/strict';

import { createEditorSelectionService } from '../../../src/features/editor/application/editor-selection-service.js';
import { createEditorFocusService } from '../../../src/features/editor/application/editor-focus-service.js';
import { createInlineFormatCommands } from '../../../src/features/editor/commands/inline-format-commands.js';
import { createLinkCommand } from '../../../src/features/editor/commands/link-command.js';
import { createImageCommand } from '../../../src/features/editor/commands/image-command.js';
import { createTableCommand } from '../../../src/features/editor/commands/table-command.js';
import { createMathCommand } from '../../../src/features/editor/commands/math-command.js';
import { createMermaidCommand } from '../../../src/features/editor/commands/mermaid-command.js';
import { mountClassicEditorUiCommandPort } from '../../../src/features/editor/compatibility/classic-editor-ui-command-port.js';

function createAdapter(initial = 'hello world') {
  let text = initial;
  let selection = { anchor: 0, head: 0, start: 0, end: 0, direction: 'forward' };
  let focused = false;
  const calls = [];
  const normalizeSelection = value => {
    const anchor = Number(value.anchor) || 0;
    const head = Number(value.head ?? anchor) || anchor;
    return { anchor, head, start: Math.min(anchor, head), end: Math.max(anchor, head), direction: anchor <= head ? 'forward' : 'backward' };
  };
  const apply = (from, to, insert, nextSelection) => {
    text = text.slice(0, from) + insert + text.slice(to);
    if (nextSelection) selection = normalizeSelection(nextSelection);
  };
  return {
    calls,
    get text() { return text; },
    api: {
      getSelection() { return Object.freeze({ ...selection }); },
      sliceText(from, to) { return text.slice(from, to); },
      getTextLength() { return text.length; },
      setSelection(anchor, head = anchor) { selection = normalizeSelection({ anchor, head }); calls.push(['selection', anchor, head]); return Object.freeze({ ...selection }); },
      replaceRange(insert, from, to, mode) {
        calls.push(['replaceRange', insert, from, to, mode]);
        let next = { anchor: from + insert.length };
        if (mode === 'select') next = { anchor: from, head: from + insert.length };
        if (mode === 'start') next = { anchor: from };
        apply(from, to, insert, next);
        return { from, to, insert };
      },
      applyTransaction(spec) {
        calls.push(['applyTransaction', spec]);
        const change = spec.changes;
        apply(change.from, change.to, change.insert, spec.selection || selection);
        return true;
      },
      focus(options) { focused = true; calls.push(['focus', options]); },
      blur() { focused = false; calls.push(['blur']); },
      hasFocus() { return focused; }
    }
  };
}

test('Atomic 5.12 Selection and Focus services expose neutral state and terminal lifecycle only', () => {
  const fixture = createAdapter('abcdef');
  fixture.api.setSelection(1, 4);
  const selection = createEditorSelectionService({ adapter: fixture.api });
  const focus = createEditorFocusService({ adapter: fixture.api });
  const snapshot = selection.snapshot();
  assert.equal(snapshot.start, 1);
  assert.equal(snapshot.end, 4);
  assert.equal(snapshot.documentLength, 6);
  assert.equal(selection.selectedText(snapshot), 'bcd');
  selection.restore({ anchor: 5, head: 2 });
  assert.deepEqual(fixture.api.getSelection(), { anchor: 5, head: 2, start: 2, end: 5, direction: 'backward' });
  focus.focus({ preventScroll: true });
  assert.equal(focus.hasFocus(), true);
  focus.blur();
  assert.equal(focus.hasFocus(), false);
  selection.destroy();
  selection.destroy();
  focus.destroy();
  focus.destroy();
  assert.throws(() => selection.snapshot(), /destroyed/);
  assert.throws(() => focus.focus(), /destroyed/);
});

test('Atomic 5.12 link, image, table and Mermaid commands each submit exactly one replacement transaction', () => {
  const linkFixture = createAdapter('label');
  linkFixture.api.setSelection(0, 5);
  createLinkCommand(linkFixture.api).insert('https://example.test');
  assert.equal(linkFixture.text, '[label](https://example.test)');
  assert.equal(linkFixture.calls.filter(call => call[0] === 'replaceRange').length, 1);

  const imageFixture = createAdapter('');
  createImageCommand(imageFixture.api).insert('data:image/png;base64,abc', { alt: 'a]b' });
  assert.equal(imageFixture.text, '![a\\]b](data:image/png;base64,abc)');
  assert.equal(imageFixture.calls.filter(call => call[0] === 'replaceRange').length, 1);

  const tableFixture = createAdapter('x');
  tableFixture.api.setSelection(1, 1);
  createTableCommand(tableFixture.api).insert(3, 2);
  assert.match(tableFixture.text, /\| 列1 \| 列2 \|/);
  assert.equal(tableFixture.calls.filter(call => call[0] === 'replaceRange').length, 1);

  const mermaidFixture = createAdapter('');
  createMermaidCommand(mermaidFixture.api).insert('flowchart TD\nA --> B');
  assert.equal(mermaidFixture.calls.filter(call => call[0] === 'replaceRange').length, 1);
  assert.match(mermaidFixture.text, /```mermaid/);
});

test('Atomic 5.12 math commands preserve legacy defaults and selection in one applyTransaction', () => {
  const inlineFixture = createAdapter('');
  const math = createMathCommand(inlineFixture.api);
  math.inline();
  assert.equal(inlineFixture.text, '$E = mc^2$');
  assert.equal(inlineFixture.calls.filter(call => call[0] === 'applyTransaction').length, 1);
  assert.equal(inlineFixture.calls.filter(call => call[0] === 'replaceRange').length, 0);

  const blockFixture = createAdapter('beforeafter');
  blockFixture.api.setSelection(6, 6);
  createMathCommand(blockFixture.api).block();
  assert.match(blockFixture.text, /before\n\$\$\n\\int_\{a\}\^\{b\} f\(x\)\\,dx\n\$\$\nafter/);
  assert.equal(blockFixture.calls.filter(call => call[0] === 'applyTransaction').length, 1);
});

test('Atomic 5.12 inline format commands include underline/scripts and bounded inline-color transaction semantics', () => {
  const fixture = createAdapter('color');
  fixture.api.setSelection(0, 5);
  const inline = createInlineFormatCommands(fixture.api);
  inline.underline();
  assert.equal(fixture.text, '<u>color</u>');

  const colorFixture = createAdapter('color');
  colorFixture.api.setSelection(0, 5);
  const colors = createInlineFormatCommands(colorFixture.api);
  const result = colors.setColor('text', '#2563eb');
  assert.equal(result.applied, true);
  assert.equal(colorFixture.text, '<span style="color:#2563eb">color</span>');
  assert.equal(colorFixture.calls.filter(call => call[0] === 'applyTransaction').length, 1);
  const clear = colors.clearColor('text', { selection: result.selection });
  assert.equal(clear.applied, true);
  assert.equal(colorFixture.text, 'color');
});

test('Atomic 5.12 scoped Editor UI compatibility command port rejects duplicate authority and cleans host lifecycle', () => {
  const host = {};
  const port = mountClassicEditorUiCommandPort(host);
  const calls = [];
  const unregister = port.register({ layout: mode => calls.push(mode) });
  assert.equal(port.has('layout'), true);
  port.invoke('layout', 'hybrid');
  assert.deepEqual(calls, ['hybrid']);
  assert.throws(() => port.register({ layout() {} }), /already registered/);
  unregister();
  assert.equal(port.has('layout'), false);
  assert.throws(() => port.invoke('layout'), /unavailable/);
  port.destroy();
  port.destroy();
  assert.equal(host.markdownEditorEditorUiCommandPort, undefined);
  assert.throws(() => port.has('layout'), /destroyed/);
});
