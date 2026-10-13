// Stage15 characterization only: load the unchanged accepted runtime in an isolated
// VM, without installing application globals/DOM observers or issuing native I/O.
// R15.2 replaces this source loader with the public Recorder capability.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
export function createTelemetryRuntimeHost({enabled=true,fail=false}={}) {
  let clock=1000,id=0;const batches=[],timers=new Map(),warnings=[],window={innerWidth:800,innerHeight:600};
  const source=readFileSync(new URL('../../src/runtime/performance.js',import.meta.url),'utf8')
    .replaceAll('export function ','function ').replaceAll('import.meta.env.DEV','false');
  const context=vm.createContext({window,document:{getElementById:()=>null,querySelectorAll:()=>Array(7).fill(null)},
    crypto:{randomUUID:()=> 'stage15-fixture-session'},Date:{now:()=>clock},Math,Number,
    performance:{now:()=>clock,memory:{usedJSHeapSize:1234,totalJSHeapSize:4321}},
    console:{warn:(...args)=>warnings.push(args)},setTimeout:(callback,delay)=>{const key=++id;timers.set(key,{callback,delay});return key;},clearTimeout:key=>timers.delete(key)});
  vm.runInContext(source+'\n;globalThis.fixtureRuntime={record,diagnostic,measure,flush,drainAggregates,recordRuntimeSnapshot,installLegacyInstrumentation,configurePerformancePlatform};',context,{filename:'accepted-telemetry-runtime',timeout:1000});
  const api=context.fixtureRuntime;
  const configure=active=>api.configurePerformancePlatform({enabled:active,logs:{async writePerformance(entries){batches.push(JSON.parse(JSON.stringify(entries)));if(fail)throw new Error('synthetic sink rejection');return 'fixture-path';}}});configure(enabled);
  return {api,window,batches,timers,warnings,configure,advance:ms=>{clock+=ms;},
    entries:()=>batches.flat(),dispose(){timers.clear();}};
}
