import test from 'node:test';
import assert from 'node:assert/strict';
import { createVirtualWindowModel } from '../../../src/features/preview/render/virtual-window/virtual-window-model.js';

const thresholds = { overscanPx: 100, minimumBlocks: 3, maximumBlocks: 5, prewarmBlocks: 2 };
const blocks = Array.from({ length: 10 }, (_, index) => ({
  id: `b${index}`,
  startLine: index * 2 + 1,
  endLine: index * 2 + 2
}));

test('Atomic 7.10 model computes the initial bounded window from offsets without DOM', () => {
  const model = createVirtualWindowModel({ thresholds, getBlockHeight: () => 100 });
  model.setBlocks(blocks);
  assert.deepEqual(model.offsets, [0,100,200,300,400,500,600,700,800,900,1000]);
  assert.equal(model.totalHeight, 1000);
  assert.deepEqual(model.calculateWindow(0, 150), { start: 0, end: 3 });
});

test('Atomic 7.10 model switches windows on scroll and preserves min/max block bounds', () => {
  const model = createVirtualWindowModel({ thresholds, getBlockHeight: () => 100 });
  model.setBlocks(blocks);
  const range = model.calculateWindow(650, 120);
  assert.ok(range.start >= 5);
  assert.ok(range.end <= 10);
  assert.ok(range.end - range.start >= 3);
  assert.ok(range.end - range.start <= 5);
});

test('Atomic 7.10 model maps line ranges to a mount window without taking focus ownership', () => {
  const model = createVirtualWindowModel({ thresholds, getBlockHeight: () => 100 });
  model.setBlocks(blocks);
  assert.equal(model.containsLineRange(9, 12), true);
  const range = model.windowForLineRange(9, 12);
  assert.equal(range.low, 4);
  assert.equal(range.high, 5);
  assert.ok(range.start <= 4 && range.end > 5);
});

test('Atomic 7.10 model recomputes offsets after asynchronous measured heights change', () => {
  const heights = new Map();
  const model = createVirtualWindowModel({
    thresholds,
    getBlockHeight: block => heights.get(block.id) || 100
  });
  model.setBlocks(blocks);
  heights.set('b0', 180);
  heights.set('b1', 60);
  model.rebuild();
  assert.equal(model.offsets[1], 180);
  assert.equal(model.offsets[2], 240);
  assert.equal(model.totalHeight, 1040);
});
