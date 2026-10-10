import assert from 'node:assert/strict';
import test from 'node:test';
import { runEmbeddedSession } from './e2e/windows/embedded-session-lifecycle.mjs';

const unavailable = () => Object.assign(new Error('No window could be found.'), {code:'EMBEDDED_WINDOW_STARTUP_TIMEOUT'});
function harness({connectFailure,prepareFailure,startFailure,stopFailure,quitFailure,recordFailure,dead=false,retained=false}={}) {
  const events=[],failures=[],applications=[];
  let calls=0;
  const surface={initialHelpOpen:false};
  const dependencies={
    async start(attempt){events.push(`start:${attempt}`);if(startFailure)throw startFailure;
      const application={attempt,running:!dead,isRunning(){return this.running;},async stop(){events.push(`stop:${attempt}`);if(stopFailure)throw stopFailure;if(!retained)this.running=false;}};
      applications.push(application);return application;},
    async connect(application){events.push(`connect:${application.attempt}`);const error=connectFailure?.(application.attempt);if(error)throw error;
      return {attempt:application.attempt,async deleteSession(){events.push(`quit:${application.attempt}`);if(quitFailure)throw quitFailure;}};},
    async prepare(browser){events.push(`prepare:${browser.attempt}`);if(prepareFailure)throw prepareFailure;return surface;},
    async recordFailure(detail){events.push(`record:${detail.attempt}:${detail.stage}`);failures.push(detail);if(recordFailure)throw recordFailure;},
    isRecoverable:error=>error.code==='EMBEDDED_WINDOW_STARTUP_TIMEOUT'
  };
  return {events,failures,applications,surface,dependencies,get calls(){return calls;},
    execute(callback=async()=> 'passed'){return runEmbeddedSession(dependencies,async(browser,startup)=>{calls++;events.push(`run:${browser.attempt}`);return callback(browser,startup);});}};
}

test('embedded session runs once after preparation and releases session before its host',async()=>{
  const h=harness();assert.equal(await h.execute(async(browser,surface)=>{assert.equal(browser.attempt,1);assert.equal(surface,h.surface);return 'passed';}),'passed');
  assert.deepEqual(h.events,['start:1','connect:1','prepare:1','run:1','quit:1','stop:1']);assert.equal(h.calls,1);assert.equal(h.applications[0].running,false);
});
test('window startup recovery saves the failed attempt and stops its process before creating a fresh host',async()=>{
  const first=unavailable(),h=harness({connectFailure:attempt=>attempt===1?first:null});
  assert.equal(await h.execute(),'passed');assert.equal(h.calls,1);assert.notEqual(h.applications[0],h.applications[1]);
  assert.deepEqual(h.events,['start:1','connect:1','record:1:connect','stop:1','start:2','connect:2','prepare:2','run:2','quit:2','stop:2']);
  assert.equal(h.failures[0].error,first);assert.equal(h.failures[0].recover,true);assert.ok(h.applications.every(x=>!x.running));
});
test('two unavailable windows preserve both errors and never start a third host or product assertion',async()=>{
  const errors=[unavailable(),unavailable()],h=harness({connectFailure:attempt=>errors[attempt-1]});
  await assert.rejects(h.execute(),error=>error instanceof AggregateError&&error.errors[0]===errors[0]&&error.errors[1]===errors[1]);
  assert.equal(h.calls,0);assert.equal(h.applications.length,2);assert.equal(h.failures.length,2);assert.equal(h.failures[1].recover,false);assert.ok(h.applications.every(x=>!x.running));
});
test('exited host with a window-startup error is never recovered',async()=>{
  const error=unavailable(),h=harness({dead:true,connectFailure:()=>error});await assert.rejects(h.execute(),value=>value===error);
  assert.equal(h.applications.length,1);assert.equal(h.failures[0].recover,false);assert.equal(h.calls,0);
});
test('server or protocol errors are not classified as missing-window recovery',async()=>{
  const error=new Error('WebDriver status returned HTTP 500.'),h=harness({connectFailure:()=>error});await assert.rejects(h.execute(),value=>value===error);
  assert.equal(h.applications.length,1);assert.equal(h.failures[0].recover,false);
});
test('failed preparation cannot retry even when its error resembles unavailable startup',async()=>{
  const error=unavailable(),h=harness({prepareFailure:error});await assert.rejects(h.execute(),value=>value===error);
  assert.equal(h.calls,0);assert.equal(h.failures[0].stage,'prepare');assert.equal(h.failures[0].recover,false);assert.deepEqual(h.events.slice(-2),['quit:1','stop:1']);
});
test('failed product assertion runs exactly once and preserves cleanup without retry',async()=>{
  const error=unavailable(),h=harness();await assert.rejects(h.execute(async()=>{throw error;}),value=>value===error);
  assert.equal(h.calls,1);assert.equal(h.applications.length,1);assert.equal(h.failures[0].stage,'run');assert.equal(h.failures[0].recover,false);assert.deepEqual(h.events.slice(-2),['quit:1','stop:1']);
});
test('failed host cleanup blocks recovery and preserves startup plus cleanup errors',async()=>{
  const first=unavailable(),cleanup=new Error('process still running'),h=harness({connectFailure:()=>first,stopFailure:cleanup});
  await assert.rejects(h.execute(),error=>error instanceof AggregateError&&error.errors[0]===first&&error.errors[1]===cleanup);
  assert.equal(h.applications.length,1);assert.equal(h.calls,0);
});
test('a stop method that leaves its process alive blocks a new host',async()=>{
  const first=unavailable(),h=harness({connectFailure:()=>first,retained:true});
  await assert.rejects(h.execute(),error=>error instanceof AggregateError&&error.errors[0]===first&&/still running/.test(error.errors[1].message));assert.equal(h.applications.length,1);
});
test('failed session deletion still stops the host and fails a successful callback',async()=>{
  const error=new Error('quit failed'),h=harness({quitFailure:error});await assert.rejects(h.execute(),value=>value instanceof AggregateError&&value.errors[0]===error);
  assert.equal(h.calls,1);assert.equal(h.applications[0].running,false);assert.equal(h.events.at(-1),'stop:1');
});
test('missing failure diagnostics block recovery and still stop the host',async()=>{
  const first=unavailable(),record=new Error('artifact write failed'),h=harness({connectFailure:()=>first,recordFailure:record});
  await assert.rejects(h.execute(),error=>error instanceof AggregateError&&error.errors[0]===first&&error.errors[1]===record);
  assert.equal(h.applications.length,1);assert.equal(h.applications[0].running,false);assert.equal(h.calls,0);
});
test('failed spawn is recorded without recovery or an invented session',async()=>{
  const error=new Error('spawn ENOENT'),h=harness({startFailure:error});await assert.rejects(h.execute(),value=>value===error);
  assert.deepEqual(h.events,['start:1','record:1:start']);assert.equal(h.failures[0].recover,false);assert.equal(h.calls,0);assert.equal(h.applications.length,0);
});
