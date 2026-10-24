import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createExportFileWriter, createWordExporter, createWordDocumentSerializer, createHtmlExporter, createHtmlDocumentSerializer, createExportRequest, createExportTaskController,
  isExportCancelledError } from '../src/features/export/index.js';
import { createExportVmHost } from './support/export-vm-host.mjs';

const fontCss = '@font-face {font-family:KaTeX_Main;src:url("data:font/woff2;base64,AA==") format("woff2");}';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const cancelled = reason => error => isExportCancelledError(error) && error.reason === reason;
function setup({ desktop=true, body='<h1>中文 😀</h1><p>complete Word</p>' }={}) {
  const calls=[], tasks=createExportTaskController(), state={generation:1,activeId:'doc',version:7,removed:false};
  const documents={get generation(){return state.generation;},get activeId(){return state.activeId;},
    getRecord:id=>!state.removed&&['doc','other'].includes(id)?{id}:null,isCurrentGeneration:g=>g===state.generation};
  const documentModel={getDocumentVersion:()=>state.version},root={innerHTML:body};
  const builder={async build(options){calls.push(['build',options]);return root;},getSourceContext:()=>({documentId:'doc',documentVersion:7})};
  const enhancer={async enhance(options){calls.push(['enhance',options]);return options.root;}},assets={async load(){calls.push(['assets']);return fontCss;}};
  const styles={getCss:format=>'.export-document {font-size:'+(format==='word'?'12pt':'16px')+';}'};
  const serializer=createWordDocumentSerializer({styles}),platform={capabilities:{desktop:{dialogs:desktop,fileSystem:desktop},browser:{fileDownload:!desktop}},
    dialogs:{async saveFile(name,options){calls.push(['save',name,options]);return 'C:\\selected.doc';}},
    files:{async writeText(path,content,options){calls.push(['write',path,content,options]);}}};
  const deps={documentModel,documents,builder,enhancer,assets,serializer,taskController:tasks,fileWriter:createExportFileWriter({platform})};
  const owner=createWordExporter(deps),request=input=>createExportRequest({format:'word',documentId:'doc',name:'report.docx',directory:'C:\\custom',...input});
  return {calls,tasks,state,root,builder,enhancer,assets,styles,serializer,platform,deps,owner,request};
}

test('R14-11 Word uses its authoritative profile, embedded fonts and complete escaped passive document',()=>{
  const h=setup(),name='<Title>&\'" 😀.DOC',html=h.serializer.serialize({name,bodyHtml:h.root.innerHTML,fontCss});
  assert.ok(html.startsWith('<!DOCTYPE html>'));assert.ok(html.includes('<html lang="zh-CN">'));
  assert.ok(html.includes('<meta charset="utf-8">'));assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes('<title>&lt;Title&gt;&amp;&#39;&quot; 😀</title>'));
  assert.ok(html.includes('<style>'+h.styles.getCss('word')+'</style>'));assert.ok(html.includes(fontCss));
  assert.ok(html.includes('<body class="export-document" data-export-format="word">'));assert.ok(html.includes(h.root.innerHTML));
  assert.doesNotMatch(html,/<script[\s>]|<link[\s>]|cdn\.jsdelivr|exportPresentationPort/i);
  assert.throws(()=>h.serializer.serialize({name,bodyHtml:null,fontCss}),TypeError);
  assert.throws(()=>h.serializer.serialize({name,bodyHtml:'',fontCss:'</style><script>bad</script>'}),TypeError);
});

for(const desktop of [true,false])for(const body of ['', '<h1>中文 😀</h1>', '<p>中文 😀</p>\r\n'.repeat(30000)]) {
  test(`R14-11 ${desktop?'native':'browser'} preserves complete empty Unicode and large Word (${body.length})`,async()=>{
    const h=setup({desktop,body}),result=await h.owner.export({request:h.request()});
    assert.equal(result.status,desktop?'written':'downloaded');const write=h.calls.find(x=>x[0]==='write');
    assert.ok(write[2].includes('\n'+body+'\n</body>'));assert.ok(write[2].includes(fontCss));
    assert.deepEqual(write[3],{extension:'doc',reason:'export',...(!desktop?{mimeType:'application/msword;charset=utf-8'}:{})});
    assert.deepEqual(h.calls.map(x=>x[0]),desktop?['build','enhance','assets','save','write']:['build','enhance','assets','write']);
    assert.equal(h.tasks.getSnapshot().activeTask,null);
  });
}

test('R14-11 all original names and custom directories are captured before async work',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/stage-14-export/requests.json',import.meta.url)));
  for(const row of fixture.names){
    const h=setup(),input={format:'word',documentId:'doc',name:row.input,directory:'C:\\original'};
    h.builder.build=async()=>{input.name='late.md';input.directory='C:\\late';return h.root;};
    await h.owner.export({request:input});const save=h.calls.find(x=>x[0]==='save');
    assert.equal(save[1],row.word);assert.deepEqual(save[2],{title:'导出 Word',extension:'doc',extensions:['doc'],filterName:'Word 文档',defaultDirectory:'C:\\original'});
  }
});

test('R14-11 fixed Word capability refuses another format or document before task and body work',async()=>{
  const h=setup();
  for(const input of [undefined,h.request({format:'html'}),h.request({documentId:'missing'}),{format:'word',documentId:'doc',name:'bad\0'}]){
    await assert.rejects(h.owner.export({request:input}));assert.equal(h.tasks.getSnapshot().lastTaskId,0);assert.deepEqual(h.calls,[]);
  }
  await assert.rejects(h.owner.export({request:h.request({documentId:'other'})}),cancelled('document-changed'));
  assert.equal(h.tasks.getSnapshot().lastTaskId,0);assert.deepEqual(h.calls,[]);
  const fixed=createWordExporter({...h.deps,format:'html'});assert.equal((await fixed.export({request:h.request()})).status,'written');
});

for(const phase of ['build','enhance','assets','save'])for(const action of ['cancel','replace','destroy']){
  test(`R14-11 ${action} during ${phase} preserves cancellation identity, zero output and replacement ownership`,async()=>{
    const h=setup(),gate=deferred(),reached=deferred(),pause=()=>{reached.resolve();return gate.promise;};
    if(phase==='build')h.builder.build=pause;if(phase==='enhance')h.enhancer.enhance=pause;
    if(phase==='assets')h.assets.load=pause;if(phase==='save')h.platform.dialogs.saveFile=pause;
    const work=h.owner.export({request:h.request()});await reached.promise;
    let next;if(action==='cancel')assert.equal(h.tasks.cancel(),true);else if(action==='replace')next=h.tasks.begin('next');else h.owner.destroy();
    await assert.rejects(work,cancelled(action==='cancel'?'cancelled':action==='replace'?'replaced':'destroyed'));
    assert.equal(h.calls.some(x=>x[0]==='write'),false);assert.equal(h.tasks.getSnapshot().activeTask?.id??null,next?.id??null);
    gate.reject(new Error('late operation failure'));await Promise.resolve();if(next)h.tasks.finish(next);h.owner.destroy();h.tasks.destroy();
  });
}

test('R14-11 original source identity/version and all dialog-time mutations block stale Word',async()=>{
  for(const change of ['source-id','source-version','generation','activeId','version','removed']){
    const h=setup(),gate=deferred(),reached=deferred();
    if(change.startsWith('source'))h.builder.getSourceContext=()=>({documentId:change==='source-id'?'other':'doc',documentVersion:change==='source-version'?8:7});
    else h.platform.dialogs.saveFile=()=>{reached.resolve();return gate.promise;};
    const work=h.owner.export({request:h.request()});
    if(!change.startsWith('source')){await reached.promise;h.state[change]=change==='removed'?true:change==='activeId'?'other':99;gate.resolve('C:\\chosen.doc');}
    await assert.rejects(work,cancelled('document-changed'));assert.equal(h.calls.some(x=>x[0]==='write'),false);assert.equal(h.tasks.getSnapshot().activeTask,null);
  }
});

test('R14-11 serialization/writing progress reentry prevents an old publication',async()=>{
  for(const phase of ['serializing','writing']){
    const h=setup(),unsubscribe=h.tasks.subscribe(s=>{if(s.activeTask?.phase===phase)h.state.version++;});
    await assert.rejects(h.owner.export({request:h.request()}),cancelled('document-changed'));unsubscribe();
    assert.equal(h.calls.some(x=>x[0]==='write'),false);assert.equal(h.tasks.getSnapshot().activeTask,null);
  }
});

test('R14-11 original errors in every dependency keep identity and release the owned task',async()=>{
  for(const phase of ['build','enhance','load','serialize','saveFile','writeText']){
    const h=setup(),error=new Error(phase),bad=()=>{throw error;},deps={...h.deps};
    if(phase==='serialize')deps.serializer={serialize:bad};
    else ({build:h.builder,enhance:h.enhancer,load:h.assets,saveFile:h.platform.dialogs,writeText:h.platform.files})[phase][phase]=bad;
    const owner=createWordExporter(deps);await assert.rejects(owner.export({request:h.request()}),e=>e===error);assert.equal(h.tasks.getSnapshot().activeTask,null);
  }
});

test('R14-11 picker cancellation, invalid paths and partial native capabilities do not fall back',async()=>{
  for(const path of [null,'',false,42]){
    const h=setup();h.platform.dialogs.saveFile=async()=>path;
    if(path===null||path==='')assert.equal((await h.owner.export({request:h.request()})).status,'cancelled');
    else await assert.rejects(h.owner.export({request:h.request()}),TypeError);
    assert.equal(h.calls.some(x=>x[0]==='write'),false);assert.equal(h.tasks.getSnapshot().activeTask,null);
  }
  const h=setup();h.platform.capabilities.desktop.dialogs=false;await assert.rejects(h.owner.export({request:h.request()}),/能力不可用/);assert.equal(h.calls.some(x=>x[0]==='write'),false);
});

test('R14-11 issued Word writes stay locked and owner destruction observes late failure without retry',async()=>{
  const h=setup(),gate=deferred(),reached=deferred();h.platform.files.writeText=(...args)=>{h.calls.push(['write',...args]);reached.resolve();return gate.promise;};
  const work=h.owner.export({request:h.request()});await reached.promise;assert.equal(h.tasks.cancel(),false);assert.equal(h.tasks.begin('other'),null);
  assert.equal((await h.owner.export({request:h.request()})).status,'busy');h.owner.destroy();h.owner.destroy();
  const rejected=assert.rejects(work,cancelled('destroyed'));assert.equal(h.tasks.getSnapshot().activeTask.phase,'writing');
  assert.equal(h.tasks.begin('competing'),null);gate.reject(new Error('late writer failure'));await rejected;
  assert.equal(h.calls.filter(x=>x[0]==='write').length,1);assert.equal(h.tasks.getSnapshot().activeTask,null);
});

test('R14-11 HTML and Word share one task authority while keeping owner lifetimes and MIME separate',async()=>{
  const h=setup(),html=createHtmlExporter({...h.deps,serializer:createHtmlDocumentSerializer({styles:h.styles})}),gate=deferred(),reached=deferred();
  h.platform.files.writeText=(...args)=>{h.calls.push(['write',...args]);reached.resolve();return gate.promise;};
  const work=h.owner.export({request:h.request()});await reached.promise;
  assert.equal((await html.export({request:h.request({format:'html'})})).status,'busy');html.destroy();gate.resolve();assert.equal((await work).status,'written');
  await assert.rejects(html.export({request:h.request({format:'html'})}),cancelled('destroyed'));
  h.platform.files.writeText=async(...args)=>h.calls.push(['write',...args]);assert.equal((await h.owner.export({request:h.request()})).status,'written');
  assert.equal(h.calls.filter(x=>x[0]==='write').length,2);assert.equal(h.tasks.getSnapshot().activeTask,null);
});

test('R16-08 explicit Word capability preserves readonly metadata and terminal owner cleanup', async () => {
  const h = setup(), host = {};
  assert.equal(Object.keys(host).length, 0); assert.equal(Object.isFrozen(h.owner), true);
  assert.equal((await h.owner.export({ request: h.request() })).status, 'written');
  h.owner.destroy(); h.owner.destroy();
  await assert.rejects(async () => h.owner.export({ request: h.request() }), cancelled('destroyed'));
  assert.equal(h.tasks.getSnapshot().activeTask, null); h.tasks.destroy();
});

test('R14-11 actual classic Word command uses complete public pipeline with no private template or downloader',async()=>{
  for(const desktop of [false,true]){
    const h=createExportVmHost({desktop,name:'source.docx'});
    try{
      await h.invoke('exportWord');const file=desktop?h.calls.find(x=>x[0]==='writeText')[2]:await h.downloads[0].blob.text();
      assert.ok(file.includes('<style>'+h.styles.getCss('word')+'</style>'));assert.equal(file.match(/@font-face/g).length,20);
      assert.ok(file.includes('data-export-format="word"'));assert.doesNotMatch(file,/<script[\s>]|cdn\.jsdelivr|exportPresentationPort/);
      if(!desktop){assert.equal(h.downloads[0].name,'source.doc');assert.equal(h.downloads[0].blob.type,'application/msword;charset=utf-8');assert.ok(h.calls.some(x=>x[0]==='revoke'));}
      assert.equal(h.taskPort.getSnapshot().activeTask,null);
      const classic=readFileSync(new URL('../src/features/export/application/export-controller.js',import.meta.url),'utf8');
      assert.doesNotMatch(classic,/new Blob|URL\.|\.build\(|\.enhance\(|<html|exportTextContent|escapeExportTitle/);
    }finally{h.destroy();}
  }
});
