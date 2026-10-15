import { createTelemetryRecorder, redactTelemetryIdentity, createAggregationBuffer, createLongTaskObserver, createRuntimeSnapshotRecorder, createNativeLogSink } from '../../src/features/telemetry/index.js';
// Current Runtime characterization: inject the actual public Recorder into an isolated
// VM with injected browser ports and without native I/O. Only un-migrated Runtime
// diagnostics/DOM composition use this loader; remove the remainder at R15.11.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
export function createTelemetryRuntimeHost({enabled=true,fail=false,dev=false,Observer,domNodes=7,memory={usedJSHeapSize:1234,totalJSHeapSize:4321}}={}) {
  let clock=1000,id=0;const batches=[],timers=new Map(),warnings=[],events=new Map(),domReads={walks:0,visits:0};
  const listen=(surface,name,callback)=>{const key=surface+':'+name;events.set(key,[...(events.get(key)||[]),callback]);};
  const window={innerWidth:800,innerHeight:600,addEventListener:(name,callback)=>listen('window',name,callback)};
  const document={getElementById:()=>null,querySelectorAll:()=>Array(7).fill(null),addEventListener:(name,callback)=>listen('document',name,callback)};
  document.createTreeWalker=()=>{domReads.walks++;let visited=0;return {nextNode(){domReads.visits++;return visited++<domNodes?{}:null;}};};
  const source=readFileSync(new URL('../../src/runtime/performance.js',import.meta.url),'utf8')
    .replace("import { createTelemetryRecorder, redactTelemetryIdentity, createAggregationBuffer, createLongTaskObserver, createRuntimeSnapshotRecorder, createNativeLogSink } from '../features/telemetry/index.js';", '')
    .replaceAll('export function ','function ').replaceAll('import.meta.env.DEV',String(dev));
  const context=vm.createContext({ createTelemetryRecorder, redactTelemetryIdentity, createAggregationBuffer, createLongTaskObserver, createRuntimeSnapshotRecorder, createNativeLogSink,window,document,
    PerformanceObserver:Observer,navigator:{userAgent:'fixture-browser'},
    crypto:{randomUUID:()=> 'stage15-fixture-session'},Date:{now:()=>clock},Math,Number,
    performance:{now:()=>clock,memory},
    console:{warn:(...args)=>warnings.push(args)},setInterval:(callback,delay)=>{const key=++id;timers.set(key,{callback,delay,interval:true});return key;},
    setTimeout:(callback,delay)=>{const key=++id;timers.set(key,{callback,delay});return key;},clearTimeout:key=>timers.delete(key)});
  vm.runInContext(source+'\n;globalThis.fixtureRuntime={record,diagnostic,measure,flush,drainAggregates,recordRuntimeSnapshot,installLegacyInstrumentation,configurePerformancePlatform,configurePerformanceRuntimeStats,getPerformanceBufferStats,destroyBuffer:()=>buffer?.destroy(),destroyLongTasks:()=>longTaskObserver?.destroy(),getLongTaskState:()=>longTaskObserver?.getState()||{observerAttached:false},destroySnapshots:()=>runtimeSnapshotRecorder?.destroy(),getSnapshotState:()=>runtimeSnapshotRecorder?.getState()||null,destroyNativeSink:()=>nativeLogSink?.destroy()};',context,{filename:'accepted-telemetry-runtime',timeout:1000});
  const api=context.fixtureRuntime;
  const configure=active=>{api.configurePerformancePlatform({enabled:active,logs:{async writePerformance(entries,meta){if(meta?.query)return {...meta,acceptedCount:0,state:'missing'};batches.push(JSON.parse(JSON.stringify(entries)));if(fail)throw new Error('synthetic sink rejection');return meta ? {...meta,acceptedCount:meta.total,state:'complete'} : 'fixture-path';}}});if(!dev&&api.getLongTaskState().observerAttached)throw Error('production initialized observers');};configure(enabled);
  return {api,window,batches,timers,warnings,domReads,configure,advance:ms=>{clock+=ms;},
    entries:()=>batches.flat(),dispatch(surface,name,event={}){for(const callback of events.get(surface+':'+name)||[])callback(event);},
    dispose(){api.destroyNativeSink();api.destroySnapshots();api.destroyLongTasks();api.destroyBuffer();timers.clear();events.clear();}};
}
