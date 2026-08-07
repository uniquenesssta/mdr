import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createBrowserPrint } from '../../../src/platform/index.js';

test('Atomic Task 3.10 browser print delegates exactly once and preserves return values', () => {
  const calls = [];
  const windowObject = { print() { calls.push('print'); return 'printed'; } };
  const adapter = createBrowserPrint({ windowObject });
  assert.equal(adapter.print(), 'printed');
  assert.deepEqual(calls, ['print']);
  assert.ok(Object.isFrozen(adapter));
});

test('browser print preserves the original browser error identity', () => {
  const expected = new Error('print blocked');
  const adapter = createBrowserPrint({ windowObject: { print() { throw expected; } } });
  assert.throws(() => adapter.print(), error => error === expected);
});

test('print preparation and after-print restoration remain outside the adapter', async () => {
  const adapterSource = await readFile(new URL('../../../src/platform/browser/browser-print.js', import.meta.url), 'utf8');
  const exportSource = await readFile(new URL('../../../public/app/export.js', import.meta.url), 'utf8');
  assert.doesNotMatch(adapterSource, /afterprint|restorePreview|setTimeout|markdown-body|public\/app\/export/);
  assert.match(exportSource, /afterprint/);
  assert.match(exportSource, /restorePreview/);
});

test('browser print rejects unavailable surfaces explicitly', () => {
  assert.throws(() => createBrowserPrint(null), /options must be an object/);
  assert.throws(() => createBrowserPrint({ windowObject: {} }), /print is unavailable/);
});
