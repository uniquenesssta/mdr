import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createExportController, createExportRequest, ExportCancelledError } from '../src/features/export/index.js';

const actions={exportMarkdown:['markdown','export'],exportHtml:['html','export'],exportWord:['word','export'],exportPdf:['pdf','export'],renderImage:['image','render'],saveImage:['image','save']};
function fixture(){
  const calls=[],messages=[],errors=[],state={ratio:'9:16',cropFit:false,name:'原文😀.txt',directory:'C:\\custom',view:'preview',open:false};
  const owners={};for(const format of ['markdown','html','word','pdf','image'])owners[format]=Object.fromEntries((format==='image'?['render','save']:['export']).map(method=>[method,async options=>{calls.push({format,method,...options});return{status:method==='render'?'ready':format==='pdf'?'print-prepared':'written'};} ]));
  const imageView={getOptions:()=>({ratio:state.ratio,cropFit:state.cropFit}),setRatio:ratio=>{state.ratio=ratio;},resetCrop:()=>{state.cropFit=false;},open:()=>{state.open=true;},close:()=>{state.open=false;return true;}};
  const controller=createExportController({requests:{createRequest:input=>createExportRequest({documentId:'doc',...input})},tasks:{isCancelled:error=>error instanceof ExportCancelledError},owners,imageView,
    preview:{getViewMode:()=>state.view,setViewMode:value=>{state.view=value;}},readInput:()=>({name:state.name,directory:state.directory}),notify:value=>messages.push(value),translate:key=>key,reportError:error=>errors.push(error)});
  return{controller,owners,imageView,state,calls,messages,errors};
}
for(const [action,[format,method]]of Object.entries(actions))test('R14-18 '+action+' routes immutable metadata to the public format owner',async()=>{
  const h=fixture();await h.controller.invoke(action);assert.equal(h.calls.length,1);assert.equal(h.calls[0].format,format);assert.equal(h.calls[0].method,method);assert.equal(Object.isFrozen(h.calls[0].request),true);assert.equal(h.calls[0].request.directory,'C:\\custom');
});
for(const action of Object.keys(actions))test('R14-18 '+action+' invalid metadata produces one validation message without starting a format',async()=>{
  const h=fixture();h.state.name='bad\0.md';assert.equal((await h.controller.invoke(action)).status,'invalid');assert.equal(h.calls.length,0);assert.match(h.messages[0],/^导出参数无效：/);
});
for(const status of ['cancelled','busy','no-preview'])test('R14-18 command '+status+' result retains quiet cancellation and precise status notification',async()=>{
  const h=fixture();h.owners.image.save=async()=>({status});await h.controller.invoke('saveImage');assert.equal(h.errors.length,0);assert.equal(h.messages.length,status==='cancelled'?0:1);
});
for(const action of Object.keys(actions))test('R14-18 '+action+' cancellation errors are consumed without failure or success message',async()=>{
  const h=fixture(),[format,method]=actions[action];h.owners[format][method]=async()=>{throw new ExportCancelledError('document-changed');};assert.equal((await h.controller.invoke(action)).status,'cancelled');assert.equal(h.messages.length,0);assert.equal(h.errors.length,0);
});
test('R14-18 image opening owns only view mode/options and delegates one render; close never writes',async()=>{
  const h=fixture();h.state.view='html';h.state.cropFit=true;await h.controller.invoke('openImage');assert.equal(h.state.view,'preview');assert.equal(h.state.cropFit,false);assert.equal(h.state.open,true);assert.equal(h.calls.length,1);await h.controller.invoke('closeImage');assert.equal(h.state.open,false);assert.equal(h.calls.length,1);
  await h.controller.invoke('selectRatio',{ratio:'4:5'});assert.equal(h.calls.at(-1).request.imageOptions.ratio,'4:5');
});
for(const late of ['resolve','reject'])test('R14-18 controller destroy suppresses late '+late+' without destroying shared format authority',async()=>{
  const h=fixture();let resolve,reject;h.owners.markdown.export=()=>new Promise((a,b)=>{resolve=a;reject=b;});const work=h.controller.invoke('exportMarkdown');h.controller.destroy();h.controller.destroy();late==='resolve'?resolve({status:'written'}):reject(new Error('late output'));
  assert.deepEqual(await work,{status:'cancelled',reason:'destroyed'});assert.equal(h.messages.length,0);assert.equal(h.errors.length,0);assert.throws(()=>h.controller.invoke('exportMarkdown'),/EXPORT_CANCELLED/);assert.equal(h.controller.has('exportMarkdown'),false);
});
test('R16-08 explicit Export commands retain immutable capabilities and terminal owner cleanup', () => {
  const h = fixture(), host = {};
  assert.equal(Object.isFrozen(h.controller), true);
  assert.equal(h.controller.has('exportMarkdown'), true);
  assert.equal(h.controller.has('unknown'), false);
  h.controller.destroy(); h.controller.destroy();
  assert.deepEqual(Object.keys(host), []);
  assert.equal(h.controller.has('exportMarkdown'), false);
  assert.throws(() => h.controller.invoke('exportMarkdown'), /EXPORT_CANCELLED/);
});
test('R14-18 removed script, inline image template and Menu globals cannot form a second production export chain',()=>{
  assert.equal(existsSync(new URL('../public/app/export.js',import.meta.url)),false);
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  assert.doesNotMatch(read('src/main.js'),/['"]\/app\/export\.js['"]/);
  assert.doesNotMatch(read('src/features/menu/ui/menu-content-view.js'),/id="export-image-(?:modal|stage|content|preview)"|selectImageRatio\(|downloadExportImage\(|(?:exportFile|exportWord|exportPDF|exportHTML|openExportImageModal)\(/);
  assert.doesNotMatch(read('src/features/menu/menu-actions.js'),/invokeGlobal\('(?:exportFile|exportWord|exportHTML|exportPDF|openExportImageModal)'/);
  assert.match(read('src/features/menu/menu-actions.js'),/exportCommands/);
  assert.equal(existsSync(new URL('../public/compatibility/business-content.html', import.meta.url)), false);
});
