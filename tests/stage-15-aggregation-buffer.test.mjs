import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createTelemetryRecorder,createAggregationBuffer} from '../src/features/telemetry/index.js';
import {createTelemetryRuntimeHost} from './support/telemetry-runtime-host.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture(t,extra={}) {
  let clock=1000,id=0;const writes=[],timers=new Map(),errors=[];
  const recorder=createTelemetryRecorder({sessionId:'buffer-fixture',now:()=>clock,monotonicNow:()=>clock,emit:()=>{}});
  const buffer=createAggregationBuffer({now:()=>clock,createEntry:recorder.createEntry,batchPrefix:'buffer-fixture',
    schedule:(callback,delay)=>{const key=++id;timers.set(key,{callback,delay});return key;},cancel:key=>timers.delete(key),
    onError:message=>errors.push(message),writeBatch:async(entries,meta)=>{writes.push({entries,meta});return {...meta,acceptedCount:meta.offset+entries.length,logPath:'fixture-path'};},...extra});
  t.after(()=>{buffer.destroy();recorder.destroy();});
  const entry=(count=1)=>recorder.createEntry('fixture',{details:{count}});
  return {buffer,recorder,writes,timers,errors,entry,advance:ms=>{clock+=ms;},async runTimer(){
    const [key,timer]=timers.entries().next().value;timers.delete(key);clock+=timer.delay;timer.callback();await buffer.flush();
  }};
}

test('R15-04 Buffer owns queue aggregation batches and backoff through a public entry without file I/O',()=>{
  const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),source=read('src/features/telemetry/aggregation-buffer.js');
  assert.doesNotMatch(source,/node:fs|@tauri|writePerformance|\bwindow\.|\bdocument\./);
  assert.match(read('src/features/telemetry/index.js'),/export \{ createAggregationBuffer \}/);
  const runtime=read('src/features/telemetry/browser-telemetry.js');assert.match(runtime,/buffer = createAggregationBuffer/);
  assert.doesNotMatch(runtime,/const queue =|const aggregates =|queue\.unshift|flushInProgress|setTimeout\(.*50/);
});
for(const name of ['now','createEntry','writeBatch','schedule','cancel','batchPrefix'])test('R15-04 rejects invalid dependency '+name,t=>{
  assert.throws(()=>fixture(t,{[name]:null}),TypeError);
});
for(const [name,value]of [['maxEntries',1001],['maxGroups',201],['batchSize',251],['windowMs',0],['retryBaseMs',0],['retryMaxMs',30001]])test('R15-04 rejects unbounded policy '+name,t=>{
  assert.throws(()=>fixture(t,{[name]:value}),TypeError);
});

test('R15-04 groups operation category status and time window with exact sample min/max/average',async t=>{
  const f=fixture(t);f.buffer.aggregate('fixture',{category:'cat',durationMs:2,details:{count:1}});f.advance(5);
  f.buffer.aggregate('fixture',{category:'cat',durationMs:6,details:{count:2}});
  f.buffer.aggregate('fixture',{category:'other',durationMs:9});f.buffer.aggregate('fixture',{category:'cat',status:'error',durationMs:4});
  f.buffer.drainAggregates();f.buffer.setEnabled(true);await f.buffer.flush();assert.equal(f.writes[0].entries.length,3);
  assert.deepEqual(plain(f.writes[0].entries[0].details),{count:2,samples:2,averageMs:4,minMs:2,maxMs:6,periodMs:5});
});

test('R15-04 crossing a window preserves the previous bucket rather than merging it',t=>{
  const f=fixture(t,{windowMs:10});f.buffer.aggregate('fixture',{durationMs:2});f.advance(10);f.buffer.aggregate('fixture',{durationMs:6});
  assert.equal(f.buffer.getStats().queueLength,1);assert.equal(f.buffer.getStats().aggregateCount,1);
  const report=f.buffer.destroy();assert.equal(report.pending.length,2);assert.deepEqual(report.pending.map(x=>x.entry.details.samples),[1,1]);
});

test('R15-04 invalid durations do not bias valid averages and an all-invalid bucket has null timing',t=>{
  const f=fixture(t);f.buffer.aggregate('mixed',{durationMs:2});f.buffer.aggregate('mixed',{durationMs:undefined});f.buffer.aggregate('mixed',{durationMs:6});
  f.buffer.aggregate('invalid',{durationMs:Infinity});f.buffer.drainAggregates();const entries=f.buffer.snapshot().pending.map(x=>x.entry);
  assert.equal(entries[0].details.samples,3);assert.equal(entries[0].durationMs,4);assert.equal(entries[1].durationMs,null);assert.equal(entries[1].details.minMs,null);
});

test('R15-04 online mean stays finite for huge finite inputs and negative durations clamp to zero',t=>{
  const f=fixture(t);f.buffer.aggregate('large',{durationMs:1e308});f.buffer.aggregate('large',{durationMs:1e308});f.buffer.aggregate('negative',{durationMs:-3});f.buffer.drainAggregates();
  const entries=f.buffer.snapshot().pending.map(x=>x.entry);assert.equal(entries[0].durationMs,1e308);assert.equal(entries[1].details.minMs,0);assert.equal(entries[1].details.maxMs,0);
});

test('R15-04 group limit drains oldest metrics and overflow counts every dropped aggregated sample',t=>{
  const f=fixture(t,{maxEntries:2,maxGroups:2});for(let i=0;i<6;i++)f.buffer.aggregate('metric'+i,{durationMs:1});
  assert.equal(f.buffer.getStats().aggregateCount,2);const report=f.buffer.destroy();assert.equal(report.retainedEntries,2);assert.equal(report.overflowEntries,4);assert.equal(report.overflowSamples,4);
});

test('R15-04 queue cap evicts oldest queued entries with loss accounting and detached input',t=>{
  const f=fixture(t,{maxEntries:3});const item=f.entry(0);f.buffer.enqueue(item);item.details.count=99;
  for(let i=1;i<5;i++)f.buffer.enqueue(f.entry(i));const report=f.buffer.snapshot();assert.deepEqual(report.pending.map(x=>x.entry.details.count),[2,3,4]);assert.equal(report.overflowEntries,2);
});

test('R15-04 flush drains pending aggregation before dispatch and respects the250 batch limit',async t=>{
  const f=fixture(t);for(let i=0;i<251;i++)f.buffer.enqueue(f.entry(i));f.buffer.aggregate('aggregate',{durationMs:3});
  f.buffer.setEnabled(true);await f.buffer.flush();await f.buffer.flush();assert.deepEqual(f.writes.map(x=>x.entries.length),[250,2]);assert.equal(f.buffer.getStats().retainedEntries,0);
});

test('R15-04 concurrent flush calls share one actual write',async t=>{
  let resolve,calls=0;const pending=new Promise(a=>{resolve=a;});let meta;
  const f=fixture(t,{writeBatch:async(entries,m)=>{calls++;meta=m;return pending;}});f.buffer.enqueue(f.entry());f.buffer.setEnabled(true);
  const a=f.buffer.flush(),b=f.buffer.flush();assert.equal(a,b);await Promise.resolve();assert.equal(calls,1);
  resolve({...meta,acceptedCount:1});await a;assert.equal(f.buffer.getStats().acknowledgedEntries,1);
});

test('R15-04 partial acknowledgement trims confirmed prefix and retries only the safe suffix with stable batch id',async t=>{
  const requests=[];const f=fixture(t,{writeBatch:async(entries,meta)=>{requests.push({entries,meta});return {...meta,acceptedCount:requests.length===1?1:3};}});
  for(let i=0;i<3;i++)f.buffer.enqueue(f.entry(i));f.buffer.setEnabled(true);await f.buffer.flush();assert.equal(f.buffer.getStats().retainedEntries,2);
  assert.deepEqual(f.buffer.snapshot().pending.map(x=>x.offset),[1,2]);await f.runTimer();
  assert.deepEqual(requests.map(x=>x.entries.map(e=>e.details.count)),[[0,1,2],[1,2]]);assert.equal(requests[0].meta.batchId,requests[1].meta.batchId);assert.equal(requests[1].meta.offset,1);assert.equal(f.buffer.getStats().acknowledgedEntries,3);
});

test('R15-04 known zero-write acknowledgement backs off exponentially and caps delays before recovery',async t=>{
  let calls=0;const f=fixture(t,{retryBaseMs:250,retryMaxMs:1000,writeBatch:async(entries,meta)=>({...meta,acceptedCount:++calls<5?0:entries.length})});
  f.buffer.enqueue(f.entry());f.buffer.setEnabled(true);await f.buffer.flush();const delays=[];
  for(let i=0;i<4;i++){delays.push([...f.timers.values()][0].delay);await f.runTimer();}
  assert.deepEqual(delays,[250,500,1000,1000]);assert.equal(f.buffer.getStats().retainedEntries,0);assert.equal(f.buffer.getStats().failures,0);
});

test('R15-04 unknown failure quarantines entries and new records never replay the failed batch',async t=>{
  const requests=[];let fail=true;const f=fixture(t,{writeBatch:async(entries,meta)=>{requests.push({entries,meta});if(fail)throw new Error('PRIVATE /private/path');return {...meta,acceptedCount:entries.length};}});
  f.buffer.enqueue(f.entry(1));f.buffer.setEnabled(true);await f.buffer.flush();assert.equal(f.buffer.getStats().unconfirmedEntries,1);assert.equal(f.timers.size,0);assert.deepEqual(f.errors,['[redacted]']);
  fail=false;f.buffer.enqueue(f.entry(2));await f.buffer.flush();await f.runTimer();
  assert.deepEqual(requests.map(x=>x.entries.map(e=>e.details.count)),[[1],[2]]);assert.equal(f.buffer.getStats().unconfirmedEntries,1);
});

test('R15-04 explicit matching late receipt recovers an uncertain suffix and duplicate receipts do not repeat writes',async t=>{
  let meta;const f=fixture(t,{writeBatch:async(entries,m)=>{meta=m;throw new Error('unknown');}});
  f.buffer.enqueue(f.entry());f.buffer.setEnabled(true);await f.buffer.flush();const ack={...meta,acceptedCount:1};
  assert.equal(f.buffer.resolveBatch(ack),true);assert.equal(f.buffer.resolveBatch(ack),true);assert.equal(f.buffer.resolveBatch({...ack,attempt:99}),false);assert.equal(f.buffer.getStats().acknowledgedEntries,1);assert.equal(f.timers.size,0);
});
for(const kind of ['wrong-id','wrong-attempt','too-large','negative','fraction','throwing-getter'])test('R15-04 malformed acknowledgement '+kind+' quarantines rather than confirming or blind retry',async t=>{
  const f=fixture(t,{writeBatch:async(entries,meta)=>{
    const ack={...meta,acceptedCount:1};if(kind==='wrong-id')ack.batchId='other';if(kind==='wrong-attempt')ack.attempt++;if(kind==='too-large')ack.acceptedCount=2;if(kind==='negative')ack.acceptedCount=-1;if(kind==='fraction')ack.acceptedCount=.5;
    if(kind==='throwing-getter')Object.defineProperty(ack,'logPath',{get(){throw new Error('PRIVATE');}});return ack;
  }});f.buffer.enqueue(f.entry());f.buffer.setEnabled(true);await f.buffer.flush();assert.equal(f.buffer.getStats().unconfirmedEntries,1);assert.equal(f.buffer.getStats().acknowledgedEntries,0);assert.equal(f.timers.size,0);
});

test('R15-04 in-flight and unknown records consume capacity and cannot be silently evicted',async t=>{
  let reject;const pending=new Promise((a,b)=>{reject=b;});const f=fixture(t,{maxEntries:2,writeBatch:()=>pending});
  f.buffer.enqueue(f.entry(1));f.buffer.enqueue(f.entry(2));f.buffer.setEnabled(true);const operation=f.buffer.flush();await Promise.resolve();
  assert.equal(f.buffer.enqueue(f.entry(3)),false);reject(new Error('unknown'));await operation;assert.equal(f.buffer.enqueue(f.entry(4)),false);
  assert.equal(f.buffer.getStats().retainedEntries,2);assert.equal(f.buffer.getStats().unconfirmedEntries,2);assert.equal(f.buffer.getStats().overflowEntries,2);
});

test('R15-04 disable cancels retry scheduling and preserves data for later explicit re-enable',async t=>{
  let calls=0;const f=fixture(t,{writeBatch:async(entries,meta)=>({...meta,acceptedCount:++calls===1?0:1})});f.buffer.enqueue(f.entry());f.buffer.setEnabled(true);await f.buffer.flush();
  f.buffer.setEnabled(false);assert.equal(f.timers.size,0);await f.buffer.flush();assert.equal(calls,1);f.advance(250);f.buffer.setEnabled(true);await f.buffer.flush();assert.equal(calls,2);
});

test('R15-04 destroy cancels owned retry timer and returns immutable pending data without implicit writes',async t=>{
  let calls=0;const f=fixture(t,{writeBatch:async(entries,meta)=>{calls++;return {...meta,acceptedCount:0};}});f.buffer.enqueue(f.entry());f.buffer.setEnabled(true);await f.buffer.flush();
  const report=f.buffer.destroy();assert.equal(f.timers.size,0);assert.equal(report.pending.length,1);assert.ok(Object.isFrozen(report.pending[0].entry.details));assert.equal(f.buffer.destroy(),report);
  f.buffer.enqueue(f.entry(2));await f.buffer.flush();f.buffer.setEnabled(true);assert.equal(calls,1);
});

test('R15-04 destroy before deferred dispatch prevents a new write and retains the unsent handoff',async t=>{
  const f=fixture(t);f.buffer.enqueue(f.entry());f.buffer.setEnabled(true);const operation=f.buffer.flush(),report=f.buffer.destroy();await operation;
  assert.equal(f.writes.length,0);assert.equal(report.pending.length,1);
});

test('R15-04 late in-flight settlement after destroy never schedules or replays and preserves shutdown snapshot',async t=>{
  let resolve,meta;const pending=new Promise(a=>{resolve=a;});const f=fixture(t,{writeBatch:async(entries,m)=>{meta=m;return pending;}});
  f.buffer.enqueue(f.entry());f.buffer.setEnabled(true);const operation=f.buffer.flush();await Promise.resolve();const report=f.buffer.destroy();resolve({...meta,acceptedCount:1});await operation;
  assert.equal(f.timers.size,0);assert.equal(report.pending.length,1);assert.equal(f.buffer.resolveBatch({...meta,acceptedCount:1}),false);
});

test('R15-04 transport errors with hostile getters and throwing diagnostics still produce bounded uncertainty',async t=>{
  const hostile=Object.defineProperty({},'message',{get(){throw new Error('PRIVATE');}});
  const f=fixture(t,{writeBatch:()=>{throw hostile;},onError:()=>{throw new Error('PRIVATE');}});f.buffer.enqueue(f.entry());f.buffer.setEnabled(true);await f.buffer.flush();assert.equal(f.buffer.getStats().unconfirmedEntries,1);
});

test('R15-04 actual Runtime snapshot reports Buffer overflow and uncertainty without private pending payloads',async t=>{
  const h=createTelemetryRuntimeHost({enabled:false});t.after(()=>h.dispose());for(let i=0;i<1002;i++)h.api.record('fixture',{details:{count:i,body:'PRIVATE'}});
  h.api.recordRuntimeSnapshot();h.configure(true);await h.api.flush();const stats=h.api.getPerformanceBufferStats();assert.ok(stats.overflowEntries>=2);
  const snapshot=h.api.destroyBuffer();assert.equal(JSON.stringify(snapshot).includes('PRIVATE'),false);assert.ok(snapshot.pending.length>0);
});


test('R15-04 aggregate option getters that destroy the owner cannot recreate retained state',t=>{
  const f=fixture(t);const options=Object.defineProperty({},'durationMs',{get(){f.buffer.destroy();return 7;}});
  f.buffer.aggregate('fixture',options);assert.equal(f.buffer.getStats().aggregateCount,0);assert.equal(f.buffer.getStats().retainedEntries,0);
});

test('R15-04 stale partial receipt cannot roll back confirmed progress or acknowledge another attempt',async t=>{
  let meta;const f=fixture(t,{writeBatch:async(entries,m)=>{meta=m;return {...m,acceptedCount:1};}});
  f.buffer.enqueue(f.entry(1));f.buffer.enqueue(f.entry(2));f.buffer.setEnabled(true);await f.buffer.flush();
  assert.equal(f.buffer.resolveBatch({...meta,acceptedCount:0}),false);assert.equal(f.buffer.resolveBatch({...meta,attempt:0,acceptedCount:2}),false);
  assert.equal(f.buffer.getStats().acknowledgedEntries,1);assert.equal(f.buffer.getStats().retainedEntries,1);
});


test('R15-04 a disposed Recorder cannot silently erase unmaterialized aggregation during Buffer shutdown',t=>{
  const f=fixture(t);f.buffer.aggregate('fixture',{durationMs:3,details:{body:'PRIVATE',count:2}});f.recorder.destroy();
  const report=f.buffer.destroy();assert.equal(report.pendingAggregates.length,1);assert.equal(report.pendingAggregates[0].count,1);assert.equal(report.pendingAggregates[0].details.count,2);
  assert.equal(JSON.stringify(report).includes('PRIVATE'),false);assert.ok(Object.isFrozen(report.pendingAggregates));
});
