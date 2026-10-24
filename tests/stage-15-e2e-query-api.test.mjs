import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createE2EQueryAPI} from '../src/features/e2e/index.js';
import {configureMarkdownEditorE2EPorts, installMarkdownEditorE2EBridge, destroyMarkdownEditorE2EBridge} from '../src/features/e2e/index.js';

const tick = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };
const required = ['readContext','readSnapshot','readPreviewStats','readText','importDocument','setLayout','setVisualEditing','focus','select','scroll','findText','clearStorage','now','schedule','cancel','requestFrame','cancelFrame'];
function fixture(t, overrides={}) {
  let time=0, nextId=-1, content='alpha beta', context={documentId:'doc-1',generation:1,version:0};
  const timers=new Map(), frames=new Map(), calls=[];
  const raw={ready:true,layout:'hybrid',presentationMode:'hybrid',documentLength:content.length,selectionStart:0,selectionEnd:5,selectedText:'alpha',pendingMermaid:0,
    presentationStats:{visibleLines:2,sourceActiveLines:0},componentStates:[{key:'code:0',type:'code',from:0,mode:'presented',revision:1,version:0,reason:'render',updatedAt:12,details:{secret:'PRIVATE'}}],
    components:[{type:'code',directEditing:false,sourceVisible:false,connected:true}],activeElement:{tagName:'textarea',id:'editor',className:'editor',hybridBlockType:null}};
  const preview={active:true,blocks:3,mountedBlocks:2,start:0,end:2,viewportWidth:800,viewportHeight:600,scope:'document',priorityChapter:{private:true}};
  const ports={readContext:()=>context,readSnapshot:()=>raw,readPreviewStats:()=>preview,readText:()=>content,
    importDocument:(value,name)=>{calls.push(['import',value,name]);content=value.replace(/\r\n?/g,'\n');context={documentId:'doc-2',generation:2,version:0};raw.documentLength=content.length;return {loaded:true,context:{...context}};},
    setLayout:mode=>{calls.push(['layout',mode]);raw.layout=mode;},setVisualEditing:options=>calls.push(['visual',options]),
    focus:()=>calls.push(['focus']),select:position=>{calls.push(['select',position]);raw.selectionStart=raw.selectionEnd=position;},
    scroll:(...args)=>calls.push(['scroll',...args]),findText:(value,from,options)=>{calls.push(['find',value,from,options]);const index=content.indexOf(value,from);return index<0?null:{from:index,to:index+value.length};},
    clearStorage:()=>calls.push(['clear']),now:()=>time,schedule:(fn,ms)=>{const id=++nextId;timers.set(id,{fn,due:time+ms,ms});return id;},cancel:id=>timers.delete(id),
    requestFrame:fn=>{const id=++nextId;frames.set(id,{fn,due:time+16});return id;},cancelFrame:id=>frames.delete(id),...overrides};
  const api=createE2EQueryAPI(ports);
  t.after(()=>api.destroy());
  const f={api,ports,timers,frames,calls,raw,preview,get context(){return context;},set context(value){context=value;},get content(){return content;},set content(value){content=value;},
    async step(){await tick();const entries=[...[...timers].map(([id,item])=>({map:timers,id,...item})),...[...frames].map(([id,item])=>({map:frames,id,...item}))].sort((a,b)=>a.due-b.due);
      const item=entries[0];assert.ok(item,'expected an owned scheduled resource');time=item.due;item.map.delete(item.id);item.fn();await tick();},
    async complete(promise){let settled=false,result,caught;promise.then(value=>{settled=true;result=value;},error=>{settled=true;caught=error;});
      for(let i=0;i<3000&&!settled;i++){await tick();if(!settled)await f.step();}assert.equal(settled,true,'bounded settlement');if(caught)throw caught;return result;},
    empty(){assert.equal(timers.size,0);assert.equal(frames.size,0);assert.equal(api.getState().activeOperations,0);assert.equal(api.getState().pendingWaits,0);}};
  return f;
}
function assertFrozen(value){if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));for(const item of Object.values(value))assertFrozen(item);}}

test('R15-09 semantic owner uses public entry and injected ports without DOM globals or feature imports',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  assert.match(read('src/features/e2e/index.js'),/export \{ createE2EQueryAPI \}/);
  assert.doesNotMatch(read('src/features/e2e/e2e-query-api.js'),/\b(?:window|document|globalThis)\.|querySelector|virtualEditor|from ['"]|setTimeout\(|requestAnimationFrame\(/);
  const bridge=read('src/features/e2e/browser-e2e-bridge.js');assert.match(bridge,/createE2EQueryAPI.*from '\.\/e2e-query-api\.js'/);assert.doesNotMatch(bridge,/function (?:waitForIdle|loadMarkdown|revealPosition|revealText)|waitForAnimationFrames/);
  const main=read('src/main.js');assert.match(main,/configureMarkdownEditorE2EPorts/);assert.match(main,/const destroyDocumentFeatures = \(\) => \{\s*destroyMarkdownEditorE2EBridge\(\)/);
});
for(const name of required)test('R15-09 rejects invalid dependency '+name,t=>{assert.throws(()=>fixture(t,{[name]:null}),TypeError);});
test('R15-09 construction is cold and exposes only frozen semantic capability',t=>{
  const f=fixture(t);assert.equal(f.calls.length,0);f.empty();assert.ok(Object.isFrozen(f.api));assert.deepEqual(Object.keys(f.api).sort(),['snapshot','getComponentStates','getPreviewStats','getEditorValue','waitForIdle','setLayout','setVisualEditing','revealPosition','revealText','loadMarkdown','clearStorage','destroy','getState'].sort());
});
test('R15-09 snapshot detaches all nested fields and never reads unknown internal getters',t=>{
  const f=fixture(t);Object.defineProperty(f.raw,'model',{get(){throw Error('PRIVATE');}});Object.defineProperty(f.raw.componentStates[0],'internal',{get(){throw Error('PRIVATE');}});
  const value=f.api.snapshot();assertFrozen(value);assert.equal(value.componentStates[0].details,undefined);assert.equal(value.model,undefined);assert.equal(value.documentId,'doc-1');
  f.raw.presentationStats.visibleLines=900;f.raw.componentStates[0].mode='changed';f.raw.components[0].type='changed';f.raw.activeElement.id='changed';
  assert.equal(value.presentationStats.visibleLines,2);assert.equal(value.componentStates[0].mode,'presented');assert.equal(value.components[0].type,'code');assert.equal(value.activeElement.id,'editor');
  assert.throws(()=>{value.componentStates[0].mode='mutated';},TypeError);assert.equal(f.calls.length,0);f.empty();
});
test('R15-09 component and preview queries return fixed readonly metrics without controller objects',t=>{
  const f=fixture(t);const states=f.api.getComponentStates(),preview=f.api.getPreviewStats();assertFrozen(states);assertFrozen(preview);assert.equal(preview.blocks,3);assert.equal(preview.priorityChapter,undefined);f.preview.blocks=44;assert.equal(preview.blocks,3);assert.equal(f.api.getPreviewStats().blocks,44);f.empty();
});
test('R15-09 invalid metrics and unknown fields cannot become functions or internal objects',t=>{
  const f=fixture(t);f.raw.documentLength=Infinity;f.raw.presentationStats.visibleLines=-1;f.preview.blocks=()=>3;f.raw.componentStates[0].key={private:true};
  const value=f.api.snapshot();assert.equal(value.documentLength,0);assert.equal(value.presentationStats.visibleLines,0);assert.equal(value.componentStates[0].key,'');assert.equal(f.api.getPreviewStats().blocks,0);
});
test('R15-09 oversized component arrays are bounded with explicit truncation flags',t=>{
  const f=fixture(t);f.raw.componentStates=Array(1100).fill(f.raw.componentStates[0]);f.raw.components=Array(1200).fill(f.raw.components[0]);const value=f.api.snapshot();assert.equal(value.componentStates.length,1000);assert.equal(value.components.length,1000);assert.equal(value.componentStatesTruncated,true);assert.equal(value.componentsTruncated,true);
});
test('R15-09 full document and selected text remain exact explicit test data',t=>{
  const f=fixture(t);f.content='正文'.repeat(100000);f.raw.selectedText=f.content;assert.equal(f.api.getEditorValue(),f.content);assert.equal(f.api.snapshot().selectedText,f.content);
});
test('R15-09 context mutation during snapshot rejects a mixed-generation result',t=>{
  const f=fixture(t,{readSnapshot:()=>{f.context={...f.context,version:1};return f.raw;}});assert.throws(()=>f.api.snapshot(),/E2E snapshot unavailable/);
});
test('R15-09 context mutation during preview read rejects the result',t=>{
  const f=fixture(t,{readPreviewStats:()=>{f.context={...f.context,generation:2};return f.preview;}});assert.throws(()=>f.api.getPreviewStats(),/E2E preview stats unavailable/);
});
test('R15-09 context and metric accessor errors never expose exception text',t=>{
  const f=fixture(t);Object.defineProperty(f.raw,'documentLength',{get(){throw Error('PRIVATE');}});assert.throws(()=>f.api.snapshot(),/^Error: E2E snapshot unavailable$/);
  f.context={get documentId(){throw Error('PRIVATE');}};assert.throws(()=>f.api.getEditorValue(),/^Error: E2E operation unavailable$/);
});
test('R15-09 idle reaches a quiet stable snapshot and releases deadline frame and timer',async t=>{
  const f=fixture(t);assert.equal(await f.complete(f.api.waitForIdle()),true);assert.equal(f.calls.length,0);f.empty();
});
test('R15-09 pending presentation work prevents false idle and returns false at deadline',async t=>{
  const f=fixture(t);f.raw.pendingMermaid=1;assert.equal(await f.complete(f.api.waitForIdle({timeoutMs:250})),false);f.empty();
});
test('R15-09 pending preview enhancement prevents idle',async t=>{
  const f=fixture(t);f.preview.pendingEnhancements=1;assert.equal(await f.complete(f.api.waitForIdle({timeoutMs:250})),false);f.empty();
});
test('R15-09 paused RAF is bounded independently by the owned deadline',async t=>{
  const f=fixture(t);const waiting=f.api.revealPosition(2,{timeoutMs:250});const rejected=assert.rejects(waiting,/operation timed out/);const retained=[...f.frames.values()][0].fn;
  const [id,deadline]=[...f.timers].find(([,v])=>v.ms===250);f.timers.delete(id);deadline.fn();await rejected;retained();await tick();assert.deepEqual(f.calls,[['focus']]);f.empty();
});
test('R15-09 layout and visual actions retain legacy return values and normalize input',async t=>{
  const f=fixture(t);assert.equal(await f.complete(f.api.setLayout('invalid')), 'both');assert.equal(await f.complete(f.api.setVisualEditing({code:false,table:true})),undefined);assert.deepEqual(f.calls,[['layout','both'],['visual',{code:false,table:true}]]);f.empty();
});
test('R15-09 current layout is idempotent and still waits for real idle',async t=>{
  const f=fixture(t),waiting=f.api.setLayout('hybrid');assert.equal(f.api.getState().busy,true);
  assert.equal(await f.complete(waiting),'hybrid');assert.equal(f.calls.length,0);f.empty();
});
test('R15-09 current layout with pending work still fails at the original deadline',async t=>{
  const f=fixture(t);f.preview.pendingEnhancements=1;
  const waiting=f.api.setLayout('hybrid',{timeoutMs:250}),rejected=assert.rejects(waiting,/operation timed out/);
  await f.complete(rejected);assert.equal(f.calls.length,0);f.empty();
});
test('R15-09 reveal clamps position and sequences focus selection scroll with copied options',async t=>{
  const f=fixture(t),options={viewportRatio:2,behavior:'smooth'};const waiting=f.api.revealPosition(999,options);options.viewportRatio=0;assert.equal(await f.complete(waiting),10);assert.deepEqual(f.calls,[['focus'],['select',10],['scroll',10,'smooth',1]]);f.empty();
});
test('R15-09 preserve-selection reveal scrolls without focus or selection writes',async t=>{
  const f=fixture(t);assert.equal(await f.complete(f.api.revealPosition(-8,{preserveSelection:true})),0);assert.deepEqual(f.calls,[['scroll',0,'auto',0.5]]);f.empty();
});
test('R15-09 reveal text uses semantic find result and end edge',async t=>{
  const f=fixture(t);assert.equal(await f.complete(f.api.revealText('beta',{edge:'end',from:0,wrap:false})),10);assert.deepEqual(f.calls[0],['find','beta',0,{wrap:false}]);f.empty();
});
test('R15-09 missing text returns a fixed error without disclosing query or source',async t=>{
  const f=fixture(t);await assert.rejects(f.api.revealText('PRIVATE'),/^Error: E2E text not found$/);await assert.rejects(f.api.revealText(''),/^Error: E2E text query required$/);f.empty();
});
for(const field of ['documentId','generation','version'])test('R15-09 stale '+field+' after a frame blocks selection and scroll',async t=>{
  const f=fixture(t),waiting=f.api.revealPosition(3);const rejected=assert.rejects(waiting,/document changed/);f.context={...f.context,[field]:field==='documentId'?'other':2};await f.step();await rejected;assert.deepEqual(f.calls,[['focus']]);f.empty();
});
test('R15-09 concurrent mutation is rejected without a second side effect',async t=>{
  const f=fixture(t),first=f.api.revealPosition(2);await assert.rejects(f.api.setLayout('preview'),/operation busy/);assert.equal(await f.complete(first),2);assert.equal(f.calls.some(x=>x[0]==='layout'),false);f.empty();
});
test('R15-09 idle request pressure is bounded to eight owned operations',async t=>{
  const f=fixture(t),requests=Array.from({length:9},()=>f.api.waitForIdle());assert.equal(await requests[8],false);assert.equal(f.api.getState().activeOperations,8);f.api.destroy();assert.deepEqual(await Promise.all(requests.slice(0,8)),Array(8).fill(false));f.empty();
});
test('R15-09 successful import intentionally adopts its returned identity then uses formal actions',async t=>{
  const f=fixture(t);const result=await f.complete(f.api.loadMarkdown('title\n```js\nhello\n```',{name:'fixture.md',layout:'preview',focusText:'hello',codeVisualEditing:false}));
  assert.equal(result.documentId,'doc-2');assert.equal(result.documentGeneration,2);assert.equal(result.documentVersion,0);assert.equal(result.layout,'preview');assertFrozen(result);assert.deepEqual(f.calls[0],['import','title\n```js\nhello\n```','fixture.md']);assert.deepEqual(f.calls.find(x=>x[0]==='visual'),['visual',{code:false,table:true}]);assert.equal(result.selectionStart,12);f.empty();
});
test('R15-09 load chooses first non-Mermaid fence when no selection is supplied',async t=>{
  const f=fixture(t),source='```mermaid\nA-->B\n```\n```js\nconst x=1\n```';const result=await f.complete(f.api.loadMarkdown(source));assert.equal(result.selectionStart,source.indexOf('const x'));f.empty();
});
for(const [name,source,target] of [
  ['longer Mermaid fence containing shorter fences','````mermaid\n```js\ninside\n```\n````\n```js\noutside\n```','outside'],
  ['tilde Mermaid fence and indented code','~~~mermaid\nA-->B\n~~~\n  ~~~js\noutside\n  ~~~','outside'],
  ['inline backticks before a real fence','text ```js\ninline\n```js\noutside\n```','outside'],
  ['unclosed Mermaid fence','```mermaid\nA-->B\n```js\ninside',null],
  ['Mermaid-only document','```mermaid\nA-->B\n```',null]
])test('R15-09 default focus handles '+name,async t=>{
  const f=fixture(t),result=await f.complete(f.api.loadMarkdown(source));
  assert.equal(result.selectionStart,target===null?0:source.indexOf(target));f.empty();
});
test('R15-09 load preserves an already selected layout without replaying its command',async t=>{
  const f=fixture(t),result=await f.complete(f.api.loadMarkdown('body',{layout:'hybrid'}));
  assert.equal(result.layout,'hybrid');assert.equal(result.documentLength,4);
  assert.equal(f.calls.some(row=>row[0]==='layout'),false);f.empty();
});
test('R15-09 load accepts formal editor newline normalization and locates normalized focus',async t=>{
  const f=fixture(t);const result=await f.complete(f.api.loadMarkdown('title\r\nbody\rrest',{focusText:'rest'}));assert.equal(f.api.getEditorValue(),'title\nbody\nrest');assert.equal(result.documentLength,15);assert.equal(result.selectionStart,11);f.empty();
});
test('R15-09 import false or rejection never applies later layout and editing actions',async t=>{
  for(const mode of ['false','throw']){const f=fixture(t,{importDocument:()=>mode==='false'?{loaded:false}:Promise.reject(Error('PRIVATE'))});await assert.rejects(f.api.loadMarkdown('fixture'),mode==='false'?/document import rejected/:/^Error: E2E action failed$/);assert.equal(f.calls.length,0);f.empty();}
});
test('R15-09 import content mismatch and stale returned context are rejected',async t=>{
  const f=fixture(t,{importDocument:()=>({loaded:true,context:{...f.context}})});await assert.rejects(f.api.loadMarkdown('other'),/document import mismatch/);f.empty();
  const g=fixture(t,{importDocument:()=>({loaded:true,context:{documentId:'other',generation:1,version:0}})});await assert.rejects(g.api.loadMarkdown('other'),/document changed/);g.empty();
});
test('R15-09 timed-out unresolved import cannot publish or schedule later work',async t=>{
  let resolve;const f=fixture(t,{importDocument:()=>new Promise(r=>{resolve=r;})});const waiting=f.api.loadMarkdown('fixture',{timeoutMs:250}),rejected=assert.rejects(waiting,/operation timed out/);await f.step();await rejected;resolve({loaded:true,context:{...f.context}});await tick();assert.equal(f.calls.length,0);f.empty();
});
test('R15-09 destroy rejects pending action cancels zero-valued handles and ignores retained callbacks',async t=>{
  const f=fixture(t),waiting=f.api.revealPosition(2),rejected=assert.rejects(waiting,/query destroyed/),old=[...f.frames.values()].map(x=>x.fn);assert.ok(f.timers.has(0));f.api.destroy();f.api.destroy();await rejected;old.forEach(fn=>fn());await tick();assert.deepEqual(f.calls,[['focus']]);f.empty();assert.equal(f.api.getState().destroyed,true);
});
test('R15-09 destroyed owner refuses all reads actions and storage without accessing ports',async t=>{
  const f=fixture(t);f.api.destroy();for(const read of ['snapshot','getComponentStates','getPreviewStats','getEditorValue','clearStorage'])assert.throws(()=>f.api[read](),/query unavailable/);await assert.rejects(f.api.setLayout('edit'),/query unavailable/);assert.equal(await f.api.waitForIdle(),false);assert.equal(f.calls.length,0);f.empty();
});
test('R15-09 destroy during import consumes a late rejection without later action',async t=>{
  let reject;const f=fixture(t,{importDocument:()=>new Promise((_,r)=>{reject=r;})}),waiting=f.api.loadMarkdown('fixture'),rejected=assert.rejects(waiting,/query destroyed/);f.api.destroy();await rejected;reject(Error('PRIVATE'));await tick();assert.equal(f.calls.length,0);f.empty();
});
test('R15-09 port failure is fixed and releases the action lock',async t=>{
  const f=fixture(t,{setLayout:()=>{throw Error('PRIVATE');}});await assert.rejects(f.api.setLayout('edit'),/^Error: E2E port unavailable$/);assert.equal(f.api.getState().busy,false);f.empty();
});
test('R15-09 invalid option accessor is fixed and allocates no work',async t=>{
  const f=fixture(t);await assert.rejects(f.api.revealPosition(2,{get timeoutMs(){throw Error('PRIVATE');}}),/^Error: E2E options unavailable$/);assert.equal(f.calls.length,0);f.empty();
});
test('R15-09 frame or deadline scheduling failure releases every owned resource',async t=>{
  for(const name of ['requestFrame','schedule']){const f=fixture(t,{[name]:()=>{throw Error('PRIVATE');}});await assert.rejects(f.api.revealPosition(2),name==='schedule'?/^Error: E2E operation unavailable$/:/^Error: E2E wait unavailable$/);f.empty();}
});
test('R15-09 cancel failure reports physical uncertainty and blocks further work',async t=>{
  const f=fixture(t,{cancelFrame:()=>{throw Error('PRIVATE');}});const waiting=f.api.revealPosition(2),rejected=assert.rejects(waiting,/query unavailable/);await f.step();await rejected;assert.equal(f.api.getState().cleanupFailed,true);assert.throws(()=>f.api.snapshot(),/query unavailable/);assert.equal(f.timers.size,0);assert.equal(f.api.getState().activeOperations,0);
});
test('R15-09 synchronous deadline and reentrant destroy do not invoke action ports',async t=>{
  const f=fixture(t,{schedule:fn=>{fn();return 0;}});await assert.rejects(f.api.setLayout('edit'),/operation timed out/);assert.equal(f.calls.length,0);f.empty();
  const g=fixture(t,{schedule:()=>{g.api.destroy();return 0;}});await assert.rejects(g.api.setLayout('edit'),/operation timed out/);assert.equal(g.calls.length,0);g.empty();
});
test('R15-09 storage clear is explicit and cannot race any active request',async t=>{
  const f=fixture(t);assert.equal(f.api.clearStorage(),true);const waiting=f.api.waitForIdle();assert.throws(()=>f.api.clearStorage(),/operation busy/);assert.equal(await f.complete(waiting),true);assert.deepEqual(f.calls,[['clear']]);f.empty();
});

function browserHost(t) {
  const saved=new Map(),set=(name,value)=>{saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});};
  const context={documentId:'host-document',generation:3,version:4};
  class Element {}
  const editor={value:'host text',textLength:9,selectionStart:0,selectionEnd:4,virtualEditor:{getPresentationMode:()=> 'hybrid',getPresentationStats:()=>({visibleLines:1}),getHybridComponentStates:()=>[{type:'code',details:{private:true}}]}};
  set('__MARKDOWN_EDITOR_E2E__',true);set('Element',Element);set('document',{getElementById:id=>id==='editor'?editor:null,querySelector:()=>null,querySelectorAll:()=>[],activeElement:null,body:{classList:{contains:()=>false}},documentElement:{classList:{contains:()=>true}}});
  set('localStorage',{getItem:()=>null,clear:()=>{}});set('__markdownEditorE2E',undefined);
  t.after(()=>{destroyMarkdownEditorE2EBridge();for(const[name,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  return {context,editor,set,configure:()=>configureMarkdownEditorE2EPorts({setLayout: mode=>globalThis.setLayoutMode(mode,false),readContext:()=>context,readPreviewStats:()=>({active:true,blocks:1})})};
}
test('R15-09 actual Runtime installs the sole public owner and returns detached DOM-free snapshots',t=>{
  const h=browserHost(t);h.configure();const api=installMarkdownEditorE2EBridge();assert.equal(globalThis.__markdownEditorE2E,api);assert.equal(installMarkdownEditorE2EBridge(),null);assert.equal(api.snapshot().documentVersion,4);assert.equal(api.getPreviewStats().blocks,1);assert.equal(api.getEditorValue(),'host text');assert.equal(api.getComponentStates()[0].details,undefined);assertFrozen(api.snapshot());destroyMarkdownEditorE2EBridge();assert.equal(api.getState().destroyed,true);assert.equal(globalThis.__markdownEditorE2E,undefined);
});
test('R15-09 actual Runtime cleanup preserves a later external global replacement',t=>{
  const h=browserHost(t);h.configure();const api=installMarkdownEditorE2EBridge(),replacement={external:true};Object.defineProperty(globalThis,'__markdownEditorE2E',{configurable:true,value:replacement});destroyMarkdownEditorE2EBridge();assert.equal(api.getState().destroyed,true);assert.equal(globalThis.__markdownEditorE2E,replacement);
});
test('R15-09 actual Runtime retains the existing explicit opt-in gate and cold default',t=>{
  const h=browserHost(t);globalThis.__MARKDOWN_EDITOR_E2E__=false;h.set('location',{href:'http://localhost/'});h.configure();assert.equal(installMarkdownEditorE2EBridge(),null);globalThis.location.href='http://localhost/?e2e=1';h.configure();assert.ok(installMarkdownEditorE2EBridge());
});
