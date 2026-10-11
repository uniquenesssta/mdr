import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createPdfExporter, createPdfPrintSurface, mountClassicPdfExportPort, createExportTaskController, createExportRequest, isExportCancelledError } from '../src/features/export/index.js';
import { createBrowserPrint } from '../src/platform/index.js';
import { createExportPrintDom } from './support/export-print-dom.mjs';
import { createExportVmHost } from './support/export-vm-host.mjs';

const fontCss = '@font-face {font-family:KaTeX_Main;src:url("data:font/woff2;base64,AA==");}';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const cancelled = reason => error => isExportCancelledError(error) && error.reason === reason;
function setup({ text='<h1>中文 😀</h1>', onPrint, faces=[] }={}) {
  const calls=[],tasks=createExportTaskController(),state={generation:1,activeId:'doc',version:7,removed:false};
  const dom=createExportPrintDom({fontFaces:faces,onPrint:frame=>{calls.push(['print',frame]);return onPrint?.(frame);}});
  const documentModel={getDocumentVersion:()=>state.version},documents={get generation(){return state.generation;},get activeId(){return state.activeId;},
    getRecord:id=>!state.removed&&['doc','other'].includes(id)?{id}:null,isCurrentGeneration:g=>g===state.generation};
  const body=dom.makeNode('div');body.innerHTML=text;body.className='markdown-body';
  const builder={async build(){calls.push(['build']);return body;},getSourceContext:()=>({documentId:'doc',documentVersion:7})};
  const enhancer={async enhance(){calls.push(['enhance']);}},assets={async load(){calls.push(['assets']);return fontCss;}};
  const styles={getCss:format=>'.export-document[data-export-format="'+format+'"] {color:#000;}'};
  const surface=createPdfPrintSurface({documentRef:dom.document,styles,printWindow:window=>createBrowserPrint({windowObject:window}).print(),setTimer:dom.setTimer,clearTimer:dom.clearTimer});
  const deps={documentModel,documents,builder,enhancer,assets,surface,taskController:tasks},owner=createPdfExporter(deps);
  const request=input=>createExportRequest({format:'pdf',documentId:'doc',name:'report.md',...input});
  return {calls,tasks,state,dom,body,builder,enhancer,assets,styles,surface,deps,owner,request};
}

test('R14-12 fixed PDF validates identity and format before tasks, body or frame effects',async()=>{
  const h=setup();for(const input of [undefined,h.request({format:'html'}),h.request({documentId:'missing'}),{format:'pdf',documentId:'doc',name:'bad\0'}])await assert.rejects(h.owner.export({request:input}));
  await assert.rejects(h.owner.export({request:h.request({documentId:'other'})}),cancelled('document-changed'));
  assert.equal(h.tasks.getSnapshot().lastTaskId,0);assert.deepEqual(h.calls,[]);assert.equal(h.dom.frames.length,0);
});

for(const completion of ['afterprint','timeout'])for(const text of ['', '<h1>中文 😀</h1>', '<p>中文 😀</p>'.repeat(30000)]){
  test(`R14-12 complete isolated body (${text.length}) releases exactly once by ${completion}`,async()=>{
    const h=setup({text}),request=h.request({name:'A<&".PDF'}),work=h.owner.export({request});await h.dom.untilScheduled();
    const frame=h.dom.frames[0],doc=frame.contentDocument,root=doc.body.children[0];
    assert.equal(doc.title,request.name.replace(/\.pdf$/i,''));assert.equal(root.innerHTML,text);assert.equal(root.dataset.exportFormat,'pdf');assert.ok(root.classList.contains('export-document'));
    assert.equal(h.body.dataset.exportFormat,undefined);assert.equal(h.body.parentNode,undefined);
    assert.ok(doc.head.children.some(x=>x.textContent===h.styles.getCss('pdf')));assert.ok(doc.head.children.some(x=>x.textContent===fontCss));
    assert.equal(frame.attributes['aria-hidden'],'true');assert.equal(frame.tabIndex,-1);assert.equal(frame.src,undefined);
    await h.dom.fire(80);assert.equal(h.tasks.getSnapshot().activeTask.phase,'printing');assert.equal(h.tasks.cancel(),false);assert.equal(h.tasks.begin('busy'),null);
    assert.equal((await h.owner.export({request:h.request()})).status,'busy');
    if(completion==='afterprint')frame.contentWindow.dispatchEvent({type:'afterprint'});else await h.dom.fire(1200);
    const result=await work;assert.equal(result.status,'printed');assert.equal(result.completion,completion);assert.equal(h.calls.filter(x=>x[0]==='print').length,1);
    assert.equal(frame.parentNode,null);assert.equal(frame.listeners.size,0);assert.ok(h.dom.timers.every(x=>x.cancelled));assert.equal(h.tasks.getSnapshot().activeTask,null);
    frame.contentWindow.dispatchEvent({type:'afterprint'});h.surface.destroy();h.owner.destroy();
  });
}

for(const phase of ['build','enhance','assets','ready','scheduled'])for(const action of ['cancel','replace','destroy']){
  test(`R14-12 ${action} during ${phase} gives zero prints and cannot finish a replacement task`,async()=>{
    const h=setup(),gate=deferred(),entered=deferred(),pause=()=>{entered.resolve();return gate.promise;};
    let owner=h.owner;
    if(phase==='build')h.builder.build=pause;if(phase==='enhance')h.enhancer.enhance=pause;if(phase==='assets')h.assets.load=pause;
    if(phase==='ready')owner=createPdfExporter({...h.deps,surface:{mount(){entered.resolve();return {ready:gate.promise,print(){throw new Error('Must not print');},release(){h.calls.push(['release']);}};}}});
    const work=owner.export({request:h.request()});
    if(phase==='scheduled')await h.dom.untilScheduled();else await entered.promise;
    const savedTimer=h.dom.nextTimer(80);let next;
    if(action==='cancel')assert.equal(h.tasks.cancel(),true);else if(action==='replace')next=h.tasks.begin('next');else owner.destroy();
    await assert.rejects(work,cancelled(action==='cancel'?'cancelled':action==='replace'?'replaced':'destroyed'));
    gate.reject(new Error('late preparation failure'));if(phase==='scheduled')gate.promise.catch(()=>{});
    await Promise.resolve();if(savedTimer)await savedTimer.callback();
    assert.equal(h.calls.some(x=>x[0]==='print'),false);assert.equal(h.tasks.getSnapshot().activeTask?.id??null,next?.id??null);
    assert.ok(h.dom.frames.every(x=>x.parentNode===null));if(next)h.tasks.finish(next);h.surface.destroy();
  });
}

test('R14-12 source context and document changes during the scheduled delay cannot publish stale content',async()=>{
  for(const change of ['source-id','source-version','generation','activeId','version','removed']){
    const h=setup();if(change.startsWith('source'))h.builder.getSourceContext=()=>({documentId:change==='source-id'?'other':'doc',documentVersion:change==='source-version'?8:7});
    const work=h.owner.export({request:h.request()});
    if(!change.startsWith('source')){await h.dom.untilScheduled();h.state[change]=change==='removed'?true:change==='activeId'?'other':99;await h.dom.fire(80);}
    await assert.rejects(work,cancelled('document-changed'));assert.equal(h.calls.some(x=>x[0]==='print'),false);assert.equal(h.tasks.getSnapshot().activeTask,null);
    assert.ok(h.dom.frames.every(x=>x.parentNode===null));
  }
});

test('R14-12 serializing and printing progress reentry blocks publication before the platform call',async()=>{
  for(const phase of ['serializing','printing']){
    const h=setup(),off=h.tasks.subscribe(s=>{if(s.activeTask?.phase===phase)h.state.version++;});
    const work=h.owner.export({request:h.request()});if(phase==='printing'){await h.dom.untilScheduled();await h.dom.fire(80);}
    await assert.rejects(work,cancelled('document-changed'));off();assert.equal(h.calls.some(x=>x[0]==='print'),false);assert.equal(h.tasks.getSnapshot().activeTask,null);
  }
});

test('R14-12 original dependency and platform errors preserve identity and clean up all owned resources',async()=>{
  for(const phase of ['build','enhance','assets','mount','print']){
    const h=setup(),error=new Error(phase),bad=()=>{throw error;};let owner=h.owner;
    if(phase==='build')h.builder.build=bad;if(phase==='enhance')h.enhancer.enhance=bad;if(phase==='assets')h.assets.load=bad;
    if(phase==='mount')owner=createPdfExporter({...h.deps,surface:{mount:bad}});
    const work=owner.export({request:h.request()});if(phase==='print'){await h.dom.untilScheduled();h.dom.frames[0].contentWindow.print=bad;await h.dom.fire(80);}
    await assert.rejects(work,e=>e===error);assert.equal(h.tasks.getSnapshot().activeTask,null);assert.ok(h.dom.frames.every(x=>x.parentNode===null));
  }
});

test('R14-12 synchronous afterprint keeps the frame alive until blocking print returns',async()=>{
  const h=setup({onPrint:frame=>{frame.contentWindow.dispatchEvent({type:'afterprint'});assert.ok(frame.parentNode);}});
  const work=h.owner.export({request:h.request()});await h.dom.untilScheduled();await h.dom.fire(80);assert.equal((await work).completion,'afterprint');
  assert.equal(h.dom.nextTimer(1200),undefined);assert.equal(h.dom.frames[0].parentNode,null);
});

test('R14-12 asynchronous platform print schedules recovery only after return and destruction observes late failure',async()=>{
  const gate=deferred(),h=setup({onPrint:()=>gate.promise}),work=h.owner.export({request:h.request()});await h.dom.untilScheduled();
  const timer=h.dom.nextTimer(80);timer.cancelled=true;const callback=timer.callback();await Promise.resolve();
  assert.equal(h.dom.nextTimer(1200),undefined);assert.equal(h.tasks.cancel(),false);h.owner.destroy();h.owner.destroy();
  await assert.rejects(work,cancelled('destroyed'));gate.reject(new Error('late print failure'));await callback;
  assert.equal(h.dom.frames[0].parentNode,null);assert.equal(h.dom.frames[0].listeners.size,0);assert.equal(h.dom.nextTimer(1200),undefined);assert.equal(h.tasks.getSnapshot().activeTask,null);
});

test('R14-12 late events and fallback callbacks from the old print never affect a newer task or surface',async()=>{
  const h=setup(),first=h.owner.export({request:h.request()});await h.dom.untilScheduled();await h.dom.fire(80);
  const frame=h.dom.frames[0],fallback=h.dom.nextTimer(1200),event=frame.listeners.get('afterprint');event();await first;
  const next=h.tasks.begin('new');event();await fallback.callback();assert.equal(h.tasks.getSnapshot().activeTask.id,next.id);
  assert.equal(h.dom.frames[0].parentNode,null);h.tasks.finish(next);
});

test('R14-12 print surface requires preparation, waits each embedded face and releases on readiness timeout/failure',async()=>{
  for(const failure of ['timeout','font-error']){
    const gate=deferred(),loaded=[],h=setup({faces:[{load(){loaded.push('face');return gate.promise;}}]});
    const lease=h.surface.mount({body:h.body,name:'Fonts.pdf',fontCss});assert.deepEqual(loaded,['face']);
    await assert.rejects(lease.print({beforePrint(){}}),/prepared/);
    if(failure==='timeout')await h.dom.fire(10000);else gate.reject(new Error('font failed'));
    await assert.rejects(lease.ready,new RegExp(failure==='timeout'?'timed out':'font failed'));
    lease.release();assert.equal(h.dom.frames[0].parentNode,null);assert.ok(h.dom.timers.every(x=>x.cancelled));gate.resolve();h.surface.destroy();
  }
});

test('R14-12 isolated document construction and timer/cleanup failures never strand a frame or listener',async()=>{
  for(const failure of ['import','schedule','clear']){
    const h=setup(),create=h.dom.document.createElement;
    if(failure==='import')h.dom.document.createElement=tag=>{const n=create(tag);if(tag==='iframe')n.contentDocument.importNode=()=>{throw new Error('import failed');};return n;};
    const surface=createPdfPrintSurface({documentRef:h.dom.document,styles:h.styles,printWindow:w=>w.print(),setTimer:(f,ms)=>{if(failure==='schedule'&&ms===80)throw new Error('schedule failed');return h.dom.setTimer(f,ms);},clearTimer:id=>{h.dom.clearTimer(id);if(failure==='clear')throw new Error('clear failed');}});
    if(failure==='import')assert.throws(()=>surface.mount({body:h.body,name:'test.pdf',fontCss}),/import failed/);
    else {const lease=surface.mount({body:h.body,name:'test.pdf',fontCss});
      if(failure==='clear'){await assert.rejects(lease.ready,/clear failed/);}
      else {await lease.ready;await assert.rejects(lease.print({beforePrint(){}}),/schedule failed/);}}
    assert.ok(h.dom.frames.every(x=>x.parentNode===null&&x.listeners.size===0));surface.destroy();
  }
});

test('R14-12 surface and owner destruction are independent, idempotent and reject late work',async()=>{
  const h=setup(),work=h.owner.export({request:h.request()});await h.dom.untilScheduled();h.surface.destroy();h.surface.destroy();
  await assert.rejects(work,cancelled('destroyed'));assert.equal(h.tasks.getSnapshot().activeTask,null);h.owner.destroy();h.owner.destroy();
  await assert.rejects(h.owner.export({request:h.request()}),cancelled('destroyed'));assert.throws(()=>h.surface.mount({body:h.body,name:'late.pdf',fontCss}),cancelled('destroyed'));
});

test('R14-12 readonly scoped PDF bridge unmounts only its property and never destroys the owner',async()=>{
  const h=setup(),host={},mount=mountClassicPdfExportPort(host,h.owner);assert.equal(Object.keys(host).length,0);assert.ok(Object.isFrozen(mount.port));
  assert.throws(()=>mountClassicPdfExportPort(host,h.owner),/already/);const replacement={};Object.defineProperty(host,'markdownEditorPdfExportPort',{configurable:true,value:replacement});
  mount.destroy();mount.destroy();assert.equal(host.markdownEditorPdfExportPort,replacement);assert.throws(()=>mount.port.export({request:h.request()}),/destroyed/);
  const work=h.owner.export({request:h.request()});await h.dom.untilScheduled();await h.dom.fire(80);await h.dom.fire(1200);await work;
});

test('R14-12 actual classic command shares resources and preserves Preview/Hybrid view without private print orchestration',async()=>{
  for(const view of ['source','preview','hybrid']){
    const h=createExportVmHost({sourceText:'中文 😀 $x^2$',name:'source.md'}),port=h.context.document.getElementById('compatibility-business-ports').markdownEditorPreviewCommandPort;
    port.setViewMode(view);const before=h.calls.length,preview=h.context.preview;
    try {const work=h.invoke('exportPDF');await h.printDom.untilScheduled();const frame=h.printDom.frames[0];
      assert.ok(frame.contentDocument.body.children[0].innerHTML.includes('中文'));assert.equal(frame.contentDocument.head.children.find(x=>x.dataset.exportFonts==='katex').textContent.match(/@font-face/g).length,20);
      await h.printDom.fire(80);frame.contentWindow.dispatchEvent({type:'afterprint'});await work;
      assert.equal(port.getViewMode(),view);assert.equal(h.context.preview,preview);assert.equal(h.calls.slice(before).some(x=>['view','reset','deactivateVirtual'].includes(x[0])),false);
      assert.equal(h.taskPort.getSnapshot().activeTask,null);
      const classic=readFileSync(new URL('../public/app/export.js',import.meta.url),'utf8').split('async function exportPDF()')[1].split('function toggleExportMenu()')[0];
      assert.doesNotMatch(classic,/replaceChildren|afterprint|setTimeout|\.print\(|\.reset\(|\.build\(|\.enhance\(/);
    }finally{h.destroy();}
  }
});
