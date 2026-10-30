import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorContextActions } from '../../../src/features/editor/application/editor-context-actions.js';

function fixture() {
  let text='alpha beta', version=0, documentId='a', readOnly=false, selected={start:0,end:5};
  const writes=[],changes=[];
  const editor={getSelection:()=>selected,getDocumentVersion:()=>version,sliceText:(a,b)=>text.slice(a,b),getTextLength:()=>text.length,
    setSelection:(a,b)=>{selected={start:a,end:b};},replaceRange:(value,a,b)=>{text=text.slice(0,a)+value+text.slice(b);version++;changes.push(text);}};
  const clipboard={writeText:async value=>{writes.push(value);},readText:async()=> 'delta'};
  const owner=createEditorContextActions({editor,clipboard,focus:()=>{},runHistory:()=>true,getDocumentId:()=>documentId,isReadOnly:()=>readOnly});
  return {owner,editor,clipboard,writes,changes,text:()=>text,setDocument:id=>{documentId=id;},setReadOnly:()=>{readOnly=true;}};
}
test('context copy, cut and paste use editor transactions and preserve unselected text',async()=>{
  const f=fixture();await f.owner.execute('copy',f.owner.capture());assert.deepEqual(f.writes,['alpha']);assert.equal(f.text(),'alpha beta');
  await f.owner.execute('paste',f.owner.capture());assert.equal(f.text(),'delta beta');assert.equal(f.changes.length,1);
});
test('async clipboard cannot mutate another document or a changed selection',async()=>{
  const f=fixture();let release;f.clipboard.readText=()=>new Promise(r=>{release=r;});
  const pending=f.owner.execute('paste',f.owner.capture());f.setDocument('b');release('wrong');assert.equal(await pending,false);assert.equal(f.text(),'alpha beta');
  f.setDocument('a');const cut=f.owner.capture();f.editor.setSelection(5,5);assert.equal(await f.owner.execute('cut',cut),false);assert.deepEqual(f.writes,[]);
});
test('read-only and destroyed owners reject mutations while allowing read-only copying',async()=>{
  const f=fixture();f.setReadOnly();for(const action of ['cut','paste','undo','redo'])assert.equal(await f.owner.execute(action,f.owner.capture()),false);
  assert.equal(await f.owner.execute('copy',f.owner.capture()),true);f.owner.destroy();assert.equal(await f.owner.execute('paste',f.owner.capture()),false);assert.equal(f.text(),'alpha beta');
});
test('history belongs to the document and is not blocked by right-click caret placement',async()=>{
  const f=fixture(),intent=f.owner.capture();f.editor.setSelection(3,3);
  assert.equal(await f.owner.execute('undo',intent),true);
  f.setDocument('b');assert.equal(await f.owner.execute('redo',intent),false);
});
test('a clipboard without text cannot delete the current selection',async()=>{
  const f=fixture();f.clipboard.readText=async()=>'';
  assert.equal(await f.owner.execute('paste',f.owner.capture()),false);assert.equal(f.text(),'alpha beta');assert.deepEqual(f.changes,[]);
});
