import test from 'node:test';
import assert from 'node:assert/strict';
import { createFolderTreeController, createFolderTreeState } from '../../../src/features/sidebar/index.js';
function createView() { const calls=[]; let actions=null; return {calls,get actions(){return actions;},start(value){actions=value;calls.push('start');},render(snapshot){calls.push(['render',snapshot.loading,snapshot.fileCount,snapshot.errorMessage]);},updateHeader(snapshot){calls.push(['header',snapshot.currentDocumentPath]);},updateActive(path){calls.push(['active',path]);},destroy(){calls.push('destroy');}}; }

test('FolderTreeController reads only through FilesPort, rejects stale loads and opens through injected command', async () => {
  const pending=[]; const state=createFolderTreeState(); const view=createView(); let context={filePath:'F:/Notes/a.md'}; const opened=[];
  const controller=createFolderTreeController({state,view,available:true,getCurrentContext:()=>context,openFile:async path=>{opened.push(path);return true;},files:{listTextTree(path){return new Promise(resolve=>pending.push({path,resolve}));}}});
  controller.start(); const first=controller.activate(); context={filePath:'F:/Other/b.md'}; controller.syncCurrentDocument(context); assert.equal(pending.length,2);
  pending[0].resolve({rootPath:'F:/Notes',rootName:'Notes',fileCount:1,nodes:[{kind:'file',name:'a.md',path:'F:/Notes/a.md'}]});
  pending[1].resolve({rootPath:'F:/Other',rootName:'Other',fileCount:1,nodes:[{kind:'file',name:'b.md',path:'F:/Other/b.md'}]});
  await first; await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(controller.snapshot.currentDirectoryPath,'F:/Other'); assert.equal(controller.snapshot.tree.rootName,'Other');
  await view.actions.openFile('F:/Other/c.txt'); assert.deepEqual(opened,['F:/Other/c.txt']); assert.equal(controller.snapshot.currentDocumentPath,'F:/Other/c.txt');
  controller.destroy(); assert.throws(()=>controller.snapshot,/destroyed/);
});

test('FolderTreeController invalidates an in-flight read on deactivate and preserves load errors', async () => {
  let resolveRead; const state=createFolderTreeState(); const view=createView();
  const controller=createFolderTreeController({state,view,available:true,getCurrentContext:()=>({filePath:'F:/Notes/a.md'}),openFile:async()=>true,files:{listTextTree(){return new Promise(resolve=>{resolveRead=resolve;});}}});
  controller.start(); const load=controller.activate(); controller.deactivate(); resolveRead({rootPath:'F:/Notes',rootName:'stale',fileCount:1,nodes:[]}); await load; assert.equal(controller.snapshot.tree,null); controller.destroy();
  const errorState=createFolderTreeState(); const errorView=createView();
  const errorController=createFolderTreeController({state:errorState,view:errorView,available:true,getCurrentContext:()=>({filePath:'F:/Notes/a.md'}),openFile:async()=>true,files:{async listTextTree(){throw new Error('read denied');}}});
  errorController.start(); await errorController.activate(); assert.equal(errorController.snapshot.errorMessage,'read denied'); errorController.destroy();
});
