import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createImageExporter, mountClassicImageExportPort, isExportCancelledError } from '../src/features/export/index.js';
import { createExportVmHost } from './support/export-vm-host.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const signature = [137,80,78,71,13,10,26,10];
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes;reject=no; }); return { promise, resolve, reject }; };
const cancelled = reason => error => isExportCancelledError(error) && error.reason === reason;
const fixture = (t, options) => { const h=createExportVmHost(options);t.after(()=>h.destroy());return h; };
const host = h => h.context.document.getElementById('compatibility-business-ports');
const request = (h, options={}) => host(h).markdownEditorExportRequestPort.createRequest({ format:'image',name:h.context.filenameInput.value,
  directory:h.context.exportDirectory,documentId:h.context.getActiveDocumentId(),imageOptions:{ratio:'9:16',cropFit:false},...options });
const idle = h => { assert.equal(h.taskController.getSnapshot().activeTask,null);assert.equal(h.nodes.get('export-image-content')?.children.length||0,0); };
async function until(condition) { for(let i=0;i<100;i++){if(condition())return;await Promise.resolve();}throw new Error('Expected image workflow boundary was not reached'); }
function holdPng(h) {
  const entered=deferred(),done=deferred();
  host(h).markdownEditorPresentationPort.loadDomToImage=async()=>({ toPng(root,options) { entered.resolve({root,options});return done.promise; } });
  return {entered,done};
}

for(const desktop of [false,true])test('R14-16 full public image workflow composes body/layout/assets/PNG and exact '+(desktop?'native':'browser')+' binary output',async t=>{
  const h=fixture(t,{desktop,sourceText:'完整正文 原文😀',name:'A&B😀.md'}),input=request(h);
  assert.equal((await h.imageExporter.render({request:input})).status,'ready');
  const png=h.calls.find(row=>row[0]==='png');assert.ok(png[2].includes('完整正文 原文😀'));assert.equal(png[1].width,1080);assert.equal(png[1].height,1920);
  assert.equal(png[1].imagePlaceholder,h.imageAssets.placeholder);idle(h);
  const snapshot=h.imageExporter.getPreview();assert.equal(Object.isFrozen(snapshot),true);assert.equal(snapshot.documentVersion,7);
  assert.equal(Object.isFrozen(snapshot.imageOptions),true);assert.equal('bytes' in snapshot,false);
  assert.equal(h.captureRoots.at(-1).parentNode,null);assert.equal(h.captureRoots.at(-1).hasAttribute('data-export-image-layout'),false);
  const saved=await h.imageExporter.save({request:input});assert.equal(saved.status,desktop?'written':'downloaded');
  const write=h.calls.find(row=>row[0]==='writeBinary');assert.deepEqual(Array.from(write[2]),signature);assert.equal(write[3].reason,'export');idle(h);
  if(!desktop){assert.equal(h.downloads[0].blob.type,'image/png');assert.ok(h.calls.some(row=>row[0]==='revoke'));}
});

test('R14-16 missing preview never opens a dialog or starts a task',async t=>{
  const h=fixture(t,{desktop:true});assert.equal((await h.imageExporter.save({request:request(h)})).status,'no-preview');
  assert.equal(h.taskController.getSnapshot().lastTaskId,0);assert.equal(h.calls.length,0);
});

for(const change of ['version','active-document','generation','deleted-record'])test('R14-16 cached '+change+' change blocks stale bytes before any dialog',async t=>{
  const h=fixture(t,{desktop:true,documentIds:['export-doc','other']}),input=request(h);
  await h.imageExporter.render({request:input});
  if(change==='version')h.context.documentModel.getDocumentVersion=()=>8;
  if(change==='active-document')h.context.getActiveDocumentId=()=>'other';
  if(change==='generation'){h.context.coreDocumentControllerPort.generation=2;h.context.coreDocumentControllerPort.isCurrentGeneration=value=>value===2;}
  if(change==='deleted-record')h.context.coreDocumentSessionPort.getRecord=()=>null;
  await assert.rejects(h.imageExporter.save({request:request(h)}),error=>isExportCancelledError(error)||error instanceof TypeError);
  assert.equal(h.imageExporter.getPreview(),null);assert.equal(h.calls.some(row=>['saveFile','writeBinary'].includes(row[0])),false);idle(h);
});

for(const options of [{ratio:'1:1',cropFit:false},{ratio:'9:16',cropFit:true}])test('R14-16 different requested geometry never downloads a prior PNG: '+JSON.stringify(options),async t=>{
  const h=fixture(t);await h.imageExporter.render({request:request(h)});
  await assert.rejects(h.imageExporter.save({request:request(h,{imageOptions:options})}),cancelled('image-options-changed'));
  assert.equal(h.downloads.length,0);idle(h);
});

test('R14-16 conversion stays locked, retains capture leases, blocks replacement and publishes only after settlement',async t=>{
  const h=fixture(t),held=holdPng(h),input=request(h),work=h.imageExporter.render({request:input});
  const {root}=await held.entered.promise;assert.equal(root.dataset.exportFormat,'image');assert.ok(root.parentNode);
  assert.equal(h.taskController.getSnapshot().activeTask.phase,'encoding');assert.equal(h.taskController.cancel(),false);
  assert.equal((await h.imageExporter.render({request:input})).status,'busy');assert.equal(h.imageExporter.getPreview(),null);
  assert.equal(h.taskController.begin('another output'),null);held.done.resolve(PNG);await work;
  assert.equal(h.imageData(),PNG);assert.equal(root.parentNode,null);assert.equal(root.dataset.exportFormat,undefined);idle(h);
});

for(const late of ['resolve','reject'])test('R14-16 independent destroy observes late PNG '+late+' without premature vendor cancellation or publication',async t=>{
  const h=fixture(t),held=holdPng(h),work=h.imageExporter.render({request:request(h)}),{root}=await held.entered.promise;
  const rejected=assert.rejects(work,cancelled('destroyed'));h.imageExporter.destroy();h.imageExporter.destroy();
  assert.ok(root.parentNode);assert.equal(root.dataset.exportFormat,'image');assert.equal(h.taskController.getSnapshot().activeTask.phase,'encoding');
  assert.throws(()=>h.imageExporter.getPreview(),cancelled('destroyed'));
  late==='resolve'?held.done.resolve(PNG):held.done.reject(new Error('late encoder failure'));await rejected;
  assert.equal(root.parentNode,null);assert.equal(h.context.document.getElementById('export-image-preview').src,undefined);idle(h);
});

test('R14-16 a document edit during real pending encoding discards the result and next rendering recovers',async t=>{
  const h=fixture(t),held=holdPng(h),work=h.imageExporter.render({request:request(h)});await held.entered.promise;
  const rejected=assert.rejects(work,cancelled('document-changed'));h.context.documentModel.getDocumentVersion=()=>8;held.done.resolve(PNG);await rejected;
  assert.equal(h.imageExporter.getPreview(),null);idle(h);await h.renderImage(PNG);assert.equal(h.imageExporter.getPreview().documentVersion,8);
});

for(const phase of ['loading','building','enhancing','images','encoding'])test('R14-16 reentrant '+phase+' source changes prevent PNG publication',async t=>{
  const h=fixture(t);let changed=false;
  const dispose=h.taskController.subscribe(snapshot=>{if(!changed&&snapshot.activeTask?.phase===phase){changed=true;h.context.documentModel.getDocumentVersion=()=>8;}});t.after(dispose);
  await assert.rejects(h.imageExporter.render({request:request(h)}),cancelled('document-changed'));assert.equal(changed,true);assert.equal(h.imageExporter.getPreview(),null);idle(h);
});

for(const action of ['cancel','replace','destroy'])test('R14-16 pending library '+action+' detaches preparation and consumes its late rejection',async t=>{
  const h=fixture(t),entered=deferred(),done=deferred();host(h).markdownEditorPresentationPort.loadDomToImage=()=>{entered.resolve();return done.promise;};
  const work=h.imageExporter.render({request:request(h)});await entered.promise;
  const rejected=assert.rejects(work,cancelled(action==='cancel'?'cancelled':action==='replace'?'replaced':'destroyed'));
  if(action==='cancel')h.taskController.cancel();else if(action==='replace')h.taskController.begin('replacement');else h.imageExporter.destroy();
  await rejected;done.reject(new Error('late module error'));await Promise.resolve();assert.equal(h.calls.some(row=>row[0]==='png'),false);
  if(action==='replace'){assert.equal(h.taskController.getSnapshot().activeTask.title,'replacement');h.taskController.finish(h.taskController.begin('cleanup'));}else idle(h);
});

test('R14-16 pending Builder frame cancellation releases without resolving the frame or snapshotting',async t=>{
  const h=fixture(t),frames=[];h.context.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
  const work=h.imageExporter.render({request:request(h)});await until(()=>frames.length>0);
  const rejected=assert.rejects(work,cancelled('cancelled'));h.taskController.cancel();await rejected;
  frames.forEach(callback=>callback());await Promise.resolve();assert.equal(h.calls.some(row=>row[0]==='snapshot'||row[0]==='png'),false);idle(h);
});

test('R14-16 reentrant begin replacement keeps the newer render revision and cannot clear its preview',async t=>{
  const h=fixture(t),input=request(h);let replaced=false,replacement;
  const dispose=h.taskController.subscribe(snapshot=>{
    if(!replaced&&snapshot.activeTask?.phase==='preparing'){
      replaced=true;replacement=h.imageExporter.render({request:input});
    }
  });t.after(dispose);
  await assert.rejects(h.imageExporter.render({request:input}),cancelled('replaced'));
  assert.equal((await replacement).status,'ready');assert.equal(h.imageData(),PNG);
  assert.equal(h.calls.filter(row=>row[0]==='png').length,1);idle(h);
});

for(const fault of ['library','encoder','decode','cleanup'])test('R14-16 '+fault+' failure releases capture/task/cache and next rendering succeeds',async t=>{
  const h=fixture(t),presentation=host(h).markdownEditorPresentationPort;let root;
  if(fault==='library')presentation.loadDomToImage=async()=>{throw new Error('load failed');};
  else presentation.loadDomToImage=async()=>({async toPng(value){root=value;
    if(fault==='encoder')throw new Error('PNG failed');
    if(fault==='decode')return 'data:image/png;base64,!';
    const remove=value.style.removeProperty.bind(value.style);let first=true;
    value.style.removeProperty=name=>{if(first&&name==='--export-image-width'){first=false;throw new Error('cleanup failed');}return remove(name);};return PNG;
  }});
  await assert.rejects(h.imageExporter.render({request:request(h)}));assert.equal(h.imageExporter.getPreview(),null);if(root)assert.equal(root.parentNode,null);idle(h);
  await h.renderImage(PNG);assert.equal(h.imageData(),PNG);idle(h);
});

for(const action of ['cancel','edit','replace','destroy'])test('R14-16 pending native dialog '+action+' cannot write after it returns',async t=>{
  const h=fixture(t,{desktop:true});await h.renderImage(PNG);const entered=deferred(),done=deferred(),port=host(h).markdownEditorPlatformPort,original=port.call;
  port.call=(area,method,...args)=>{if(method==='saveFile'){entered.resolve();return done.promise;}return original(area,method,...args);};
  const work=h.imageExporter.save({request:request(h)});await entered.promise;
  const reason=({cancel:'cancelled',edit:'document-changed',replace:'replaced',destroy:'destroyed'})[action],rejected=assert.rejects(work,cancelled(reason));
  if(action==='cancel')h.taskController.cancel();if(action==='edit')h.context.documentModel.getDocumentVersion=()=>8;
  if(action==='replace')h.taskController.begin('replacement');if(action==='destroy')h.imageExporter.destroy();
  done.resolve('C:\\owned\\late.png');await rejected;assert.equal(h.calls.some(row=>row[0]==='writeBinary'),false);
  if(action!=='replace')idle(h);
});

test('R14-16 already started binary write stays locked and rejects a late error after destruction',async t=>{
  const h=fixture(t,{desktop:true});await h.renderImage(PNG);const entered=deferred(),done=deferred(),port=host(h).markdownEditorPlatformPort,original=port.call;
  port.call=(area,method,...args)=>{if(method==='writeBinary'){entered.resolve(args);return done.promise;}return original(area,method,...args);};
  const work=h.imageExporter.save({request:request(h)}),args=await entered.promise;assert.deepEqual(Array.from(args[1]),signature);
  assert.equal(h.taskController.getSnapshot().activeTask.phase,'writing');assert.equal(h.taskController.cancel(),false);
  assert.equal((await h.imageExporter.render({request:request(h)})).status,'busy');
  const rejected=assert.rejects(work,cancelled('destroyed'));h.imageExporter.destroy();done.reject(new Error('late file error'));await rejected;idle(h);
});

test('R14-16 scoped command/cache port is immutable, preserves replacements and becomes terminal independently',async t=>{
  const h=fixture(t),target={},mount=mountClassicImageExportPort(target,h.imageExporter);assert.equal(Object.isFrozen(mount.port),true);
  assert.equal(Object.getOwnPropertyDescriptor(target,'markdownEditorImageExportPort').writable,false);
  assert.throws(()=>mountClassicImageExportPort(target,h.imageExporter),/already mounted/);
  Object.defineProperty(target,'markdownEditorImageExportPort',{value:'replacement',configurable:true});mount.destroy();mount.destroy();
  assert.equal(target.markdownEditorImageExportPort,'replacement');assert.throws(()=>mount.port.getPreview(),/destroyed/);
  assert.throws(()=>mount.port.render({}),/destroyed/);assert.throws(()=>mount.port.save({}),/destroyed/);
  await h.renderImage(PNG);assert.equal(h.imageData(),PNG);
});

test('R14-16 classic commands retain only immutable requests and no PNG, layout, encoding or binary writer owner',()=>{
  const source=readFileSync(new URL('../src/features/export/application/export-controller.js',import.meta.url),'utf8');
  assert.match(source,/owners\[format\]\[method\]\(\{request\}\)/);assert.match(source,/renderImage.*render/);assert.match(source,/saveImage.*save/);
  assert.doesNotMatch(source,/currentImageDataUrl|\.toPng\(|writeBinary|ImageLayoutPort|ImageAssetPort|ImageDataPort|imageLayoutLease|imageStyleLease/);
  assert.throws(()=>createImageExporter({}),TypeError);
});
