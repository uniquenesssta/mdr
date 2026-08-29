import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOutlineCollapseStore,
  OUTLINE_COLLAPSE_STORAGE_KEY
} from '../../../src/features/sidebar/outline/outline-collapse-store.js';

function harness(raw = '{"a":true,"b":false}') {
  const values = new Map([[OUTLINE_COLLAPSE_STORAGE_KEY, raw]]);
  const writes = [];
  const errors = [];
  const store = createOutlineCollapseStore({
    storage: {
      get(key) { return values.get(key) ?? null; },
      async set(key, value) { values.set(key, value); writes.push([key, value]); }
    },
    reportError(message, error) { errors.push([message, error]); }
  });
  return { store, values, writes, errors };
}

test('Atomic 6.8 collapse store restores and persists the exact legacy key', async () => {
  const h = harness();
  h.store.restore();
  assert.equal(h.store.isCollapsed('a'), true);
  assert.equal(h.store.isCollapsed('b'), false);
  await h.store.toggle('b');
  assert.equal(h.store.isCollapsed('b'), true);
  assert.equal(h.writes.at(-1)[0], OUTLINE_COLLAPSE_STORAGE_KEY);
  assert.deepEqual(JSON.parse(h.writes.at(-1)[1]), { a: true, b: true });
  await h.store.expandAll();
  assert.deepEqual(JSON.parse(h.writes.at(-1)[1]), {});
  await h.store.collapseAll(['x', 'y']);
  assert.deepEqual(JSON.parse(h.writes.at(-1)[1]), { x: true, y: true });
  h.store.destroy();
});

test('Atomic 6.8 invalid collapse persistence is controlled and destroy is terminal', async () => {
  const errors = [];
  const store = createOutlineCollapseStore({
    storage: { get: () => '{bad', set: async () => { throw new Error('denied'); } },
    reportError(message, error) { errors.push([message, error]); }
  });
  store.restore();
  assert.deepEqual(store.snapshot.collapsedIds, []);
  const result = await store.collapse('a');
  assert.equal(result.ok, false);
  assert.equal(store.isCollapsed('a'), true);
  assert.equal(errors.length, 1);
  store.destroy();
  store.destroy();
  assert.throws(() => store.isCollapsed('a'), /destroyed/);
});
