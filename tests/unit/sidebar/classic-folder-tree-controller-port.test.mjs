import test from 'node:test';
import assert from 'node:assert/strict';
import { mountClassicFolderTreeControllerPort } from '../../../src/features/sidebar/index.js';

test('classic Folder Tree port forwards without copying state and removes only its host property', () => {
  const host={}; const calls=[]; const snapshot=Object.freeze({active:true}); const controller={syncCurrentDocument(value){calls.push(['sync',value]);},refresh(force){calls.push(['refresh',force]);},get snapshot(){return snapshot;}};
  const port=mountClassicFolderTreeControllerPort(host,controller); assert.equal(host.markdownEditorFolderTreeControllerPort,port); port.syncCurrentDocument({filePath:'F:/Notes/a.md'}); port.refresh(true);
  assert.deepEqual(calls,[['sync',{filePath:'F:/Notes/a.md'}],['refresh',true]]); assert.equal(port.snapshot,controller.snapshot); port.destroy(); assert.equal('markdownEditorFolderTreeControllerPort' in host,false); assert.throws(()=>port.refresh(),/destroyed/);
});
