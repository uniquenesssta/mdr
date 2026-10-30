import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewSelectionTarget } from '../../../src/features/sync/selection/preview-selection-target.js';
import { createFrames } from '../../helpers/stage-09-selection-controller-harness.mjs';

function fixture() {
  const frames=createFrames(),writes=[],scrolls=[],records=[];
  let visible=false,identity='doc-a:1:0',time=100,selection={start:0,end:0},top=0,position=60,mounted=true;
  const target=createPreviewSelectionTarget({
    editorApi:{getSelection:()=>selection,getScrollMetrics:()=>({top,clientHeight:200}),
      getScrollViewportRect:()=>({top:0,bottom:200}),getPositionCoordinates:()=>mounted?({top:position-top,bottom:position-top+18}):null},
    setSelection:(start,end)=>{writes.push({start,end});selection={start,end};},
    editorMapper:{getContentYForPosition:()=>position},
    scrollController:{scrollTo:(_side,value,options)=>{scrolls.push({value,options});top=value;return true;}},
    isVisible:()=>visible,getIdentity:()=>identity,requestFrame:cb=>frames.request(cb),cancelFrame:id=>frames.cancel(id),
    now:()=>time,record:(...args)=>records.push(args)
  });
  return {target,frames,writes,scrolls,records,setVisible:value=>visible=value,setIdentity:value=>identity=value,
    setTime:value=>time=value,setPosition:value=>position=value,setMounted:value=>mounted=value};
}
test('pure reading retains only a document bookmark, then restores it when the editor becomes visible',()=>{
  const h=fixture();h.target.select(8,20,70);
  assert.equal(h.target.getState().hasReadingBookmark,true);assert.deepEqual(h.writes,[]);assert.deepEqual(h.scrolls,[]);
  h.target.layoutChanged();h.frames.flushAll();assert.equal(h.writes.length,0);
  h.setVisible(true);h.target.layoutChanged();h.frames.flushAll();
  assert.deepEqual(h.writes,[{start:8,end:20}]);assert.equal(h.scrolls.length,0);assert.equal(h.records.length,0);
  h.target.destroy();
});
test('replacement, generation/version changes and deliberate new gestures cannot replay stale reading bookmarks',()=>{
  for(const change of [h=>h.setIdentity('doc-b:1:0'),h=>h.setIdentity('doc-a:2:0'),h=>h.setIdentity('doc-a:1:1'),h=>h.target.cancel({forget:true})]){
    const h=fixture();h.target.select(8,20);change(h);h.setVisible(true);h.target.layoutChanged();h.frames.flushAll();assert.equal(h.writes.length,0);h.target.destroy();
  }
});
test('visible targets remain still, release latency waits for stable actual geometry, and repeated selections avoid redundant writes',()=>{
  const h=fixture();h.setVisible(true);h.target.select(8,20,70);
  assert.equal(h.records.length,0);h.setTime(130);h.frames.flushAll();
  assert.equal(h.scrolls.length,0);assert.equal(h.records[0][1].durationMs,60);assert.equal(h.records[0][1].details.direction,'preview-to-editor');
  h.target.select(8,20,130);h.frames.flushAll();assert.equal(h.writes.length,1);h.target.destroy();
});
test('offscreen targets scroll instantly to the nearest edge and cancellation invalidates forced stale callbacks',()=>{
  const h=fixture();h.setVisible(true);h.setPosition(400);h.target.select(8,20,70);
  assert.equal(h.scrolls[0].value,226);assert.equal(h.scrolls[0].options.behavior,'auto');
  const stale=h.frames.activeIds()[0];h.target.destroy();h.frames.force(stale);assert.equal(h.records.length,0);
});
test('unmounted targets cannot be reported as successful and bounded settlement exhaustion remains visible in logs',()=>{
  const h=fixture();h.setVisible(true);h.setMounted(false);h.target.select(8,20,70);h.frames.flushAll(50);
  assert.equal(h.target.getState().previewRevealsCompleted,0);assert.equal(h.target.getState().previewRevealTimeouts,1);
  assert.equal(h.records[0][1].status,'warning');assert.equal(h.records[0][1].details.completed,false);
  h.target.destroy();
});
