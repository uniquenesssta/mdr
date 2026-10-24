import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createTelemetryRuntimeHost} from './support/telemetry-runtime-host.mjs';
const catalogue=JSON.parse(readFileSync(new URL('./fixtures/stage-15-telemetry/event-catalogue.json',import.meta.url),'utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
function host(t,options){const h=createTelemetryRuntimeHost(options);t.after(()=>h.dispose());return h;}
test('R15-01 catalogue explicitly distinguishes events, dynamic input, conditional wrappers and deferred risks',()=>{
  assert.equal(catalogue.productBehaviorChanged,false);assert.equal(catalogue.baselineCommit,'16d7b395ae7728731f1cbe4b39d5b11e4a5d377e');
  const names=catalogue.events.map(x=>x.operation);assert.equal(new Set(names).size,names.length);assert.ok(names.includes('preview.mermaid-render-result'));assert.ok(names.includes('instrumentation.ready'));
  assert.equal(catalogue.sourceSurfaces.length,43);assert.equal(catalogue.nativeCommands.write_performance_logs[0].detailsFields.length,0);
  assert.equal(names.includes('native.write_performance_logs'),false);assert.equal(catalogue.legacyWrappers.length,31);
  assert.ok(catalogue.dynamicFamilies.some(x=>x.operation.includes('arbitrary')));assert.ok(catalogue.knownGaps.some(x=>x.id==='A04'&&!x.fixed&&x.receiver.includes('15.7')));
  for(const event of catalogue.backendEvents){assert.ok(event.detailsFields.length);for(const field of event.detailsFields)assert.ok(catalogue.detailFieldClassification.some(x=>x.field===field));}
  for(const event of catalogue.events){assert.ok(event.category);assert.ok(event.statuses.length);assert.ok(event.sources.length);for(const field of event.detailsFields)assert.ok(catalogue.detailFieldClassification.some(x=>x.field===field));}
});
test('R15-01 baseline evidence covers every current direct producer, native boundary and injected hybrid callback with the R15-02 Recorder migration retaining its frozen baseline',()=>{
  const manifest=JSON.parse(readFileSync(new URL('./architecture/fixtures/production-modules.json',import.meta.url),'utf8'));const covered=new Set(catalogue.sourceSurfaces.map(x=>x.path));
  for(const row of catalogue.sourceSurfaces){const content=(["src/features/layout/shell/compact-shell-controller.js","src/features/layout/toolbar/toolbar-boundary-controller.js","src/features/preview/pipeline/preview-layout-stability.js","src/editor/hybrid-markdown.js","src/features/editor/infrastructure/pointer-selection/precise-pointer-selection.js","src/features/hybrid-editor/lifecycle/widget-geometry-scheduler.js","src/features/hybrid-editor/widgets/code-block/code-block-widget.js","src/features/hybrid-editor/widgets/html/html-block-widget.js","src/features/hybrid-editor/widgets/math/block-math-widget.js","src/features/hybrid-editor/widgets/math/inline-math-widget.js","src/features/hybrid-editor/widgets/mermaid/mermaid-widget.js","src/features/hybrid-editor/widgets/table/table-cell-editor.js","src/features/hybrid-editor/widgets/table/table-widget.js","src/main.js","src/runtime/link-preview.js","src/runtime/performance.js",'public/app/core.js','public/app/bootstrap.js','public/app/editor-tools.js','public/app/events.js','public/app/web-clipper.js','src/main.js','src/runtime/performance.js','src-tauri/src/performance_log/redaction.rs','src-tauri/src/performance_log/mod.rs','src-tauri/src/performance_log/writer.rs','src-tauri/src/performance_log/command.rs','src-tauri/src/main.rs','src/platform/desktop/performance-log-client.js','src/features/import/application/import-document-controller.js'].includes(row.path)) ? execFileSync('git',['show',catalogue.baselineCommit+':'+row.path]) : readFileSync(new URL('../'+row.path,import.meta.url));const hash=createHash('sha1').update('blob '+content.length+'\0').update(content).digest('hex');assert.equal(hash,row.blobSha,row.path);}
  for(const [path]of manifest.modules){if(!path.endsWith('.js'))continue;const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');if(source.includes('markdownEditorPerf')||/telemetry\.(?:record|diagnostic)\??\.?\(/.test(source)||/\b(?:recordInteraction|reportDiagnostic)\??\.?\(\s*['"]hybrid\./.test(source))assert.ok(covered.has(({ 'src/features/telemetry/browser-telemetry.js':'src/runtime/performance.js', 'src/features/link-preview/link-preview-controller.js':'src/runtime/link-preview.js', 'src/features/editor/infrastructure/codemirror-hybrid-extension.js':'src/editor/hybrid-markdown.js', 'src/features/documents/ui/document-workspace.js':'public/app/core.js', 'src/features/layout/workspace-preferences.js':'public/app/core.js','src/features/documents/application/document-snapshot-telemetry.js':'src/document/document-model.js' })[path] || path),path);}
  // Keep all 43 frozen producers and prove these migrations change only class projection/read bytes.
  const projectionMigrations=[
    ['src/features/layout/shell/compact-shell-controller.js',"    root.classList.toggle('compact-shell', Boolean(active));\n",''],
    ['src/features/layout/toolbar/toolbar-boundary-controller.js',"classList.contains('hidden')","classList.contains('is-hidden')"],
    ['src/features/preview/pipeline/preview-layout-stability.js',"classList.contains('collapsed')","classList.contains('is-collapsed')"]
  ];
  for(const [path,previous,current] of projectionMigrations){
    const historical=execFileSync('git',['show',catalogue.baselineCommit+':'+path],{encoding:'utf8'});
    assert.equal(historical.split(previous).length,2,path+': expected one retired class use');
    assert.equal(readFileSync(new URL('../'+path,import.meta.url),'utf8'),historical.replace(previous,current),path+': event producer changed beyond class migration');
  }
  const snapshot=catalogue.detailFieldClassification.find(x=>x.field==='documentId');assert.equal(snapshot.classification,'sensitive-or-high-cardinality-review');
});
test('R15-01 actual record emits the stable frontend envelope and detached structured details',async t=>{
  const h=host(t),details={count:2,nested:{flags:[true,false]}};h.api.record('runtime.snapshot',{durationMs:12.34567,details});details.count=9;details.nested.flags[0]=false;await h.api.flush();
  const entry=h.entries()[0];assert.deepEqual(Object.keys(entry),catalogue.envelopes.frontend);assert.equal(entry.timestampMs,1000);assert.equal(entry.sessionId,'stage15-fixture-session');assert.equal(entry.source,'frontend');assert.equal(entry.category,'ui.operation');assert.equal(entry.status,'ok');assert.equal(entry.durationMs,12.346);assert.deepEqual(entry.details,{count:2,nested:{flags:[true,false]}});
});
test('R15-01 open current record contract preserves arbitrary category/status and ignores only absent operations',async t=>{
  const h=host(t);for(const value of ['',null,undefined])h.api.record(value);h.api.record('custom.fixture',{category:'custom.category',status:'custom-status',details:{count:1}});await h.api.flush();assert.equal(h.entries().length,1);assert.equal(h.entries()[0].status,'custom-status');assert.equal(h.entries()[0].category,'custom.category');
});
for(const [input,expected]of [[-3,0],['2.25',2.25],[0,0],[undefined,null],[Infinity,null],['invalid',null]])test('R15-01 duration baseline '+String(input)+' maps to '+expected,async t=>{
  const h=host(t);h.api.record('runtime.snapshot',{durationMs:input});await h.api.flush();assert.equal(h.entries()[0].durationMs,expected);
});
for(const mode of ['success','failure'])test('R15-01 synchronous measurement preserves '+mode+' result/error identity and category',async t=>{
  const h=host(t),result={id:7},error=new Error('synthetic measurement error');const callback=()=>{h.advance(7);if(mode==='failure')throw error;return result;};
  if(mode==='failure')assert.throws(()=>h.api.measure('runtime.error',callback,{category:'runtime.error'}),e=>e===error);else assert.equal(h.api.measure('runtime.snapshot',callback,{category:'runtime.performance'}),result);
  await h.api.flush();assert.equal(h.entries()[0].durationMs,7);assert.equal(h.entries()[0].status,mode==='failure'?'error':'ok');
});
for(const mode of ['success','failure'])test('R15-01 asynchronous measurement preserves '+mode+' settlement before recording',async t=>{
  const h=host(t),result={id:8},error=new Error('synthetic async error');let resolve,reject;const pending=new Promise((a,b)=>{resolve=a;reject=b;});const measured=h.api.measure('runtime.snapshot',()=>pending,{category:'runtime.performance'});assert.equal(h.entries().length,0);h.advance(11);
  if(mode==='failure'){reject(error);await assert.rejects(measured,e=>e===error);}else{resolve(result);assert.equal(await measured,result);}await h.api.flush();assert.equal(h.entries()[0].durationMs,11);assert.equal(h.entries()[0].status,mode==='failure'?'error':'ok');
});
test('R15-01 aggregation keeps independent operation/category/status groups and correct sample statistics',async t=>{
  const h=host(t);for(const durationMs of [2,6]){h.api.record('interaction.input.frame',{category:'ui.interaction',aggregate:true,durationMs,details:{valueLength:durationMs}});h.advance(5);}h.api.record('interaction.input.frame',{category:'other',aggregate:true,durationMs:4});h.api.record('interaction.input.frame',{category:'ui.interaction',status:'error',aggregate:true,durationMs:8});h.api.drainAggregates();await h.api.flush();assert.equal(h.entries().length,3);
  const first=h.entries()[0];assert.equal(first.durationMs,4);assert.deepEqual(first.details,{valueLength:6,samples:2,averageMs:4,minMs:2,maxMs:6,periodMs:5});
});
test('R15-01 diagnostic duplicate suppression counts duplicates and a changed fingerprint emits immediately',async t=>{
  const h=host(t);assert.equal(h.api.diagnostic('runtime.error',{details:{count:1}}),true);assert.equal(h.api.diagnostic('runtime.error',{details:{count:1}}),false);assert.equal(h.api.diagnostic('runtime.error',{details:{count:2}}),true);await h.api.flush();assert.equal(h.entries().length,2);assert.equal(h.entries()[0].category,'runtime.diagnostic');assert.equal(h.entries()[1].details.suppressedDuplicates,1);
});
test('R15-01 minimum diagnostic interval remains 250ms and expiry re-emits the same fingerprint',async t=>{
  const h=host(t);const options={minIntervalMs:1,details:{count:1}};h.api.diagnostic('runtime.error',options);h.advance(249);assert.equal(h.api.diagnostic('runtime.error',options),false);h.advance(1);assert.equal(h.api.diagnostic('runtime.error',options),true);await h.api.flush();assert.equal(h.entries()[1].details.suppressedDuplicates,1);
});
test('R15-01 enqueue baseline evicts oldest entries at1000 while a disabled sink never writes',async t=>{
  const h=host(t,{enabled:false});for(let i=0;i<1002;i++)h.api.record('runtime.snapshot',{details:{count:i}});await h.api.flush();assert.equal(h.batches.length,0);h.configure(true);await h.api.flush();assert.equal(h.entries().length,250);assert.equal(h.entries()[0].details.count,2);assert.equal(h.entries()[249].details.count,251);
});
test('R15-01 native flush uses the original 250-entry batch and preserves the remaining tail',async t=>{
  const h=host(t,{enabled:false});for(let i=0;i<251;i++)h.api.record('runtime.snapshot',{details:{count:i}});h.configure(true);await h.api.flush();await h.api.flush();assert.deepEqual(h.batches.map(x=>x.length),[250,1]);assert.equal(h.entries().at(-1).details.count,250);
});
test('R15-01 failed legacy sink quarantines its unconfirmed batch without blind50ms replay and A04 remains pending native acknowledgement',async t=>{
  const h=host(t,{enabled:false,fail:true});for(let i=0;i<50;i++)h.api.record('runtime.snapshot',{details:{count:i}});h.configure(true);await h.api.flush();assert.equal(h.batches.length,1);assert.equal(h.warnings.length,1);assert.equal(h.api.getPerformanceBufferStats().unconfirmedEntries,50);assert.equal([...h.timers.values()].filter(x=>x.delay===50).length,0);assert.equal(catalogue.knownGaps.find(x=>x.id==='A04').fixed,false);
});
test('R15-01 bounded details preserve nested metrics and remove sensitive bodies before transport',async t=>{
  const h=host(t),cycle={};cycle.self=cycle;h.api.record('runtime.snapshot',{details:{nested:{body:'SYNTHETIC_SECRET'},array:Array(30).fill(1),cycle,big:1n,bad:Infinity}});await h.api.flush();const d=h.entries()[0].details;assert.equal(Object.hasOwn(d.nested,'body'),false);assert.equal(d.array.length,20);assert.equal(d.cycle.self,'[circular]');assert.equal(Object.hasOwn(d,'big'),false);assert.equal(d.bad,null);
});
test('R15-01 diagnostic snapshot emits scalar heap/DOM/queue/viewport fields without reading document body',async t=>{
  const h=host(t);h.api.recordRuntimeSnapshot();await h.api.flush();const e=h.entries()[0];assert.equal(e.operation,'runtime.snapshot');assert.equal(e.category,'runtime.performance');assert.equal(e.details.domNodes,7);assert.equal(e.details.usedHeapBytes,1234);assert.equal(e.details.viewportWidth,800);assert.equal(Object.hasOwn(e.details,'body'),false);
});
test('R15-01 optional wrappers report installed functions rather than every configured historical name',async t=>{
  const h=host(t);const marker={ok:true};h.window.setupDocuments=()=>marker;const original=h.window.setupDocuments;assert.equal(h.api.measure('setupDocuments',()=>h.window.setupDocuments(),{category:'document.operation'}),marker);assert.equal(h.window.setupDocuments,original);await h.api.flush();assert.equal(h.entries().some(x=>x.operation==='instrumentation.ready'),false);assert.ok(h.entries().some(x=>x.operation==='setupDocuments'&&x.category==='document.operation'));
});
test('R15-01 production DEV=false creates no performance global, automatic records or timers',t=>{
  const h=host(t);assert.equal(Object.hasOwn(h.window,'markdownEditorPerf'),false);assert.equal(h.timers.size,0);assert.equal(h.batches.length,0);
});
