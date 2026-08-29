import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFolderTreeResult } from '../../../src/features/sidebar/index.js';

test('Folder Tree normalizer filters unreadable extensions and sorts directories before files', () => {
  const tree = normalizeFolderTreeResult({rootPath:'F:/Notes',rootName:'Notes',fileCount:3,directoryCount:1,skippedCount:2,truncated:true,nodes:[
    {kind:'file',name:'z.txt',path:'F:/Notes/z.txt'},
    {kind:'file',name:'ignore.png',path:'F:/Notes/ignore.png'},
    {kind:'directory',name:'Archive',path:'F:/Notes/Archive',children:[{kind:'file',name:'old.md',path:'F:/Notes/Archive/old.md'}]},
    {kind:'file',name:'a.markdown',path:'F:/Notes/a.markdown'}
  ]});
  assert.deepEqual(tree.nodes.map(node=>node.name), ['Archive','a.markdown','z.txt']);
  assert.equal(tree.nodes[0].children[0].name, 'old.md');
  assert.equal(tree.truncated, true);
  assert.equal(Object.isFrozen(tree), true);
  assert.equal(Object.isFrozen(tree.nodes), true);
});
