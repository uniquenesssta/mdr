import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createLongTaskObserver, createTelemetryRecorder, createAggregationBuffer } from '../src/features/telemetry/index.js';
import { createTelemetryRuntimeHost } from './support/telemetry-runtime-host.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const entry = (duration=61,startTime=12.34567) => ({entryType:'longtask',duration,startTime});
function observerPort({types=['longtask'],construct,observe,disconnect}={}) {
  const instances=[];
  class Observer {
    static supportedEntryTypes=types;
    constructor(callback) { this.callback=callback;this.observations=[];this.disconnections=0;instances.push(this);construct?.(this); }
    observe(options) { this.observations.push(plain(options));observe?.(this); }
    disconnect() { this.disconnections++;disconnect?.(this); }
    deliver(entries) { this.callback({getEntries:()=>entries}); }
  }
  return {Observer,instances};
}
function fixture(t,ports={},extra={}) {
  const browser=observerPort(ports),records=[],errors=[];
  const owner=createLongTaskObserver({getObserver:()=>browser.Observer,record:(...args)=>records.push(args),onError:phase=>errors.push(phase),...extra});
  t.after(()=>owner.destroy());return {...browser,owner,records,errors};
}

test('R15-05 public observer owns one generation without globals timers DOM or file transport',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  assert.match(read('src/features/telemetry/index.js'),/export \{ createLongTaskObserver \}/);
  const source=read('src/features/telemetry/long-task-observer.js');
  assert.doesNotMatch(source,/\b(?:window|document|globalThis)\.|setTimeout|setInterval|node:fs|@tauri|writePerformance/);
  const runtime=read('src/features/telemetry/browser-telemetry.js');assert.match(runtime,/longTaskObserver = createLongTaskObserver/);
  assert.doesNotMatch(runtime,/longTaskObserver = new PerformanceObserver|observe\(\{ type: 'longtask'/);
});
for(const name of ['getObserver','record','isEnabled','onError'])test('R15-05 rejects invalid '+name+' dependency',()=>{
  assert.throws(()=>createLongTaskObserver({getObserver:()=>null,record:()=>{},[name]:null}),TypeError);
});

test('R15-05 construction has no host side effects and repeated start owns one observer',t=>{
  let reads=0;const f=fixture(t,{}, {getObserver:()=>{reads++;return f.Observer;}});
  assert.equal(reads,0);assert.equal(f.instances.length,0);assert.equal(f.owner.getState().state,'idle');
  assert.equal(f.owner.start(),true);assert.equal(f.owner.start(),true);assert.equal(reads,1);assert.equal(f.instances.length,1);
  assert.deepEqual(f.instances[0].observations,[{type:'longtask',buffered:true}]);assert.ok(Object.isFrozen(f.owner.getState()));
});
test('R15-05 absent browser API gracefully returns unsupported without constructing or throwing',t=>{
  const f=fixture(t,{}, {getObserver:()=>undefined});assert.equal(f.owner.start(),false);assert.equal(f.owner.getState().state,'unsupported');assert.equal(f.errors.length,0);
});
test('R15-05 unsupported longtask capability never constructs an observer',t=>{
  const f=fixture(t,{types:['event','navigation']});assert.equal(f.owner.start(),false);assert.equal(f.instances.length,0);assert.equal(f.owner.getState().state,'unsupported');
});
test('R15-05 legacy host without supportedEntryTypes still attempts the real observe capability',t=>{
  const f=fixture(t);delete f.Observer.supportedEntryTypes;assert.equal(f.owner.start(),true);assert.equal(f.instances.length,1);
});
test('R15-05 unavailable host can recover on a later explicit start',t=>{
  let available=false;const f=fixture(t,{}, {getObserver:()=>available?f.Observer:null});assert.equal(f.owner.start(),false);available=true;assert.equal(f.owner.start(),true);
});
test('R15-05 disabled start does not resolve the API and callbacks stop when permission is revoked',t=>{
  let enabled=false,reads=0;const f=fixture(t,{}, {getObserver:()=>{reads++;return f.Observer;},isEnabled:()=>enabled});
  assert.equal(f.owner.start(),false);assert.equal(reads,0);enabled=true;f.owner.start();const old=f.instances[0];enabled=false;old.deliver([entry()]);
  assert.equal(old.disconnections,1);assert.equal(f.records.length,0);assert.equal(f.owner.getState().state,'stopped');
});
test('R15-05 long tasks preserve the event envelope and expose only numeric duration and rounded startTime',t=>{
  const f=fixture(t);f.owner.start();const item=entry();Object.defineProperty(item,'name',{get(){throw Error('PRIVATE path');}});
  Object.defineProperty(item,'attribution',{get(){throw Error('PRIVATE body');}});f.instances[0].deliver([item]);
  assert.deepEqual(f.records,[['runtime.long-task',{category:'runtime.performance',durationMs:61,details:{startTime:12.346}}]]);assert.equal(f.owner.getState().recordedEntries,1);
});
for(const [name,value]of [['duration',NaN],['duration',Infinity],['duration',-1],['duration','61'],['startTime',NaN],['startTime',-1],['startTime',undefined],['entryType','event']])test('R15-05 invalid '+name+' '+String(value)+' is skipped without fabricated metrics',t=>{
  const f=fixture(t);f.owner.start();f.instances[0].deliver([{...entry(),[name]:value},entry(0,0)]);
  assert.equal(f.records.length,1);assert.equal(f.records[0][1].durationMs,0);assert.equal(f.owner.getState().skippedEntries,1);
});
test('R15-05 hostile entry getter is contained and later valid entries still reach the recorder',t=>{
  const f=fixture(t);f.owner.start();const bad=Object.defineProperty({},'entryType',{get(){throw Error('PRIVATE');}});f.instances[0].deliver([bad,entry()]);
  assert.equal(f.records.length,1);assert.deepEqual(f.errors,['entry']);assert.equal(JSON.stringify(f.owner.getState()).includes('PRIVATE'),false);
});
test('R15-05 failing entry-list read reports a safe phase and the observer remains usable',t=>{
  const f=fixture(t);f.owner.start();f.instances[0].callback({getEntries(){throw Error('PRIVATE');}});f.instances[0].deliver([entry()]);assert.deepEqual(f.errors,['entries']);assert.equal(f.records.length,1);
});
test('R15-05 record and diagnostic failures cannot escape the host callback',t=>{
  let calls=0;const f=fixture(t,{}, {record:()=>{if(++calls===1)throw Error('PRIVATE');},onError:()=>{throw Error('PRIVATE');}});
  f.owner.start();assert.doesNotThrow(()=>f.instances[0].deliver([entry(),entry()]));assert.equal(calls,2);assert.equal(f.owner.getState().lastFailure,'record');
});
test('R15-05 stop disconnects once and rejects callbacks from the previous generation after restart',t=>{
  const f=fixture(t);f.owner.start();const old=f.instances[0];f.owner.stop();f.owner.stop();assert.equal(old.disconnections,1);old.deliver([entry()]);
  f.owner.start();old.deliver([entry()]);f.instances[1].deliver([entry()]);assert.equal(f.records.length,1);
  assert.deepEqual(f.instances[1].observations,[{type:'longtask',buffered:false}]);
});
test('R15-05 destroy disconnects once and permanently rejects restart or late callbacks',t=>{
  const f=fixture(t);f.owner.start();const old=f.instances[0];f.owner.destroy();f.owner.destroy();f.owner.stop();old.deliver([entry()]);
  assert.equal(old.disconnections,1);assert.equal(f.owner.start(),false);assert.equal(f.records.length,0);assert.equal(f.owner.getState().state,'destroyed');assert.equal(f.owner.getState().observerAttached,false);
});
test('R15-05 destroy before start never resolves or constructs the browser API',t=>{
  const f=fixture(t,{}, {getObserver:()=>{throw Error('Must not resolve');}});f.owner.destroy();assert.equal(f.owner.start(),false);assert.equal(f.instances.length,0);
});
test('R15-05 capability getter failure is visible and does not retain an observer',t=>{
  const f=fixture(t);Object.defineProperty(f.Observer,'supportedEntryTypes',{get(){throw Error('PRIVATE');}});assert.equal(f.owner.start(),false);assert.equal(f.owner.getState().state,'failed');assert.deepEqual(f.errors,['support']);assert.equal(f.instances.length,0);
});
test('R15-05 constructor failure allows a later retry and emits no private error content',t=>{
  let fail=true;const f=fixture(t,{construct(){if(fail)throw Error('PRIVATE');}});assert.equal(f.owner.start(),false);assert.deepEqual(f.errors,['construct']);fail=false;assert.equal(f.owner.start(),true);
});
test('R15-05 rejected observe disconnects the candidate and retries buffered history only after a successful start',t=>{
  let fail=true;const f=fixture(t,{observe(){if(fail)throw Error('PRIVATE');}});assert.equal(f.owner.start(),false);assert.equal(f.instances[0].disconnections,1);f.instances[0].deliver([entry()]);
  fail=false;f.owner.start();assert.equal(f.instances[1].observations[0].buffered,true);assert.equal(f.records.length,0);assert.deepEqual(f.errors,['observe']);
});
test('R15-05 disconnect failure invalidates callbacks and blocks creation of another potentially overlapping observer',t=>{
  const f=fixture(t,{disconnect(){throw Error('PRIVATE');}});f.owner.start();f.owner.stop();f.instances[0].deliver([entry()]);assert.equal(f.owner.start(),false);assert.equal(f.instances.length,1);assert.equal(f.records.length,0);assert.equal(f.owner.getState().cleanupFailed,true);assert.deepEqual(f.errors,['disconnect']);
});
test('R15-05 construction reentrant destroy disconnects the new candidate before observe',t=>{
  const f=fixture(t,{construct(){f.owner.destroy();}});assert.equal(f.owner.start(),false);assert.equal(f.instances[0].observations.length,0);assert.equal(f.instances[0].disconnections,1);
});
test('R15-05 observe reentrant stop cannot restore running state or duplicate disconnection',t=>{
  const f=fixture(t,{observe(){f.owner.stop();}});assert.equal(f.owner.start(),false);assert.equal(f.owner.getState().state,'stopped');assert.equal(f.instances[0].disconnections,1);
});
test('R15-05 disconnect reentrant start cannot install another observer during stop',t=>{
  let result;const f=fixture(t,{disconnect(){result=f.owner.start();}});f.owner.start();f.owner.stop();assert.equal(result,false);assert.equal(f.instances.length,1);assert.equal(f.owner.getState().observerAttached,false);
});
test('R15-05 entry getter reentrant destroy cannot record or inspect subsequent entries',t=>{
  const f=fixture(t);f.owner.start();const bad=Object.defineProperty(entry(),'duration',{get(){f.owner.destroy();return 61;}});
  const later=Object.defineProperty({},'entryType',{get(){throw Error('Must not inspect');}});f.instances[0].deliver([bad,later]);assert.equal(f.records.length,0);assert.equal(f.errors.length,0);
});
test('R15-05 recorder reentrant stop ends delivery at the current entry',t=>{
  let calls=0;const f=fixture(t,{}, {record:()=>{calls++;f.owner.stop();}});f.owner.start();f.instances[0].deliver([entry(),entry()]);assert.equal(calls,1);assert.equal(f.instances[0].disconnections,1);
});
test('R15-05 observer routes through actual Recorder privacy and Buffer acknowledgement without raw browser attribution',async t=>{
  const browser=observerPort(),batches=[];let buffer;
  const recorder=createTelemetryRecorder({sessionId:'longtask-fixture',now:()=>1000,monotonicNow:()=>1,emit:item=>buffer.enqueue(item)});
  buffer=createAggregationBuffer({now:()=>1000,createEntry:recorder.createEntry,batchPrefix:'longtask-fixture',schedule:()=>1,cancel:()=>{},writeBatch:async(entries,meta)=>{batches.push(entries);return {...meta,acceptedCount:meta.offset+entries.length};}});
  const owner=createLongTaskObserver({getObserver:()=>browser.Observer,record:recorder.record});t.after(()=>{owner.destroy();buffer.destroy();recorder.destroy();});owner.start();
  browser.instances[0].deliver([{...entry(),name:'PRIVATE /path',attribution:[{containerSrc:'PRIVATE'}]}]);buffer.setEnabled(true);await buffer.flush();
  assert.equal(batches[0][0].operation,'runtime.long-task');assert.equal(batches[0][0].durationMs,61);assert.deepEqual(batches[0][0].details,{startTime:12.346});assert.equal(JSON.stringify(batches).includes('PRIVATE'),false);assert.equal(buffer.getStats().acknowledgedEntries,1);
});
test('R15-05 actual DEV Runtime starts one longtask observer and pagehide/pageshow disconnect and restart it',async t=>{
  const browser=observerPort(),host=createTelemetryRuntimeHost({dev:true,Observer:browser.Observer});t.after(()=>host.dispose());
  let tasks=browser.instances.filter(item=>item.observations.some(x=>x.type==='longtask'));assert.equal(tasks.length,1);host.configure(true);assert.equal(browser.instances.length,3);
  tasks[0].deliver([entry()]);await host.api.flush();assert.equal(host.entries().filter(x=>x.operation==='runtime.long-task').length,1);
  host.dispatch('window','pagehide');assert.equal(tasks[0].disconnections,1);tasks[0].deliver([entry()]);host.dispatch('window','pageshow');
  tasks=browser.instances.filter(item=>item.observations.some(x=>x.type==='longtask'));assert.equal(tasks.length,2);assert.equal(tasks[1].observations[0].buffered,false);
  tasks[0].deliver([entry()]);tasks[1].deliver([entry()]);await host.api.flush();assert.equal(host.entries().filter(x=>x.operation==='runtime.long-task').length,2);
});
test('R15-05 actual Runtime disable disconnects longtask collection and destroy permanently stops the owner',t=>{
  const browser=observerPort(),host=createTelemetryRuntimeHost({dev:true,Observer:browser.Observer});t.after(()=>host.dispose());const task=browser.instances.find(x=>x.observations.some(o=>o.type==='longtask'));
  host.configure(false);assert.equal(task.disconnections,1);task.deliver([entry()]);host.api.destroyLongTasks();host.configure(true);assert.equal(host.api.getLongTaskState().state,'destroyed');assert.equal(browser.instances.filter(item=>item.observations.some(o=>o.type==='longtask')).length,1);assert.equal(browser.instances.length,5);
});
test('R15-05 actual production Runtime creates no observer even when LogsPort is explicitly enabled',t=>{
  const browser=observerPort(),host=createTelemetryRuntimeHost({dev:false,Observer:browser.Observer});t.after(()=>host.dispose());host.configure(true);assert.equal(browser.instances.length,0);assert.equal(host.api.getLongTaskState().observerAttached,false);assert.equal(host.window.markdownEditorPerf,undefined);
});
