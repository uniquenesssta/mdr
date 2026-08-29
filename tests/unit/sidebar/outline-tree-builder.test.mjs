import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOutlineTree,
  collectCollapsibleOutlineIds,
  normalizeOutlineHeadingIndex,
  normalizePreviewHeadingBlocks
} from '../../../src/features/sidebar/outline/outline-tree-builder.js';

test('Atomic 6.8 builds the Outline hierarchy from an existing heading index', () => {
  const index = normalizeOutlineHeadingIndex([
    { id: 'c', level: 2, text: 'Child', line: 5 },
    { id: 'a', level: 1, text: 'Root', line: 1 },
    { id: 'b', level: 3, text: 'Grandchild', line: 6 },
    { id: 'd', level: 1, text: 'Next', line: 10 }
  ]);
  assert.deepEqual(index.map(item => item.id), ['a', 'c', 'b', 'd']);
  const tree = buildOutlineTree(index);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].id, 'a');
  assert.equal(tree[0].children[0].id, 'c');
  assert.equal(tree[0].children[0].children[0].id, 'b');
  assert.equal(tree[1].id, 'd');
  assert.deepEqual(collectCollapsibleOutlineIds(tree), ['a', 'c']);
  assert.equal(Object.isFrozen(tree), true);
});

test('Atomic 6.8 may normalize already-indexed preview heading blocks without parsing editor source', () => {
  const headings = normalizePreviewHeadingBlocks([
    { id: 'block-1', type: 'heading', raw: '## **Alpha**\nbody', startLine: 4 },
    { id: 'block-2', type: 'paragraph', raw: '# Not a heading block', startLine: 5 },
    { id: 'block-3', type: 'heading', raw: '### [Beta](https://example.com)', startLine: 8 }
  ]);
  assert.deepEqual(headings.map(({ id, level, text, line }) => ({ id, level, text, line })), [
    { id: 'heading-block-1', level: 2, text: 'Alpha', line: 4 },
    { id: 'heading-block-3', level: 3, text: 'Beta', line: 8 }
  ]);
});
