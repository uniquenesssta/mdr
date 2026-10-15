import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createNativeLogSink,createAggregationBuffer,createTelemetryRecorder} from '../src/features/telemetry/index.js';
import {createPerformanceLogClient} from '../src/platform/desktop/performance-log-client.js';
import {createTelemetryRuntimeHost} from './support/telemetry-runtime-host.mjs';
const entries=[{count:1},{count:2},{count:3}],meta={batchId:'sink-batch-1',offset:0,attempt:1};
const ack=(m,acceptedCount=m.total,state='complete')=>({batchId:m.batchId,attempt:m.attempt,acceptedCount,state});
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(t,extra={}) {
 const calls=[],timers=new Map();let seq=0;
 const sink=createNativeLogSink({write:async(e,m)=>{calls.push({e,m});return ack(m);},schedule:(cb,ms)=>{timers.set(++seq,{cb,ms});return seq;},cancel:id=>timers.delete(id),...extra});
 t.after(()=>sink.destroy());return {sink,calls,timers,async fire(){const [id,item]=timers.entries().next().value;timers.delete(id);item.cb();await tick();}};
}
test('R15-07 Native Sink owns only bounded native waits and uses the public entry',()=>{
 const s=readFileSync(new URL('../src/features/telemetry/native-log-sink.js',import.meta.url),'utf8');assert.doesNotMatch(s,/node:fs|@tauri|\bwindow\.|\bdocument\.|setInterval|setTimeout/);
 const r=readFileSync(new URL('../src/runtime/performance.js',import.meta.url),'utf8');assert.match(r,/nativeLogSink = createNativeLogSink/);assert.match(r,/nativeLogSink.writeBatch\(entries, meta\)/);
});
for(const name of ['write','schedule','cancel','isEnabled'])test('R15-07 rejects missing port '+name,t=>{assert.throws(()=>fixture(t,{[name]:null}),TypeError);});
for(const timeoutMs of [0,249,5001,Infinity])test('R15-07 rejects unbounded timeout '+timeoutMs,t=>{assert.throws(()=>fixture(t,{timeoutMs}),TypeError);});
test('R15-07 complete receipt strips native paths and cancels its only timer',async t=>{
 const f=fixture(t,{write:async(e,m)=>({...ack(m),logPath:'PRIVATE'})});const result=await f.sink.writeBatch(entries,meta);assert.deepEqual(result,{batchId:meta.batchId,attempt:1,acceptedCount:3});assert.ok(Object.isFrozen(result));assert.equal(f.timers.size,0);
});
test('R15-07 partial receipt preserves the cumulative prefix for Buffer retry',async t=>{
 const f=fixture(t,{write:async(e,m)=>ack(m,2,'partial')});assert.equal((await f.sink.writeBatch(entries,meta)).acceptedCount,2);assert.equal(f.timers.size,0);assert.equal(f.sink.getState().busy,false);
});
for(const value of ['path-only',{batchId:'wrong',attempt:1,acceptedCount:3,state:'complete'},{batchId:meta.batchId,attempt:2,acceptedCount:3,state:'complete'},{batchId:meta.batchId,attempt:1,acceptedCount:4,state:'partial'},{batchId:meta.batchId,attempt:1,acceptedCount:2,state:'complete'},{batchId:meta.batchId,attempt:1,acceptedCount:3,state:'uncertain'}])test('R15-07 invalid receipt triggers one query '+JSON.stringify(value),async t=>{
 let calls=0;const f=fixture(t,{write:async(e,m)=>{calls++;if(m.query){assert.deepEqual(e,[]);return ack(m);}return value;}});assert.equal((await f.sink.writeBatch(entries,meta)).acceptedCount,3);assert.equal(calls,2);assert.equal(f.timers.size,0);
});
test('R15-07 lost response recovers through a read-only query with identical identity',async t=>{
 const requests=[];const f=fixture(t,{write:async(e,m)=>{requests.push({e,m});if(!m.query)throw new Error('PRIVATE');return ack(m);}});
 await f.sink.writeBatch(entries,meta);assert.equal(requests.length,2);assert.deepEqual(requests[1].e,[]);assert.equal(requests[1].m.batchId,requests[0].m.batchId);assert.equal(requests[1].m.total,3);
});
test('R15-07 two timeouts settle unknown and consume a late write without replay',async t=>{
 let late,calls=0;const f=fixture(t,{write:()=>{calls++;return new Promise(resolve=>{late=resolve;});}});const p=f.sink.writeBatch(entries,meta);const rejected=assert.rejects(p,/timeout/);await tick();assert.equal(f.timers.size,1);await f.fire();assert.equal(calls,2);await f.fire();await rejected;late({});await tick();assert.equal(calls,2);assert.equal(f.sink.getState().activeWaits,0);
});
test('R15-07 concurrent submission is rejected while one native request is pending',async t=>{
 let done;const f=fixture(t,{write:(e,m)=>new Promise(resolve=>{done=()=>resolve(ack(m));})});const p=f.sink.writeBatch(entries,meta);await tick();await assert.rejects(f.sink.writeBatch(entries,meta),/unavailable/);done();await p;assert.equal(f.timers.size,0);
});
test('R15-07 destroy cancels owned waits and rejects late publication without querying',async t=>{
 let done,calls=0;const f=fixture(t,{write:(e,m)=>{calls++;return new Promise(resolve=>{done=()=>resolve(ack(m));});}});const p=f.sink.writeBatch(entries,meta);const rejected=assert.rejects(p,/destroyed/);await tick();f.sink.destroy();f.sink.destroy();await rejected;done();await tick();assert.equal(calls,1);assert.equal(f.timers.size,0);await assert.rejects(f.sink.writeBatch(entries,meta),/unavailable/);
});
test('R15-07 cancel failure is observable and prevents more native waits',async t=>{
 const f=fixture(t,{cancel:()=>{throw new Error('PRIVATE');}});await f.sink.writeBatch(entries,meta);assert.equal(f.sink.getState().cleanupFailed,true);await assert.rejects(f.sink.writeBatch(entries,meta),/unavailable/);
});
test('R15-07 disabled Sink makes no native call or timer',async t=>{
 const f=fixture(t,{isEnabled:()=>false});await assert.rejects(f.sink.writeBatch(entries,meta),/unavailable/);assert.equal(f.calls.length,0);assert.equal(f.timers.size,0);
});
for(const change of [{attempt:9},{offset:-1},{offset:249},{batchId:'PRIVATE /path'}])test('R15-07 metadata rejected before native I/O '+JSON.stringify(change),async t=>{
 const f=fixture(t);await assert.rejects(f.sink.writeBatch(entries,{...meta,...change}),TypeError);assert.equal(f.calls.length,0);assert.equal(f.timers.size,0);
});
test('R15-07 actual desktop client sends acknowledgement metadata without self-recording',async()=>{
 const calls=[];const client=createPerformanceLogClient({invoke:async(...args)=>{calls.push(args);return 'same-result';}});
 assert.equal(await client.writePerformance(entries,{...meta,total:3,query:true}),'same-result');assert.equal(calls[0][0],'write_performance_log_batch');assert.deepEqual(calls[0][1],{entries,batchId:meta.batchId,offset:0,attempt:1,total:3,query:true});assert.equal(calls[0][3].record,false);
 await client.writePerformance(entries);assert.equal(calls[1][0],'write_performance_logs');assert.deepEqual(calls[1][1],{entries});
});
test('R15-07 Buffer stops known zero-progress retries at eight and retains bounded handoff',async t=>{
 let now=0,calls=0,id=0;const timers=new Map(),recorder=createTelemetryRecorder({sessionId:'sink-limit',now:()=>now,monotonicNow:()=>now,emit:()=>{}});
 const buffer=createAggregationBuffer({now:()=>now,createEntry:recorder.createEntry,batchPrefix:'sink-limit',schedule:(cb,ms)=>{timers.set(++id,{cb,ms});return id;},cancel:k=>timers.delete(k),writeBatch:async(e,m)=>{calls++;return {...m,acceptedCount:0};}});t.after(()=>{buffer.destroy();recorder.destroy();});buffer.enqueue(recorder.createEntry('fixture'));buffer.setEnabled(true);
 for(let i=0;i<8;i++){await buffer.flush();if(i<7){const [key,item]=timers.entries().next().value;timers.delete(key);now+=item.ms;item.cb();await buffer.flush();}}
 assert.equal(calls,8);assert.equal(buffer.getStats().unconfirmedEntries,1);assert.equal(timers.size,0);now+=1e9;await buffer.flush();assert.equal(calls,8);assert.equal(buffer.destroy().pending.length,1);
});
test('R15-07 hung logging does not delay synchronous or asynchronous business measurement',async t=>{
 const h=createTelemetryRuntimeHost({enabled:false});t.after(()=>h.dispose());h.api.configurePerformancePlatform({enabled:true,logs:{writePerformance:()=>new Promise(()=>{})}});
 const result={saved:true};assert.equal(h.api.measure('document.save',()=>result),result);const waiting=h.api.flush();await tick();assert.equal(h.api.getPerformanceBufferStats().inFlightEntries,1);assert.equal(await h.api.measure('document.close',async()=>result),result);assert.equal(h.api.getPerformanceBufferStats().retainedEntries,2);h.dispose();await waiting;
});
test('R15-07 production setup leaves all telemetry owners cold',t=>{
 const h=createTelemetryRuntimeHost({dev:false});t.after(()=>h.dispose());assert.equal(h.timers.size,0);assert.equal(h.batches.length,0);assert.equal(h.api.getSnapshotState(),null);assert.equal(h.api.getLongTaskState().observerAttached,false);assert.equal(Object.hasOwn(h.window,'markdownEditorPerf'),false);
});
