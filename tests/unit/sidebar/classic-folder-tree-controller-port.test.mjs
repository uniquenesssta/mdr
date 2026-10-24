import test from 'node:test';
import assert from 'node:assert/strict';
import { createFolderTreeController, createFolderTreeState } from '../../../src/features/sidebar/index.js';
test('R16-08 direct Folder Tree capability reads through Files and retains one state owner', async () => {
  const state = createFolderTreeState(), calls = [], reads = [];
  let context = { filePath: 'F:/Notes/a.md' };
  const view = { start() {}, render() {}, updateHeader() {}, updateActive() {}, destroy() { calls.push('destroy'); } };
  const controller = createFolderTreeController({ state, view, available: true, getCurrentContext: () => context, openFile: async () => true,
    files: { async listTextTree(path) { reads.push(path); return { rootPath: 'F:/Notes', rootName: 'Notes', fileCount: 1, nodes: [] }; } } });
  controller.start(); await controller.activate();
  context = { filePath: 'F:/Notes/b.md' }; controller.syncCurrentDocument(context);
  await controller.refresh(true);
  assert.equal(controller.snapshot, state.snapshot);
  assert.equal(controller.snapshot.currentDocumentPath, 'F:/Notes/b.md');
  assert.deepEqual(reads, ['F:/Notes/a.md','F:/Notes/b.md']);
  controller.destroy(); controller.destroy();
  assert.deepEqual(calls, ['destroy']);
  await assert.rejects(controller.refresh(), /destroyed/);
});
