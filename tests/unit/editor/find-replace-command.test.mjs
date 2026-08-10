import test from 'node:test';
import assert from 'node:assert/strict';
import { createFindReplaceCommand } from '../../../src/features/editor/commands/find-replace-command.js';

function createSearchAdapter(initialText = '', initialSelection = { start: 0, end: 0 }) {
  let text = String(initialText);
  let selection = { start: initialSelection.start, end: initialSelection.end };
  const findCalls = [];
  const sliceCalls = [];
  const replaceRangeCalls = [];
  const replaceAllCalls = [];

  const normalizeSelection = () => ({
    anchor: selection.start,
    head: selection.end,
    start: Math.min(selection.start, selection.end),
    end: Math.max(selection.start, selection.end),
    direction: selection.start <= selection.end ? 'forward' : 'backward'
  });

  const adapter = {
    getTextLength() { return text.length; },
    getSelection() { return Object.freeze(normalizeSelection()); },
    setSelection(anchor, head = anchor) {
      selection = { start: Number(anchor) || 0, end: Number(head) || 0 };
      return Object.freeze(normalizeSelection());
    },
    sliceText(from = 0, to = text.length) {
      sliceCalls.push({ from, to });
      return text.slice(from, to);
    },
    findText(query, from = 0, options = {}) {
      const needle = String(query ?? '');
      findCalls.push({ query: needle, from, wrap: options.wrap !== false });
      if (!needle) return null;
      let index = text.indexOf(needle, from);
      if (index < 0 && options.wrap !== false && from > 0) index = text.indexOf(needle, 0);
      return index < 0 ? null : Object.freeze({ from: index, to: index + needle.length });
    },
    replaceRange(replacement, from, to = from, selectionMode = 'preserve') {
      const insert = String(replacement ?? '');
      replaceRangeCalls.push({ replacement: insert, from, to, selectionMode });
      text = text.slice(0, from) + insert + text.slice(to);
      const cursor = from + insert.length;
      selection = selectionMode === 'select'
        ? { start: from, end: cursor }
        : { start: cursor, end: cursor };
      return Object.freeze({ from, to, insert });
    },
    replaceAllText(query, replacement) {
      const needle = String(query ?? '');
      const insert = String(replacement ?? '');
      replaceAllCalls.push({ query: needle, replacement: insert });
      if (!needle) return 0;
      const parts = text.split(needle);
      const count = Math.max(0, parts.length - 1);
      if (count) text = parts.join(insert);
      return count;
    }
  };

  return {
    adapter,
    findCalls,
    sliceCalls,
    replaceRangeCalls,
    replaceAllCalls,
    setSelection(start, end = start) { selection = { start, end }; },
    get text() { return text; }
  };
}

test('find next advances and wraps through the adapter search boundary without copying the document', async () => {
  const editor = createSearchAdapter('alpha beta alpha');
  const command = createFindReplaceCommand(editor.adapter);

  assert.deepEqual(await command.findNext('alpha'), { from: 0, to: 5 });
  assert.deepEqual(await command.findNext('alpha'), { from: 11, to: 16 });
  assert.deepEqual(await command.findNext('alpha'), { from: 0, to: 5 });
  assert.deepEqual(editor.findCalls.map(call => call.from), [0, 5, 16]);
  assert.equal(editor.sliceCalls.length, 0, 'search must not materialize the full document through sliceText');
});

test('native large-document search is an optional request-tagged port and local search is used only when that port fails', async () => {
  const editor = createSearchAdapter('alpha beta alpha');
  const command = createFindReplaceCommand(editor.adapter);
  const nativeCalls = [];
  const nativeErrors = [];

  const nativeMatch = await command.findNext('alpha', {
    nativeSearch: async request => {
      nativeCalls.push(request);
      return { from: 11, to: 16 };
    },
    onNativeSearchError(error) { nativeErrors.push(error); }
  });
  assert.deepEqual(nativeMatch, { from: 11, to: 16 });
  assert.deepEqual(nativeCalls, [{ query: 'alpha', from: 0, wrap: true, requestId: 1 }]);
  assert.equal(editor.findCalls.length, 0, 'successful native search must not duplicate the scan locally');

  const expected = new Error('native unavailable');
  const localMatch = await command.findNext('alpha', {
    nativeSearch: async () => { throw expected; },
    onNativeSearchError(error) { nativeErrors.push(error); }
  });
  assert.deepEqual(localMatch, { from: 0, to: 5 });
  assert.equal(nativeErrors.at(-1), expected);
  assert.deepEqual(editor.findCalls.at(-1), { query: 'alpha', from: 16, wrap: true });
});

test('later operations invalidate stale native search completions before they can advance the shared cursor', async () => {
  const editor = createSearchAdapter('alpha beta alpha');
  const command = createFindReplaceCommand(editor.adapter);
  let resolveFirst;
  const first = command.findNext('alpha', {
    nativeSearch: () => new Promise(resolve => { resolveFirst = resolve; })
  });

  const second = command.findNext('beta');
  assert.deepEqual(await second, { from: 6, to: 10 });
  resolveFirst({ from: 11, to: 16 });
  assert.equal(await first, undefined, 'stale native completion must be discarded');

  assert.deepEqual(await command.findNext('alpha'), { from: 11, to: 16 }, 'cursor must remain owned by the latest completed operation');
});

test('replace one reads only the selected range, submits one replacement transaction and returns the next match', async () => {
  const editor = createSearchAdapter('alpha alpha', { start: 0, end: 5 });
  const command = createFindReplaceCommand(editor.adapter);

  const result = await command.replaceOne('alpha', 'A');
  assert.deepEqual(result, { replaced: true, match: { from: 2, to: 7 } });
  assert.equal(editor.text, 'A alpha');
  assert.deepEqual(editor.sliceCalls, [{ from: 0, to: 5 }]);
  assert.deepEqual(editor.replaceRangeCalls, [{ replacement: 'A', from: 0, to: 5, selectionMode: 'end' }]);

  editor.setSelection(0, 1);
  const noReplace = await command.replaceOne('alpha', 'B');
  assert.equal(noReplace.replaced, false);
  assert.equal(editor.replaceRangeCalls.length, 1, 'a non-matching selection must not mutate text');
});

test('replace all delegates one bulk transaction, invalidates pending searches and never reads the full document in command code', async () => {
  const editor = createSearchAdapter('x alpha alpha y');
  const command = createFindReplaceCommand(editor.adapter);
  let resolvePending;
  const pending = command.findNext('alpha', {
    nativeSearch: () => new Promise(resolve => { resolvePending = resolve; })
  });

  assert.equal(command.replaceAll('alpha', 'A'), 2);
  resolvePending({ from: 2, to: 7 });
  assert.equal(await pending, undefined);
  assert.equal(editor.text, 'x A A y');
  assert.deepEqual(editor.replaceAllCalls, [{ query: 'alpha', replacement: 'A' }]);
  assert.equal(editor.sliceCalls.length, 0);
});

test('empty queries are no-ops and destroy invalidates in-flight results without destroying the injected adapter', async () => {
  const editor = createSearchAdapter('alpha');
  const command = createFindReplaceCommand(editor.adapter);

  assert.equal(await command.findNext(''), null);
  assert.deepEqual(await command.replaceOne('', 'x'), { replaced: false, match: null });
  assert.equal(command.replaceAll('', 'x'), 0);
  assert.equal(editor.replaceRangeCalls.length, 0);
  assert.equal(editor.replaceAllCalls.length, 0);

  let resolvePending;
  const pending = command.findNext('alpha', {
    nativeSearch: () => new Promise(resolve => { resolvePending = resolve; })
  });
  command.destroy();
  command.destroy();
  resolvePending({ from: 0, to: 5 });
  assert.equal(await pending, undefined, 'destroy must invalidate an in-flight native result');
  assert.throws(() => command.replaceAll('alpha', 'x'), /destroyed/i);
  await assert.rejects(command.findNext('alpha'), /destroyed/i);
  assert.equal(typeof editor.adapter.findText, 'function');
});