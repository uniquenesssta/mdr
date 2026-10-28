import test from 'node:test';
import assert from 'node:assert/strict';
import { collectOutlineWindowRows, outlineWindowRange } from '../../../src/features/sidebar/outline/outline-window-model.js';

test('large outline windows preserve hierarchy and exclude collapsed descendants without discarding the tree', () => {
  const tree=[{id:'a',children:[{id:'b',children:[{id:'c',children:[]}]}]},{id:'d',children:[]}];
  const collapsed=collectOutlineWindowRows(tree,id=>id==='b');
  assert.equal(collapsed.total,4);assert.deepEqual(collapsed.rows.map(({node,depth})=>[node.id,depth]),[['a',0],['b',1],['d',0]]);
  assert.deepEqual(collectOutlineWindowRows(tree,()=>false).rows.map(({node})=>node.id),['a','b','c','d']);
  assert.equal(tree[0].children[0].children[0].id,'c');
});

test('large outline windows cover the exact viewport and overscan at both document ends', () => {
  assert.deepEqual(outlineWindowRange(3339,0,360),{start:0,end:16});
  assert.deepEqual(outlineWindowRange(3339,36000,360),{start:994,end:1016});
  const end=outlineWindowRange(3339,3339*36-360,360);assert.equal(end.end,3339);assert.equal(end.end-end.start,16);
  assert.deepEqual(outlineWindowRange(0,0,0),{start:0,end:0});
});
