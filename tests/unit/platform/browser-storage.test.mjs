import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createBrowserStorage } from '../../../src/platform/index.js';

function createStorage() {
  const values = new Map();
  const calls = [];
  return {
    values,
    calls,
    getItem(key) { calls.push(['getItem', key]); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { calls.push(['setItem', key, value]); values.set(key, value); },
    removeItem(key) { calls.push(['removeItem', key]); values.delete(key); },
    clear() { calls.push(['clear']); values.clear(); }
  };
}

test('Atomic Task 3.10 browser storage preserves string localStorage semantics', () => {
  const storage = createStorage();
  const adapter = createBrowserStorage({ storage });

  assert.equal(adapter.get('missing'), null);
  assert.equal(adapter.set(7, 42), undefined);
  assert.equal(adapter.get(7), '42');
  assert.equal(adapter.remove(7), undefined);
  adapter.set('a', '1');
  adapter.clear();

  assert.deepEqual(storage.calls, [
    ['getItem', 'missing'],
    ['setItem', '7', '42'],
    ['getItem', '7'],
    ['removeItem', '7'],
    ['setItem', 'a', '1'],
    ['clear']
  ]);
  assert.ok(Object.isFrozen(adapter));
});

test('browser storage preserves native errors and does not own JSON or settings policy', async () => {
  const expected = new Error('storage blocked');
  const adapter = createBrowserStorage({
    storage: {
      getItem() { throw expected; },
      setItem() {},
      removeItem() {},
      clear() {}
    }
  });
  assert.throws(() => adapter.get('x'), error => error === expected);

  const source = await readFile(new URL('../../../src/platform/browser/browser-storage.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /JSON\.parse|JSON\.stringify|md_editor_|theme|autosave|document/);
});

test('browser storage rejects incomplete injected storage surfaces', () => {
  assert.throws(() => createBrowserStorage(null), /options must be an object/);
  assert.throws(
    () => createBrowserStorage({ storage: { getItem() {}, setItem() {}, removeItem() {} } }),
    /requires clear\(\)/
  );
});

test('Stage 3 verification runs Atomic Task 3.10 before createPlatform and architecture', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/stage-03-atomic.yml', import.meta.url), 'utf8');
  const previousIndex = workflow.indexOf('Verify Atomic Task 3.9 web link log clients');
  const browserIndex = workflow.indexOf('Verify Atomic Task 3.10 browser adapters');
  const platformIndex = workflow.indexOf('Verify Atomic Task 3.11 createPlatform');
  const architectureIndex = workflow.indexOf('Run architecture hard gate');
  assert.ok(previousIndex >= 0 && browserIndex > previousIndex && platformIndex > browserIndex && architectureIndex > platformIndex);
  assert.match(workflow, /browser-storage\.test\.mjs/);
  assert.match(workflow, /browser-file-download\.test\.mjs/);
  assert.match(workflow, /browser-clipboard\.test\.mjs/);
  assert.match(workflow, /browser-fullscreen\.test\.mjs/);
  assert.match(workflow, /browser-print\.test\.mjs/);
  assert.match(workflow, /browser-file-reader\.test\.mjs/);
  assert.match(workflow, /desktop-platform-contract\.test\.mjs/);
  assert.match(workflow, /create-platform\.test\.mjs/);
  assert.match(workflow, /03-12-architecture-scan\.json/);
  assert.match(workflow, /Verify Atomic Task 3\.12 final Platform cutover/);
});
