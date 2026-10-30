import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionDragObserver } from '../../../src/features/sync/selection/selection-drag-observer.js';
import { createFrames, FakeTarget } from '../../helpers/stage-09-selection-controller-harness.mjs';
test('drag timing coalesces pointer moves without text or geometry reads and emits numeric frame latency at release',()=>{
  const frames=createFrames(),documentRef=new FakeTarget(),records=[];let time=10;
  const observer=createSelectionDragObserver({editor:{contains:n=>n==='editor'},preview:{contains:n=>n==='preview'},documentRef,
    requestFrame:cb=>frames.request(cb),cancelFrame:id=>frames.cancel(id),now:()=>time,record:(...args)=>records.push(args)});
  observer.start();documentRef.emit('pointerdown',{button:0,target:'preview'});
  documentRef.emit('pointermove',{buttons:1,timeStamp:8});time=12;documentRef.emit('pointermove',{buttons:1,timeStamp:11});
  assert.equal(frames.activeCount(),1);time=20;frames.flush();documentRef.emit('pointerup');
  assert.equal(records.length,1);assert.equal(records[0][1].durationMs,12);assert.equal(records[0][1].details.side,'preview');
  documentRef.emit('pointerdown',{button:0,target:'editor'});documentRef.emit('pointermove',{buttons:1,timeStamp:20});
  const stale=frames.activeIds()[0];observer.destroy();frames.force(stale);assert.equal(records.length,1);
  for(const listeners of documentRef.listeners.values())assert.equal(listeners.size,0);
});
