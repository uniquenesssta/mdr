import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createExportFileWriter, createExportRequest, createExportTaskController, ExportCancelledError, isExportCancelledError } from '../src/features/export/index.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const cancelled = reason => error => isExportCancelledError(error) && error.reason===reason;
const profiles = { markdown:['md','text/markdown;charset=utf-8'], html:['html','text/html;charset=utf-8'], word:['doc','application/msword;charset=utf-8'], image:['png','image/png'] };
function setup(t, desktop=true) {
  const calls=[],tasks=createExportTaskController(),state={current:true};
  const platform={capabilities:{desktop:{dialogs:desktop,fileSystem:desktop},browser:{fileDownload:!desktop}},
    dialogs:{async saveFile(...args){calls.push(['dialog',...args]);return 'C:\\owned\\selected';}},
    files:{async writeText(...args){calls.push(['text',...args]);},async writeBinary(...args){calls.push(['binary',...args]);}}};
  const writer=createExportFileWriter({platform});t.after(()=>{writer.destroy();tasks.destroy();});
  const request=format=>createExportRequest({format,documentId:'doc',name:'原文😀.txt',directory:'C:\\custom'});
  const content=format=>format==='image'?new Uint8Array([137,80,78,71,13,10,26,10]):'\uFEFF原文😀\r\n末尾';
  async function write(format='markdown', overrides={}) {
    const task=tasks.begin('writer fixture');assert.ok(task);
    try {return await writer.write({request:request(format),content:content(format),task,
      assertCurrent(){if(!state.current)throw new ExportCancelledError('document-changed');},
      wait:value=>task.token.waitFor(value),...overrides});}
    finally {tasks.finish(task);}
  }
  return {writer,platform,tasks,state,calls,request,content,write};
}
for(const desktop of [true,false])for(const format of Object.keys(profiles))test('R14-17 '+format+' '+(desktop?'native':'browser')+' retains exact payload and authoritative name/filter/MIME',async t=>{
  const h=setup(t,desktop),result=await h.write(format),request=h.request(format),[extension,mimeType]=profiles[format];
  assert.equal(result.status,desktop?'written':'downloaded');assert.equal(result.name,request.name);
  const output=h.calls.find(x=>x[0]===(format==='image'?'binary':'text'));assert.deepEqual(output[2],h.content(format));
  assert.deepEqual(output[3],{extension,reason:'export',...(!desktop?{mimeType}:{})});
  if(desktop){const dialog=h.calls[0];assert.equal(dialog[1],request.name);assert.deepEqual(dialog[2].extensions,request.extensions);assert.equal(dialog[2].defaultDirectory,'C:\\custom');}
  else assert.equal(h.calls.some(x=>x[0]==='dialog'),false);
  assert.equal(h.tasks.getSnapshot().activeTask,null);
});
for(const format of Object.keys(profiles))test('R14-17 '+format+' null/empty picker cancellation is a quiet result with no output',async t=>{
  const h=setup(t);for(const path of [null,'']){h.platform.dialogs.saveFile=async()=>path;assert.equal((await h.write(format)).status,'cancelled');}
  assert.equal(h.calls.length,0);assert.equal(h.tasks.getSnapshot().activeTask,null);
});
for(const action of ['cancel','replace','destroy','source'])test('R14-17 '+action+' pending dialog rejects promptly and observes late failure without output',async t=>{
  const h=setup(t),gate=deferred(),entered=deferred();h.platform.dialogs.saveFile=()=>{entered.resolve();return gate.promise;};
  const work=h.write('image');await entered.promise;const rejected=assert.rejects(work,cancelled({cancel:'cancelled',replace:'replaced',destroy:'destroyed',source:'document-changed'}[action]));
  let replacement;
  if(action==='cancel')h.tasks.cancel();if(action==='replace')replacement=h.tasks.begin('replacement');if(action==='destroy')h.writer.destroy();
  if(action==='source'){h.state.current=false;gate.resolve('C:\\owned\\late.png');}
  await rejected;gate.reject(new Error('late dialog'));await Promise.resolve();assert.equal(h.calls.length,0);
  assert.equal(h.tasks.getSnapshot().activeTask?.id??null,replacement?.id??null);if(replacement)h.tasks.finish(replacement);
});
for(const format of Object.keys(profiles))for(const late of ['resolve','reject'])test('R14-17 '+format+' destroyed issued write retains lock through late '+late,async t=>{
  const h=setup(t),gate=deferred(),entered=deferred();h.platform.files[format==='image'?'writeBinary':'writeText']=(...args)=>{h.calls.push(['issued',...args]);entered.resolve();return gate.promise;};
  const work=h.write(format);await entered.promise;const rejected=assert.rejects(work,cancelled('destroyed'));h.writer.destroy();h.writer.destroy();
  assert.equal(h.tasks.cancel(),false);assert.equal(h.tasks.begin('competing'),null);assert.equal(h.tasks.getSnapshot().activeTask.phase,'writing');
  late==='resolve'?gate.resolve():gate.reject(new Error('late disk failure'));await rejected;
  assert.equal(h.calls.filter(x=>x[0]==='issued').length,1);assert.equal(h.tasks.getSnapshot().activeTask,null);
  await assert.rejects(h.writer.write({}),cancelled('destroyed'));
});
test('R14-17 binary input is copied before picker notification and external mutation cannot change output',async t=>{
  const h=setup(t),gate=deferred(),entered=deferred(),bytes=h.content('image'),expected=bytes.slice();
  h.platform.dialogs.saveFile=()=>{entered.resolve();return gate.promise;};const work=h.write('image',{content:bytes});await entered.promise;bytes.fill(0);gate.resolve('C:\\owned\\frozen.png');await work;
  assert.deepEqual(h.calls.find(x=>x[0]==='binary')[2],expected);
});
test('R14-17 partial capabilities, malformed path and wrong payload fail without browser fallback',async t=>{
  for(const flags of [[true,false,true],[false,true,true],[false,false,false]]){
    const h=setup(t);h.platform.capabilities.desktop={dialogs:flags[0],fileSystem:flags[1]};h.platform.capabilities.browser.fileDownload=flags[2];await assert.rejects(h.write());assert.equal(h.calls.length,0);
  }
  const h=setup(t);for(const path of [17,false,{}]){h.platform.dialogs.saveFile=async()=>path;await assert.rejects(h.write(),/保存路径/);}
  for(const [format,content] of [['image','bytes'],['html',new Uint8Array([1])]])await assert.rejects(h.write(format,{content}),/payload/);
  assert.equal(h.calls.length,0);
});
test('R14-17 dialog/write errors preserve identity and next operation recovers without retrying a write',async t=>{
  const h=setup(t),dialog=h.platform.dialogs.saveFile,write=h.platform.files.writeText;
  for(const phase of ['dialog','write']){const error=new Error(phase);if(phase==='dialog')h.platform.dialogs.saveFile=()=>{throw error;};else h.platform.files.writeText=()=>{throw error;};await assert.rejects(h.write(),x=>x===error);h.platform.dialogs.saveFile=dialog;h.platform.files.writeText=write;assert.equal((await h.write()).status,'written');}
});
test('R14-17 synchronous lock notification source change blocks actual native output',async t=>{
  const h=setup(t);const unsubscribe=h.tasks.subscribe(snapshot=>{if(snapshot.activeTask?.phase==='writing')h.state.current=false;});t.after(unsubscribe);
  await assert.rejects(h.write(),cancelled('document-changed'));assert.equal(h.calls.some(x=>x[0]==='text'),false);assert.equal(h.tasks.getSnapshot().activeTask,null);
});
test('R14-17 all file format owners call one public writer and retain independent source/task authority',()=>{
  for(const path of ['markdown-exporter.js','rendered-document-exporter.js','image/image-exporter.js']){
    const source=readFileSync(new URL('../src/features/export/formats/'+path,import.meta.url),'utf8');
    assert.match(source,/fileWriter\.write/);assert.doesNotMatch(source,/platform\.|new Blob|createObjectURL|__TAURI|nativeDialogs|nativeFiles/);
  }
  const writer=readFileSync(new URL('../src/features/export/application/export-file-writer.js',import.meta.url),'utf8');
  assert.doesNotMatch(writer,/documentModel|createSnapshot|taskController\.begin|document\.|new Blob|__TAURI|currentImageDataUrl/);
});
