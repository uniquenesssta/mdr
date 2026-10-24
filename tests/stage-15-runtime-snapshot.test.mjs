import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRuntimeSnapshotRecorder,createTelemetryRecorder,createAggregationBuffer} from '../src/features/telemetry/index.js';
import {createTelemetryRuntimeHost} from './support/telemetry-runtime-host.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
function documentPort(nodes=7) {
  let walks=0,visits=0;
  const document={createTreeWalker(root,mask){assert.equal(root,document);assert.equal(mask,1);walks++;let count=0;return {nextNode(){visits++;return count++<nodes?{body:'PRIVATE',nodeType:1}:null;}};},
    querySelectorAll(){throw Error('Unbounded NodeList must not be allocated');}};
  return {document,stats:()=>({walks,visits})};
}
function fixture(t,extra={},nodes=7) {
  let id=0;const records=[],timers=new Map(),errors=[],dom=documentPort(nodes),reads={};
  const port=(name,value)=>()=>{reads[name]=(reads[name]||0)+1;return value;};
  const owner=createRuntimeSnapshotRecorder({getDocument:port('dom',dom.document),getMemory:port('memory',{usedJSHeapSize:1234,totalJSHeapSize:4321}),
    getViewport:port('viewport',{width:800,height:600}),getBufferStats:port('buffer',{queueLength:3,aggregateCount:2,overflowEntries:4,overflowSamples:9,unconfirmedEntries:1,acknowledgedEntries:8}),
    getRuntimeStats:port('runtime',{scrollSync:{sourceSide:'preview',sourceSwitches:2,targetWrites:3,ignoredTargetEvents:4,geometryResyncs:5},selectionSync:{previewRevision:6,previewRefreshes:7,pendingRetries:8,mappingFailures:9,ignoredFeedbackEvents:10}}),
    record:(operation,options)=>records.push({operation,...options}),schedule:(callback,delay)=>{const key=++id;timers.set(key,{callback,delay});return key;},
    cancel:key=>timers.delete(key),onError:phase=>errors.push(phase),...extra});
  t.after(()=>owner.destroy());return {owner,records,timers,errors,reads,dom,fire(){const [key,item]=timers.entries().next().value;timers.delete(key);item.callback();}};
}

test('R15-06 public Snapshot owns bounded schema and recurring timer without global DOM or transport',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8'),source=read('src/features/telemetry/runtime-snapshot-recorder.js');
  assert.match(read('src/features/telemetry/index.js'),/export \{ createRuntimeSnapshotRecorder \}/);
  assert.doesNotMatch(source,/\b(?:window|globalThis)\.|querySelectorAll|setTimeout\(|setInterval\(|node:fs|@tauri|writePerformance/);
  const runtime=read('src/features/telemetry/browser-telemetry.js');assert.match(runtime,/function getRuntimeSnapshotRecorder\(/);
  assert.match(runtime,/if \(!runtimeSnapshotRecorder\) runtimeSnapshotRecorder = createRuntimeSnapshotRecorder/);
  assert.match(runtime,/if \(import.meta.env.DEV\) getRuntimeSnapshotRecorder\(\).start\(\)/);
  assert.doesNotMatch(runtime,/const runtimeSnapshotRecorder = createRuntimeSnapshotRecorder/);
  assert.doesNotMatch(runtime,/function recordRuntimeSnapshot\(|setInterval\(recordRuntimeSnapshot|querySelectorAll\('\*'\)/);
  assert.match(read('src-tauri/src/performance_log/redaction.rs'),/"side" \| "sourceSide" \| "targetSide" \| "scrollSourceSide" => \{\s*matches!\(value, "editor" \| "preview" \| ""\)/);
});
for(const name of ['getDocument','getMemory','getViewport','getBufferStats','getRuntimeStats','record','schedule','cancel','isEnabled','onError'])test('R15-06 rejects invalid dependency '+name,t=>{
  assert.throws(()=>fixture(t,{[name]:null}),TypeError);
});
for(const [name,value]of [['maxDomNodes',0],['maxDomNodes',10001],['maxDomNodes',1.5],['intervalMs',0],['intervalMs',999],['intervalMs',300001]])test('R15-06 rejects unbounded or busy-loop policy '+name+' '+value,t=>{
  assert.throws(()=>fixture(t,{[name]:value}),TypeError);
});
test('R15-06 factory has no automatic host reads records or timers',t=>{
  const f=fixture(t);assert.deepEqual(f.reads,{});assert.equal(f.records.length,0);assert.equal(f.timers.size,0);assert.ok(Object.isFrozen(f.owner.getState()));
});
test('R15-06 explicit sample reads each provider once and preserves all original numeric snapshot fields',t=>{
  const f=fixture(t);assert.equal(f.owner.sample(),true);assert.deepEqual(f.reads,{dom:1,memory:1,buffer:1,viewport:1,runtime:1});
  assert.deepEqual(f.records[0],{operation:'runtime.snapshot',category:'runtime.performance',details:{domNodes:7,domNodesCapped:false,usedHeapBytes:1234,totalHeapBytes:4321,
    queueLength:3,aggregateCount:2,queueOverflowEntries:4,queueOverflowSamples:9,unconfirmedLogEntries:1,acknowledgedLogEntries:8,viewportWidth:800,viewportHeight:600,
    scrollSourceSide:'preview',scrollSourceSwitches:2,scrollTargetWrites:3,scrollIgnoredTargetEvents:4,scrollGeometryResyncs:5,
    selectionPreviewRevision:6,selectionPreviewRefreshes:7,selectionPendingRetries:8,selectionMappingFailures:9,selectionIgnoredFeedbackEvents:10}});
  assert.equal(Object.keys(f.records[0].details).length,22);assert.equal(f.owner.getState().samples,1);
});
test('R15-06 DOM traversal stops at its cap including an infinite walker without reading node contents',t=>{
  const f=fixture(t,{maxDomNodes:3},Infinity);f.owner.sample();assert.deepEqual(f.dom.stats(),{walks:1,visits:3});assert.equal(f.records[0].details.domNodes,3);assert.equal(f.records[0].details.domNodesCapped,true);
});
test('R15-06 empty under-cap exact-cap and over-cap DOM boundaries report count and cap semantics',t=>{
  for(const [nodes,count,capped,visits]of [[0,0,false,1],[2,2,false,3],[3,3,true,3],[4,3,true,3]]){
    const f=fixture(t,{maxDomNodes:3},nodes);f.owner.sample();assert.equal(f.records[0].details.domNodes,count);assert.equal(f.records[0].details.domNodesCapped,capped);assert.equal(f.dom.stats().visits,visits);
  }
});
test('R15-06 absent DOM walker and memory degrade to explicit unknown rather than allocating fallback NodeLists',t=>{
  const f=fixture(t,{getDocument:()=>({querySelectorAll(){throw Error('PRIVATE');}}),getMemory:()=>undefined});f.owner.sample();assert.equal(f.records[0].details.domNodes,null);assert.equal(f.records[0].details.usedHeapBytes,null);assert.equal(f.records[0].details.totalHeapBytes,null);assert.equal(f.errors.length,0);
});
for(const phase of ['create','advance'])test('R15-06 failed DOM '+phase+' emits unknown count and a safe failure phase',t=>{
  const f=fixture(t,{getDocument:()=>({createTreeWalker(){if(phase==='create')throw Error('PRIVATE');return {nextNode(){throw Error('PRIVATE');}};}})});assert.equal(f.owner.sample(),true);assert.equal(f.records[0].details.domNodes,null);assert.deepEqual(f.errors,['dom']);
});
for(const [port,phase]of [['getDocument','dom'],['getMemory','memory'],['getViewport','viewport'],['getBufferStats','buffer'],['getRuntimeStats','runtime']])test('R15-06 '+port+' failure cannot block other statistics or leak its error',t=>{
  const f=fixture(t,{[port]:()=>{throw Error('PRIVATE /path');}});assert.equal(f.owner.sample(),true);assert.deepEqual(f.errors,[phase]);assert.equal(JSON.stringify(f.records).includes('PRIVATE'),false);assert.equal(f.owner.getState().failures,1);
});
test('R15-06 numeric schema keeps zero floors counters caps huge values and refuses string object negative or infinite metrics',t=>{
  const f=fixture(t,{getMemory:()=>({usedJSHeapSize:0,totalJSHeapSize:Infinity}),getViewport:()=>({width:3.9,height:-1}),
    getBufferStats:()=>({queueLength:'PRIVATE',aggregateCount:NaN,overflowEntries:Number.MAX_VALUE,overflowSamples:{valueOf(){throw Error('Must not coerce');}},unconfirmedEntries:-2,acknowledgedEntries:2.8})});f.owner.sample();const d=f.records[0].details;
  assert.equal(d.usedHeapBytes,0);assert.equal(d.totalHeapBytes,null);assert.equal(d.viewportWidth,3);assert.equal(d.viewportHeight,0);assert.equal(d.queueLength,0);assert.equal(d.aggregateCount,0);assert.equal(d.queueOverflowEntries,Number.MAX_SAFE_INTEGER);assert.equal(d.queueOverflowSamples,0);assert.equal(d.unconfirmedLogEntries,0);assert.equal(d.acknowledgedLogEntries,2);
});
test('R15-06 fixed schema ignores private cyclic runtime objects and preserves only known source-side enums',t=>{
  const runtime={scrollSync:{sourceSide:'PRIVATE /path',sourceSwitches:2,body:'PRIVATE'},selectionSync:{previewRevision:3},body:'PRIVATE'};runtime.cycle=runtime;Object.defineProperty(runtime,'extra',{get(){throw Error('Must not enumerate');}});
  const f=fixture(t,{getRuntimeStats:()=>runtime});f.owner.sample();runtime.scrollSync.sourceSwitches=99;assert.equal(f.records[0].details.scrollSourceSwitches,2);assert.equal(f.records[0].details.scrollSourceSide,'');assert.equal(JSON.stringify(f.records).includes('PRIVATE'),false);
});
test('R15-06 hostile fixed-field getter is read once and cannot suppress other fields',t=>{
  let calls=0;const memory={totalJSHeapSize:5};Object.defineProperty(memory,'usedJSHeapSize',{get(){calls++;throw Error('PRIVATE');}});const f=fixture(t,{getMemory:()=>memory});f.owner.sample();assert.equal(calls,1);assert.equal(f.records[0].details.usedHeapBytes,null);assert.equal(f.records[0].details.totalHeapBytes,5);assert.deepEqual(f.errors,['memory']);
});
test('R15-06 repeated start schedules exactly one default30s timer and each tick schedules one successor',t=>{
  const f=fixture(t);assert.equal(f.owner.start(),true);assert.equal(f.owner.start(),true);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,30000);assert.equal(f.records.length,0);
  f.fire();assert.equal(f.records.length,1);assert.equal(f.timers.size,1);f.fire();assert.equal(f.records.length,2);assert.equal(f.timers.size,1);
});
test('R15-06 disabled start performs no sampling and permission revocation ends the scheduled chain',t=>{
  let enabled=false;const f=fixture(t,{isEnabled:()=>enabled});assert.equal(f.owner.start(),false);assert.equal(f.timers.size,0);enabled=true;f.owner.start();enabled=false;f.fire();assert.equal(f.records.length,0);assert.equal(f.timers.size,0);assert.equal(f.owner.getState().running,false);
});
test('R15-06 stop cancels its timer while explicit manual sampling remains available',t=>{
  const f=fixture(t);f.owner.start();const old=[...f.timers.values()][0];f.owner.stop();f.owner.stop();assert.equal(f.timers.size,0);old.callback();assert.equal(f.records.length,0);assert.equal(f.owner.sample(),true);assert.equal(f.timers.size,0);
});
test('R15-06 restart invalidates old callbacks and still owns only one live timer',t=>{
  const f=fixture(t);f.owner.start();const old=[...f.timers.values()][0];f.owner.stop();f.owner.start();old.callback();assert.equal(f.records.length,0);assert.equal(f.timers.size,1);f.fire();assert.equal(f.records.length,1);
});
test('R15-06 destroy cancels its timer and permanently blocks manual scheduled and restarted sampling',t=>{
  const f=fixture(t);f.owner.start();const old=[...f.timers.values()][0];f.owner.destroy();f.owner.destroy();assert.equal(f.owner.start(),false);assert.equal(f.owner.sample(),false);old.callback();assert.equal(f.records.length,0);assert.equal(f.timers.size,0);assert.equal(f.owner.getState().destroyed,true);assert.equal(f.owner.getState().scheduled,false);
});
test('R15-06 destroy before start never reads a provider or creates a timer',t=>{
  const f=fixture(t);f.owner.destroy();assert.equal(f.owner.start(),false);assert.equal(f.owner.sample(),false);assert.deepEqual(f.reads,{});
});
test('R15-06 schedule rejection is visible and permits an explicit later recovery',t=>{
  let fail=true;const timers=new Map();const f=fixture(t,{schedule:(cb,delay)=>{if(fail)throw Error('PRIVATE');timers.set(1,{cb,delay});return 1;},cancel:key=>timers.delete(key)});
  assert.equal(f.owner.start(),false);assert.equal(f.owner.getState().scheduled,false);assert.deepEqual(f.errors,['schedule']);fail=false;assert.equal(f.owner.start(),true);assert.equal(timers.size,1);
});
test('R15-06 cancel rejection blocks overlapping restart and stale callback delivery even if the host kept the timer',t=>{
  const f=fixture(t,{cancel:()=>{throw Error('PRIVATE');}});f.owner.start();const old=[...f.timers.values()][0];f.owner.stop();old.callback();assert.equal(f.owner.start(),false);assert.equal(f.records.length,0);assert.equal(f.owner.getState().cleanupFailed,true);assert.deepEqual(f.errors,['cancel']);
});
test('R15-06 recorder or diagnostic failures cannot escape a timer callback or stop the next normal sample',t=>{
  let calls=0;const f=fixture(t,{record:()=>{if(++calls===1)throw Error('PRIVATE');},onError:()=>{throw Error('PRIVATE');}});f.owner.start();assert.doesNotThrow(()=>f.fire());assert.equal(f.timers.size,1);f.fire();assert.equal(calls,2);assert.equal(f.owner.getState().samples,1);assert.equal(f.owner.getState().lastFailure,'record');
});
test('R15-06 provider reentrant destroy prevents later provider reads and record publication',t=>{
  const f=fixture(t,{getMemory:()=>{f.owner.destroy();return {usedJSHeapSize:1};}});assert.equal(f.owner.sample(),false);assert.equal(f.records.length,0);assert.equal(f.reads.buffer,undefined);assert.equal(f.reads.runtime,undefined);
});
test('R15-06 DOM advancement reentrant stop aborts traversal and prevents publication',t=>{
  let visits=0;const f=fixture(t,{getDocument:()=>({createTreeWalker:()=>({nextNode(){visits++;f.owner.stop();return {};}})})});assert.equal(f.owner.sample(),false);assert.equal(visits,1);assert.equal(f.records.length,0);
});
test('R15-06 manual recursive sample is rejected without collecting twice',t=>{
  let nested;const f=fixture(t,{getMemory:()=>{nested=f.owner.sample();return null;}});assert.equal(f.owner.sample(),true);assert.equal(nested,false);assert.equal(f.records.length,1);assert.equal(f.dom.stats().walks,1);
});
test('R15-06 record reentrant destroy cannot schedule a successor after the current publication',t=>{
  let calls=0;const f=fixture(t,{record:()=>{calls++;f.owner.destroy();}});f.owner.start();f.fire();assert.equal(calls,1);assert.equal(f.timers.size,0);assert.equal(f.owner.getState().destroyed,true);
});
test('R15-06 schedule reentrant destroy cancels the newly returned handle',t=>{
  const cancelled=[];const f=fixture(t,{schedule:()=>{f.owner.destroy();return 99;},cancel:key=>cancelled.push(key)});assert.equal(f.owner.start(),false);assert.deepEqual(cancelled,[99]);assert.equal(f.owner.getState().scheduled,false);
});
test('R15-06 cancel reentrant start cannot create a second timer during stop',t=>{
  let result;const f=fixture(t,{cancel:key=>{result=f.owner.start();f.timers.delete(key);}});f.owner.start();f.owner.stop();assert.equal(result,false);assert.equal(f.timers.size,0);assert.equal(f.owner.getState().running,false);
});
test('R15-06 actual Recorder privacy and Buffer receipt retain scalar snapshot fields only',async t=>{
  let buffer;const batches=[],dom=documentPort(2),recorder=createTelemetryRecorder({sessionId:'snapshot-fixture',now:()=>1000,monotonicNow:()=>1,emit:e=>buffer.enqueue(e)});
  buffer=createAggregationBuffer({now:()=>1000,createEntry:recorder.createEntry,batchPrefix:'snapshot-fixture',schedule:()=>1,cancel:()=>{},writeBatch:async(entries,meta)=>{batches.push(entries);return {...meta,acceptedCount:meta.offset+entries.length};}});
  const owner=createRuntimeSnapshotRecorder({getDocument:()=>dom.document,getMemory:()=>null,getViewport:()=>({width:800,height:600}),getBufferStats:buffer.getStats,
    getRuntimeStats:()=>({body:'PRIVATE',scrollSync:{sourceSide:'editor',sourceSwitches:2}}),record:recorder.record,schedule:()=>1,cancel:()=>{}});t.after(()=>{owner.destroy();buffer.destroy();recorder.destroy();});owner.sample();buffer.setEnabled(true);await buffer.flush();
  assert.equal(batches[0][0].operation,'runtime.snapshot');assert.equal(batches[0][0].details.domNodes,2);assert.equal(batches[0][0].details.scrollSourceSide,'editor');assert.equal(JSON.stringify(batches).includes('PRIVATE'),false);assert.equal(buffer.getStats().acknowledgedEntries,1);
});
test('R15-06 actual Runtime uses capped DOM traversal current sync provider and one snapshot timer',async t=>{
  const h=createTelemetryRuntimeHost({dev:true,domNodes:10050});t.after(()=>h.dispose());h.api.configurePerformanceRuntimeStats(()=>({scrollSync:{sourceSide:'editor',sourceSwitches:3},selectionSync:{previewRevision:4},body:'PRIVATE'}));
  assert.equal([...h.timers.values()].filter(x=>x.delay===30000).length,1);h.configure(true);assert.equal([...h.timers.values()].filter(x=>x.delay===30000).length,1);
  h.api.recordRuntimeSnapshot();await h.api.flush();const snapshot=h.entries().find(x=>x.operation==='runtime.snapshot');assert.equal(snapshot.details.domNodes,10000);assert.equal(snapshot.details.domNodesCapped,true);assert.equal(snapshot.details.scrollSourceSwitches,3);assert.equal(snapshot.details.selectionPreviewRevision,4);assert.equal(h.domReads.visits,10000);assert.equal(JSON.stringify(snapshot).includes('PRIVATE'),false);
});
test('R15-06 actual DEV Runtime pagehide disable and destroy cancel snapshot timer and pageshow creates one successor',t=>{
  const h=createTelemetryRuntimeHost({dev:true});t.after(()=>h.dispose());const snapshots=()=>[...h.timers.values()].filter(x=>x.delay===30000);const old=snapshots()[0];h.dispatch('window','pagehide');assert.equal(snapshots().length,0);old.callback();assert.equal(h.api.getSnapshotState().samples,0);
  h.dispatch('window','pageshow');assert.equal(snapshots().length,1);h.configure(false);assert.equal(snapshots().length,0);h.configure(true);assert.equal(snapshots().length,1);h.api.destroySnapshots();assert.equal(snapshots().length,0);h.dispatch('window','pageshow');assert.equal(snapshots().length,0);
});
test('R15-06 actual production Runtime schedules no snapshot timer and explicit manual sampling remains compatible',async t=>{
  const h=createTelemetryRuntimeHost({dev:false});t.after(()=>h.dispose());h.configure(true);assert.equal(h.api.getSnapshotState(),null);assert.equal(h.timers.size,0);assert.equal(h.domReads.walks,0);h.api.recordRuntimeSnapshot();await h.api.flush();assert.equal(h.entries()[0].details.domNodes,7);assert.equal(h.timers.size,0);
});

test('R15-06 actual Recorder retains only the exact scrollSourceSide enums and masks private or forged values',()=>{
  const entries=[],recorder=createTelemetryRecorder({sessionId:'snapshot-enum-fixture',now:()=>1000,monotonicNow:()=>1,emit:e=>entries.push(e)});
  try {
    for(const value of ['editor','preview',''])recorder.record('fixture',{details:{scrollSourceSide:value}});
    for(const value of ['EDITOR','/private/path','PRIVATE prose'])recorder.record('fixture',{details:{scrollSourceSide:value}});
    assert.deepEqual(entries.map(e=>e.details.scrollSourceSide),['editor','preview','', '[redacted]','[redacted]','[redacted]']);
  } finally { recorder.destroy(); }
});
