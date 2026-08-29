import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVirtualHeightCache,
  estimateVirtualBlockHeight
} from '../../../src/features/preview/render/virtual-window/height-cache.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    values
  };
}

const blocks = [
  { id: 'a', type: 'heading', startLine: 1, endLine: 1, raw: '# A' },
  { id: 'b', type: 'code', startLine: 2, endLine: 5, raw: '```js\n1\n2\n```' }
];

test('Atomic 7.10 height cache preserves frozen estimation behavior by block type', () => {
  assert.equal(estimateVirtualBlockHeight(blocks[0]), 58);
  assert.equal(estimateVirtualBlockHeight(blocks[1]), 142);
});

test('Atomic 7.10 height cache persists and restores only signature-compatible measurements', () => {
  const storage = memoryStorage();
  const first = createVirtualHeightCache({ storage, scheduleIdle: callback => callback(), now: () => 7 });
  first.setBlocks(blocks);
  first.setContext('doc-1', 'light:14:10');
  assert.equal(first.recordMeasurement('a', 91, { top: 4, bottom: 5 }), true);
  first.persist();
  first.destroy();

  const second = createVirtualHeightCache({ storage });
  second.setBlocks(blocks);
  second.setContext('doc-1', 'light:14:10');
  assert.equal(second.restore(blocks), 1);
  assert.equal(second.getHeight(blocks[0]), 91);
  assert.deepEqual(second.getInset('a'), { top: 4, bottom: 5 });
  assert.equal(second.cachedCount, 1);

  const changed = [{ ...blocks[0], raw: '# Changed' }];
  const third = createVirtualHeightCache({ storage });
  third.setBlocks(changed);
  third.setContext('doc-1', 'light:14:10');
  assert.equal(third.restore(changed), 0);
  assert.equal(third.getHeight(changed[0]), 58);
});

test('Atomic 7.10 height cache isolates visual contexts and prunes removed ids', () => {
  const storage = memoryStorage();
  const cache = createVirtualHeightCache({ storage });
  cache.setBlocks(blocks);
  cache.setContext('doc-2', 'light');
  cache.recordMeasurement('a', 80);
  cache.recordMeasurement('b', 160);
  assert.equal(cache.measuredCount, 2);
  cache.retainIds(new Set(['b']));
  assert.equal(cache.measuredCount, 1);
  cache.setContext('doc-2', 'dark');
  assert.equal(cache.measuredCount, 0);
});
