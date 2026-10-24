import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createTelemetryLifecycle} from '../src/features/telemetry/index.js';
import {createTelemetryRuntimeHost} from './support/telemetry-runtime-host.mjs';
const tick=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
class Target {
 constructor(){this.listeners=[];this.visibilityState='visible';}
 addEventListener(type,fn,options){this.listeners.push({type,fn,capture:typeof options==='boolean'?options:Boolean(options?.capture)});}
 removeEventListener(type,fn,capture){this.listeners=this.listeners.filter(x=>!(x.type===type&&x.fn===fn&&x.capture===Boolean(capture)));}
 fire(type,event={}){for(const item of [...this.listeners])if(item.type===type)item.fn(event);}
}
function fixture(t,extra={}) {
 const win=new Target(),doc=new Target(),timers=new Map(),frames=new Map(),errors=[],observers=[];let enabled=true,id=0,scope;
 const counts={installs:0,starts:0,stops:0,destroys:0,drains:0,flushes:0,events:0};
 class Observer {constructor(cb){this.cb=cb;this.disconnections=0;observers.push(this);}observe(options){this.options=options;}disconnect(){this.disconnections++;}}
 const owner=createTelemetryLifecycle({getWindow:()=>win,getDocument:()=>doc,isEnabled:()=>enabled,
  install(s){scope=s;counts.installs++;s.listen(doc,'click',()=>counts.events++,true);s.observe(Observer,()=>counts.events++,{type:'event'});},
  startOwners:()=>counts.starts++,stopOwners:()=>counts.stops++,destroyOwners:()=>{counts.destroys++;return Object.freeze({pending:1});},drain:()=>counts.drains++,flush:()=>{counts.flushes++;},
  schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},cancel:key=>timers.delete(key),requestFrame:fn=>{frames.set(++id,fn);return id;},cancelFrame:key=>frames.delete(key),onError:x=>errors.push(x),...extra});
 t.after(()=>owner.destroy());return {owner,win,doc,timers,frames,errors,counts,observers,get scope(){return scope;},enable:value=>{enabled=value;},async timer(ms){const [key,item]=[...timers].find(([,x])=>x.ms===ms);timers.delete(key);item.fn();await tick();}};
}
test('R15-08 public Lifecycle owns resources without global DOM or native storage',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),source=read('src/features/telemetry/telemetry-lifecycle.js');assert.doesNotMatch(source,/\b(?:window|document|globalThis)\.|setInterval\(|setTimeout\(|node:fs|@tauri|writePerformance/);assert.match(read('src/features/telemetry/index.js'),/export \{ createTelemetryLifecycle \}/);
 const runtime=read('src/features/telemetry/browser-telemetry.js');assert.match(runtime,/telemetryLifecycle = createTelemetryLifecycle/);assert.doesNotMatch(runtime,/setInterval\(|document.addEventListener\(|window.addEventListener\(|new PerformanceObserver\(/);assert.match(read('src/main.js'),/if \(import.meta.env.DEV\) destroyPerformanceTelemetry\(\)/);
});
for(const name of ['getWindow','getDocument','isEnabled','install','startOwners','stopOwners','destroyOwners','drain','flush','schedule','cancel','requestFrame','cancelFrame','onError'])test('R15-08 rejects invalid dependency '+name,t=>{assert.throws(()=>fixture(t,{[name]:null}),TypeError);});
for(const [name,value]of [['aggregateMs',999],['aggregateMs',300001],['aggregateMs',1.5],['flushMs',0],['flushMs',300001]])test('R15-08 rejects unbounded period '+name+' '+value,t=>{assert.throws(()=>fixture(t,{[name]:value}),TypeError);});
test('R15-08 construction is cold and repeated start mounts exactly one pair of periodic timers',t=>{
 const f=fixture(t);assert.equal(f.timers.size,0);assert.equal(f.win.listeners.length,0);assert.equal(f.owner.start(),true);assert.equal(f.owner.start(),true);assert.equal(f.counts.installs,1);assert.equal(f.timers.size,2);assert.equal(f.win.listeners.length,2);assert.equal(f.doc.listeners.length,2);assert.equal(f.observers.length,1);
});
test('R15-08 repeated mount retains only the three control listeners while disabled',t=>{
 const f=fixture(t);f.enable(false);assert.equal(f.owner.mount(),true);f.owner.mount();assert.equal(f.owner.start(),false);assert.equal(f.owner.getState().controlListeners,3);assert.equal(f.timers.size,0);assert.equal(f.counts.installs,0);
});
test('R15-08 periodic completion schedules one successor and an unresolved flush never overlaps',async t=>{
 let resolve,calls=0;const f=fixture(t,{flush:()=>{calls++;return new Promise(r=>{resolve=r;});}});f.owner.start();await f.timer(1500);assert.equal(f.counts.drains,1);assert.equal(f.timers.size,2);await f.timer(2000);assert.equal(calls,1);assert.equal([...f.timers.values()].filter(x=>x.ms===2000).length,0);resolve();await tick();assert.equal([...f.timers.values()].filter(x=>x.ms===2000).length,1);
});
test('R15-08 pagehide flushes once pauses resources and pageshow resumes one generation',async t=>{
 const f=fixture(t);f.owner.start();const observer=f.observers[0],old=[...f.timers.values()];f.win.fire('pagehide');f.win.fire('pagehide');assert.equal(f.counts.flushes,1);assert.equal(f.timers.size,0);assert.equal(f.doc.listeners.filter(x=>x.type==='click').length,0);assert.equal(observer.disconnections,1);old.forEach(x=>x.fn());observer.cb({});await tick();assert.equal(f.counts.events,0);assert.equal(f.counts.drains,1);f.win.fire('pageshow');assert.equal(f.timers.size,2);assert.equal(f.observers.length,2);f.owner.start();assert.equal(f.timers.size,2);
});
test('R15-08 hidden visibility pauses and visible resumes only while enabled',t=>{
 const f=fixture(t);f.owner.start();f.doc.visibilityState='hidden';f.doc.fire('visibilitychange');assert.equal(f.timers.size,0);assert.equal(f.owner.start(),false);f.enable(false);f.doc.visibilityState='visible';f.doc.fire('visibilitychange');assert.equal(f.timers.size,0);f.enable(true);f.doc.fire('visibilitychange');assert.equal(f.timers.size,2);
});
test('R15-08 stop removes matching capture listeners and invalidates retained DOM callbacks',t=>{
 const f=fixture(t);f.owner.start();const click=f.doc.listeners.find(x=>x.type==='click');click.fn();assert.equal(f.counts.events,1);f.owner.stop();f.owner.stop();click.fn();assert.equal(f.counts.events,1);assert.equal(f.counts.stops,1);assert.equal(f.doc.listeners.filter(x=>x.type==='click').length,0);assert.equal(f.owner.getState().controlListeners,3);
});
test('R15-08 stop cancels all owned frames and timeouts and rejects late delivery',t=>{
 const f=fixture(t);f.owner.start();let calls=0;f.scope.frame(()=>{calls++;f.scope.frame(()=>calls++);});f.scope.timeout(()=>calls++,140);const frame=[...f.frames.values()][0],old=[...f.timers.values()];f.owner.stop();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);frame();old.forEach(x=>x.fn());assert.equal(calls,0);assert.equal(f.frames.size,0);
});
test('R15-08 destroy releases controls and owners once and returns stable readonly handoff',t=>{
 const f=fixture(t);f.owner.start();const old=f.win.listeners.map(x=>x.fn),report=f.owner.destroy();assert.equal(f.owner.destroy(),report);assert.equal(report.handoff.pending,1);assert.ok(Object.isFrozen(report));assert.equal(f.win.listeners.length,0);assert.equal(f.doc.listeners.length,0);assert.equal(f.counts.destroys,1);assert.equal(f.timers.size,0);old.forEach(fn=>fn());assert.equal(f.owner.start(),false);assert.equal(f.owner.mount(),false);
});
test('R15-08 destroy during an unresolved periodic flush cannot schedule a successor',async t=>{
 let resolve;const f=fixture(t,{flush:()=>new Promise(r=>{resolve=r;})});f.owner.start();await f.timer(2000);f.owner.destroy();resolve();await tick();assert.equal(f.timers.size,0);assert.equal(f.owner.getState().state,'destroyed');
});
test('R15-08 installation failure rolls back prior listeners timers and observers',t=>{
 let scope;const f=fixture(t,{install:s=>{scope=s;s.listen(f.doc,'click',()=>{},true);s.timeout(()=>{},100);throw Error('PRIVATE');}});assert.equal(f.owner.start(),false);assert.equal(f.timers.size,0);assert.equal(f.doc.listeners.filter(x=>x.type==='click').length,0);assert.equal(scope.active(),false);assert.equal(f.owner.getState().lastFailure,'start');assert.equal(JSON.stringify(f.errors).includes('PRIVATE'),false);
});
test('R15-08 disposer failure still cleans other resources and permanently blocks restart',t=>{
 const f=fixture(t);f.owner.start();let done=0;f.scope.own(()=>done++);f.scope.own(()=>{throw Error('PRIVATE');});f.owner.stop();assert.equal(done,1);assert.equal(f.timers.size,0);assert.equal(f.observers[0].disconnections,1);assert.equal(f.owner.getState().cleanupFailed,true);assert.equal(f.owner.start(),false);assert.equal(f.owner.destroy().state,'destroyed');
});
test('R15-08 observer attach failure disconnects its candidate and remains an optional capability',t=>{
 let disconnected=0;class Broken {observe(){throw Error('PRIVATE');}disconnect(){disconnected++;}}
 const f=fixture(t,{install:s=>{assert.equal(s.observe(Broken,()=>{},{type:'event'}),false);}});assert.equal(f.owner.start(),true);assert.equal(disconnected,1);assert.equal(f.timers.size,2);assert.equal(f.errors.includes('observer'),true);
});
test('R15-08 scheduler failure rolls back startup without a busy retry loop',t=>{
 let calls=0;const f=fixture(t,{schedule:()=>{calls++;throw Error('PRIVATE');}});assert.equal(f.owner.start(),false);assert.equal(calls,1);assert.equal(f.owner.getState().state,'stopped');assert.equal(f.owner.getState().activeResources,0);
});
test('R15-08 synchronous scheduler is rejected before recursive periodic work',t=>{
 let calls=0;const f=fixture(t,{schedule:fn=>{calls++;fn();return 1;}});assert.equal(f.owner.start(),false);assert.equal(calls,1);assert.equal(f.counts.drains,0);assert.equal(f.owner.getState().activeTimers,0);
});
test('R15-08 cancel failure marks physical cleanup uncertainty and blocks duplicate restart',t=>{
 const f=fixture(t,{cancel:()=>{throw Error('PRIVATE');}});f.owner.start();f.owner.stop();assert.equal(f.owner.getState().cleanupFailed,true);assert.equal(f.owner.start(),false);assert.equal(f.owner.getState().activeTimers,0);
});
test('R15-08 start port reentrant destroy prevents later periodic work',t=>{
 const f=fixture(t,{startOwners:()=>f.owner.destroy()});assert.equal(f.owner.start(),false);assert.equal(f.timers.size,0);assert.equal(f.win.listeners.length,0);assert.equal(f.owner.getState().state,'destroyed');
});
test('R15-08 a resource registered after stop is disposed immediately',t=>{
 const f=fixture(t);f.owner.start();const scope=f.scope;f.owner.stop();let calls=0;scope.own(()=>calls++);assert.equal(calls,1);assert.equal(f.owner.getState().activeResources,0);
});
test('R15-08 frame and timeout pressure remains bounded',t=>{
 const f=fixture(t);f.owner.start();for(let i=0;i<1100;i++){f.scope.frame(()=>{});f.scope.timeout(()=>{},140);}assert.equal(f.frames.size,64);assert.equal(f.timers.size,1000);f.owner.stop();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});
test('R15-08 actual Runtime owns three periodic timers and no intervals across repeated start',t=>{
 const h=createTelemetryRuntimeHost({dev:true});t.after(()=>h.dispose());h.api.startPerformanceTelemetry();h.configure(true);assert.deepEqual([...h.timers.values()].map(x=>x.delay).sort((a,b)=>a-b),[1500,2000,30000]);assert.equal([...h.timers.values()].some(x=>x.interval),false);assert.equal(h.api.getLifecycleState().controlListeners,3);
});
test('R15-08 actual Runtime cancels pending interaction frames and scroll burst on pagehide',async t=>{
 const h=createTelemetryRuntimeHost({dev:true});t.after(()=>h.dispose());await h.api.flush();const target=new h.Element({id:'editor',scrollTop:12});h.dispatch('document','input',{target});h.dispatch('document','scroll',{target});assert.equal(h.frames.size,1);assert.equal([...h.timers.values()].filter(x=>x.delay===140).length,1);const oldFrame=[...h.frames.values()][0],oldBurst=[...h.timers.values()].find(x=>x.delay===140);h.dispatch('window','pagehide',{persisted:true});oldFrame();oldBurst.callback();await tick();assert.equal(h.frames.size,0);assert.equal([...h.timers.values()].filter(x=>[140,1500,2000,30000].includes(x.delay)).length,0);assert.equal(h.entries().some(x=>x.operation==='interaction.scroll.burst'||x.operation==='interaction.input.frame'),false);
});
test('R15-08 current Runtime never wraps application globals across pause/resume/destroy',async t=>{
 const h=createTelemetryRuntimeHost({dev:true});t.after(()=>h.dispose());const original=()=>7;h.window.setupDocuments=original;h.api.startPerformanceTelemetry();assert.equal(h.window.setupDocuments,original);h.dispatch('window','pagehide',{persisted:true});assert.equal(h.window.setupDocuments,original);h.dispatch('window','pageshow');assert.equal(h.window.setupDocuments,original);const replacement=()=>8;h.window.setupDocuments=replacement;h.api.destroyPerformanceTelemetry();assert.equal(h.window.setupDocuments,replacement);assert.equal(Object.hasOwn(h.window,'markdownEditorPerf'),false);
});
test('R15-08 actual Runtime destroy preserves unconfirmed data and cancels an in-flight native wait',async t=>{
 const h=createTelemetryRuntimeHost({dev:true});t.after(()=>h.dispose());await h.api.flush();h.api.configurePerformancePlatform({enabled:true,logs:{writePerformance:()=>new Promise(()=>{})}});h.api.record('fixture',{details:{count:9}});const waiting=h.api.flush();await tick();const result=h.api.destroyPerformanceTelemetry();await waiting;assert.equal(result.handoff.retainedEntries,1);assert.equal(result.handoff.pending[0].entry.details.count,9);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);assert.equal([...h.events.values()].flat().length,0);const before=h.batches.length;h.configure(true);h.api.record('late');await h.api.flush();assert.equal(h.batches.length,before);assert.equal(h.api.destroyPerformanceTelemetry(),result);
});
test('R15-08 production remains cold and explicit manual measurement still works before destroy',async t=>{
 const h=createTelemetryRuntimeHost({dev:false});t.after(()=>h.dispose());assert.equal(h.api.getLifecycleState(),null);assert.equal([...h.events.values()].flat().length,0);h.api.record('fixture',{details:{count:1}});await h.api.flush();assert.equal(h.entries().length,1);assert.equal(h.timers.size,0);h.api.destroyPerformanceTelemetry();assert.equal(h.api.measure('after',()=>11),11);h.api.record('after');assert.equal(h.entries().length,1);
});
test('R15-08 reentrant enable port stop invalidates the callback before publication',t=>{
 let armed=false;const f=fixture(t,{isEnabled:()=>{if(armed)f.owner.stop();return true;}});f.owner.start();let calls=0;const cb=f.scope.guard(()=>calls++);armed=true;cb();assert.equal(calls,0);assert.equal(f.timers.size,0);
});
test('R15-08 listener attached after a reentrant stop is explicitly removed',t=>{
 const f=fixture(t);f.owner.start();const target=new Target();target.addEventListener=(...args)=>{f.owner.stop();Target.prototype.addEventListener.apply(target,args);};f.scope.listen(target,'late',()=>{},true);assert.equal(target.listeners.length,0);assert.equal(f.timers.size,0);
});
test('R15-08 observer attached after reentrant stop is disconnected again',t=>{
 const f=fixture(t);f.owner.start();let attached=false,disconnected=0;class Reentrant {observe(){f.owner.stop();attached=true;}disconnect(){attached=false;disconnected++;}}assert.equal(f.scope.observe(Reentrant,()=>{},{type:'event'}),false);assert.equal(attached,false);assert.equal(disconnected,2);
});
test('R15-08 control listener registration reentrant destroy leaves no attached listener',t=>{
 const f=fixture(t);const add=f.win.addEventListener;f.win.addEventListener=function(...args){f.owner.destroy();add.apply(this,args);};assert.equal(f.owner.mount(),false);assert.equal(f.win.listeners.length,0);assert.equal(f.owner.getState().controlListeners,0);
});
test('R15-08 destroy requested by a disposer completes after the whole stop cleanup',t=>{
 const f=fixture(t);f.owner.start();let cleaned=0;f.scope.own(()=>cleaned++);f.scope.own(()=>f.owner.destroy());f.owner.stop();assert.equal(cleaned,1);assert.equal(f.owner.getState().state,'destroyed');assert.equal(f.owner.getState().activeResources,0);assert.equal(f.win.listeners.length,0);assert.equal(f.counts.destroys,1);
});
test('R15-08 destroy-owner failure is safe and does not restore controls or periodic work',t=>{
 const f=fixture(t,{destroyOwners:()=>{throw Error('PRIVATE');}});f.owner.start();const report=f.owner.destroy();assert.equal(report.cleanupFailed,true);assert.equal(report.lastFailure,'destroy-owners');assert.equal(f.timers.size,0);assert.equal(f.doc.listeners.length,0);assert.equal(f.owner.start(),false);
});
