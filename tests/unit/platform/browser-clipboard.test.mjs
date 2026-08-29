import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserClipboard } from '../../../src/platform/index.js';

function createFallbackDocument({ result = true } = {}) {
  const log = [];
  const body = {
    appendChild(node) { node.parentNode = body; log.push(['append', node.value]); },
    removeChild(node) { node.parentNode = null; log.push(['remove', node.value]); }
  };
  return {
    log,
    body,
    createElement(tag) {
      assert.equal(tag, 'textarea');
      return {
        value: '',
        style: {},
        parentNode: null,
        setAttribute(name, value) { log.push(['attribute', name, value]); },
        select() { log.push(['select']); },
        setSelectionRange(start, end) { log.push(['range', start, end]); },
        remove() { if (this.parentNode) body.removeChild(this); }
      };
    },
    execCommand(command) { log.push(['execCommand', command]); return result; }
  };
}

test('Atomic Task 3.10 clipboard prefers navigator.clipboard and preserves text coercion', async () => {
  const calls = [];
  const clipboard = { async writeText(value) { calls.push(value); } };
  const adapter = createBrowserClipboard({ navigatorObject: { clipboard }, documentObject: null });
  assert.equal(await adapter.writeText(42), true);
  assert.deepEqual(calls, ['42']);
  assert.ok(Object.isFrozen(adapter));
});

test('native clipboard rejection is preserved and does not silently fall back', async () => {
  const expected = new Error('permission denied');
  const fallback = createFallbackDocument();
  const adapter = createBrowserClipboard({
    navigatorObject: { clipboard: { writeText: async () => { throw expected; } } },
    documentObject: fallback
  });
  await assert.rejects(adapter.writeText('x'), error => error === expected);
  assert.deepEqual(fallback.log, []);
});

test('clipboard fallback uses a temporary textarea and cleans it after success', async () => {
  const documentObject = createFallbackDocument();
  const adapter = createBrowserClipboard({ navigatorObject: {}, documentObject });
  assert.equal(await adapter.writeText('hello'), true);
  assert.deepEqual(documentObject.log.map(entry => entry[0]), [
    'attribute', 'append', 'select', 'range', 'execCommand', 'remove'
  ]);
  assert.deepEqual(documentObject.log.at(-2), ['execCommand', 'copy']);
});

test('clipboard fallback rejection is explicit and still cleans temporary DOM', async () => {
  const documentObject = createFallbackDocument({ result: false });
  const adapter = createBrowserClipboard({ navigatorObject: {}, documentObject });
  await assert.rejects(adapter.writeText('hello'), /clipboard copy was rejected/);
  assert.equal(documentObject.log.at(-1)[0], 'remove');
});

test('browser clipboard reports unsupported surfaces explicitly', async () => {
  assert.throws(() => createBrowserClipboard(null), /options must be an object/);
  const adapter = createBrowserClipboard({ navigatorObject: {}, documentObject: {} });
  await assert.rejects(adapter.writeText('x'), /clipboard is unavailable/);
});
