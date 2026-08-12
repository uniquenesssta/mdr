import test from 'node:test';
import assert from 'node:assert/strict';
import { createFolderTreeState } from '../../../src/features/sidebar/index.js';

test('FolderTreeState is the single runtime and expansion-state authority with terminal destroy', () => {
  const state=createFolderTreeState();
  const reasons=[];
  const unsubscribe=state.subscribe((_next,_prev,meta)=>reasons.push(meta.reason));
  state.setDocumentPath('F:/Notes/current.md');
  state.setDirectoryExpanded('F:/Notes/Archive', true);
  assert.equal(state.isDirectoryExpanded('F:/Notes/Archive', 1), true);
  assert.equal(state.isDirectoryExpanded('F:/Notes/Other', 0), true);
  state.setActive(true);
  state.setLoading(true);
  assert.equal(state.snapshot.active, true);
  assert.equal(state.snapshot.loading, true);
  assert.ok(reasons.includes('directory-expanded'));
  unsubscribe();
  state.destroy();
  assert.throws(()=>state.snapshot,/destroyed/);
});
