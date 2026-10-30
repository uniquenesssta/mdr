import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinalSelectionController } from './helpers/stage-09-selection-controller-harness.mjs';

test('native editor drags keep expensive counterpart mapping out of pointer movement and publish the final release once',()=>{
  const h=createFinalSelectionController();let mapped=0;
  h.controller.syncEditorToPreview=()=>{mapped++;return {status:'exact'};};
  try{
    h.controller.start();h.editor.emit('pointerdown');
    for(let i=0;i<100;i++){h.editor.emit('select');h.frames.flushAll();}
    assert.equal(mapped,0);assert.equal(h.controller.getState().editorRequests,0);
    h.documentRef.emit('pointerup');h.frames.flushAll();assert.equal(mapped,1);
  }finally{h.controller.destroy();}
});

function fixture({ top = 70, height = 20, scrollTop = 0 } = {}) {
  let contentTop = top;
  const writes = [];
  const h = createFinalSelectionController({
    highlightSession: { canPresent: () => true, show() {}, restore() {}, clear() {} },
    selectionMapping: {
      createPreviewRangesForSourceSelection: () => ({
        ranges: [{ getClientRects: () => [{ top: contentTop - h.preview.scrollTop, bottom: contentTop + height - h.preview.scrollTop, left: 0, right: 20, width: 20, height }] }],
        sourceCharacters: 4, mappedCharacters: 4, projectionCoverage: 1
      }),
      mapPreviewDomPointToSource() {}
    }
  });
  h.preview.scrollTop = scrollTop;
  h.previewMapper.getAnchors = () => [{ dataset: { sourceStartIndex: '0', sourceEndIndex: '10' } }];
  h.controller.scrollController.getState = () => ({ sourceSide: 'editor', sourceReason: 'pointer' });
  h.controller.scrollController.scrollTo = (side, value, options) => {
    writes.push({ side, value, options }); h.preview.scrollTop = value; return true;
  };
  return { ...h, writes, moveTarget: value => { contentTop = value; } };
}

test('a visible editor-to-preview selection highlights without moving the preview or claiming same-height alignment', () => {
  const h = fixture();
  try {
    const result = h.controller.runEditor(true, 'editor-pointerup', true, 0);
    assert.equal(result.status, 'exact'); assert.equal(result.mappingCoverage, 1);
    assert.equal(h.writes.length, 0); assert.equal(h.preview.scrollTop, 0);
    assert.equal(result.targetViewportRatio, 0.4); assert.notEqual(result.targetViewportRatio, result.sourceViewportRatio);
  } finally { h.controller.destroy(); }
});

for (const [name, top, expected] of [['above', 20, 12], ['below', 330, 158]]) {
  test(`an offscreen selection ${name} uses only the nearest viewport edge with an 8px inset`, () => {
    const h = fixture({ top, scrollTop: 100 });
    try {
      assert.equal(h.controller.runEditor(true, 'editor-pointerup', true, 0).status, 'exact');
      assert.equal(h.writes.length, 1); assert.equal(h.preview.scrollTop, expected);
      assert.equal(h.writes[0].options.behavior, 'auto'); assert.equal(h.writes[0].side, 'preview');
    } finally { h.controller.destroy(); }
  });
}

test('an oversized selection already intersecting the viewport does not chase its far edge', () => {
  const h = fixture({ top: -30, height: 500 });
  try { h.controller.runEditor(true, 'editor-pointerup', true, 0); assert.equal(h.writes.length, 0); }
  finally { h.controller.destroy(); }
});

test('mount and geometry notifications restore the highlight without reopening a completed reveal', () => {
  const h = fixture({ top: 330, scrollTop: 100 });
  try {
    h.controller.runEditor(true, 'editor-pointerup', true, 0);
    h.frames.flushAll();
    h.moveTarget(500);
    h.controller.notifyPreviewMounted('height-measured'); h.frames.flushAll();
    h.controller.notifyEditorGeometry('viewport-resized'); h.frames.flushAll();
    assert.equal(h.writes.length, 1); assert.equal(h.preview.scrollTop, 158);
    assert.equal(h.controller.shouldRealignEditorSelection(), false);
    h.controller.start(); h.editor.emit('pointerdown'); h.documentRef.emit('pointerup'); h.frames.flushAll();
    assert.equal(h.writes.length, 2, 'a fresh deliberate selection may reveal the target again');
  } finally { h.controller.destroy(); }
});

test('a first chapter reveal follows measured block heights before it completes', () => {
  const h = fixture({ top: 330, scrollTop: 100 });
  try {
    h.controller.runEditor(true, 'editor-pointerup', true, 0);
    h.moveTarget(430); // The virtual chapter replaces its estimated block height.
    h.controller.notifyPreviewMounted('chapter-measured'); h.frames.flushAll();
    assert.equal(h.writes.length, 2); assert.equal(h.preview.scrollTop, 258);
    assert.equal(h.controller.shouldRealignEditorSelection(), false);
    h.controller.notifyPreviewMounted('later-refresh'); h.frames.flushAll();
    assert.equal(h.writes.length, 2);
  } finally { h.controller.destroy(); }
});

test('a real pane-size change invalidates a completed reveal while unchanged measurements stay quiet', () => {
  const h=fixture();
  try {
    h.controller.runEditor(true,'editor-pointerup',true,0);h.frames.flushAll();
    h.moveTarget(340);h.preview.clientWidth=220;
    assert.equal(h.controller.notifyLayoutGeometry(),true);h.frames.flushAll();
    assert.equal(h.writes.length,1);assert.equal(h.preview.scrollTop,168);
    const revision=h.controller.layoutRevision;
    h.controller.notifyLayoutGeometry();h.frames.flushAll();assert.equal(h.controller.layoutRevision,revision);
    assert.equal(h.writes.length,1);
  }finally{h.controller.destroy();}
});

test('pane resizing does not steal the preview from a manual preview scroll', () => {
  const h=fixture();
  try {
    h.controller.scheduleEditor(true,'editor-pointerup',{force:true,frames:2});
    h.controller.scrollController.getState=()=>({sourceSide:'preview',sourceReason:'wheel'});
    h.moveTarget(400);h.preview.clientWidth=220;h.controller.notifyLayoutGeometry();h.frames.flushAll();
    assert.equal(h.writes.length,0);
  }finally{h.controller.destroy();}
});

test('a native preview selection keeps ownership while pane geometry is recalibrated', () => {
  const h=fixture();let remapped=0;
  try {
    h.controller.previewSelectionReader.read=()=>({text:'view selection'});
    h.controller.schedulePreview=()=>{remapped++;};
    h.preview.clientWidth=220;h.controller.notifyLayoutGeometry();h.frames.flushAll();
    assert.equal(h.writes.length,0);assert.equal(remapped,1);
  }finally{h.controller.destroy();}
});

test('a selected line break clears stale highlights without a pending retry or mapping warning', () => {
  let clears=0,warnings=0;
  const h=createFinalSelectionController({source:'a\nb',editorSelection:{from:1,to:2,isCollapsed:false},
    highlightSession:{canPresent:()=>true,show(){},restore(){},clear(){clears++;}}});
  h.controller.diagnostic=()=>warnings++;
  try{assert.equal(h.controller.runEditor(true,'editor-pointerup',true,0).status,'cleared');assert.equal(warnings,0);assert.equal(clears,1);}
  finally{h.controller.destroy();}
});

test('measurement-only notifications do not rebuild completed highlights or advance the DOM revision', () => {
  const h=fixture();let restores=0;
  try {
    h.controller.highlightSession.restore=()=>restores++;
    h.controller.runEditor(true,'editor-pointerup',true,0);h.frames.flushAll();
    const revision=h.controller.feedbackGuard.getRevision(),requests=h.controller.stats.editorRequests;
    for(let i=0;i<20;i++)h.controller.notifyPreviewMeasured();h.frames.flushAll();
    assert.equal(restores,0);assert.equal(h.controller.feedbackGuard.getRevision(),revision);
    assert.equal(h.controller.stats.editorRequests,requests);assert.equal(h.writes.length,0);
  }finally{h.controller.destroy();}
});

test('measurement-only notifications still settle an unfinished reveal at its measured position', () => {
  const h=fixture({top:330,scrollTop:100});
  try {
    h.controller.runEditor(true,'editor-pointerup',true,0);h.moveTarget(430);
    h.controller.notifyPreviewMeasured();h.frames.flushAll();
    assert.equal(h.writes.length,2);assert.equal(h.preview.scrollTop,258);
    assert.equal(h.controller.shouldRealignEditorSelection(),false);
  }finally{h.controller.destroy();}
});

test('completed highlights restore on structural mounts without scheduling hidden-editor synchronization', () => {
  const h=fixture();let restores=0;
  try {
    h.controller.highlightSession.getState=()=>({hasRestore:true});
    h.controller.highlightSession.restore=()=>{restores++;return true;};
    h.controller.runEditor(true,'editor-pointerup',true,0);h.frames.flushAll();
    const requests=h.controller.stats.editorRequests;
    for(let i=0;i<12;i++)h.controller.notifyPreviewMounted();h.frames.flushAll();
    assert.equal(restores,12);assert.equal(h.controller.stats.editorRequests,requests);
    assert.equal(h.writes.length,0);
  }finally{h.controller.destroy();}
});

test('a zero-height preview cannot complete a reveal before its compact pane becomes visible', () => {
  const h=fixture({top:330});
  try {
    h.preview.getBoundingClientRect=()=>({top:0,bottom:h.preview.clientHeight,width:300,height:h.preview.clientHeight});
    h.preview.clientHeight=0;h.controller.notifyLayoutGeometry();
    h.controller.start();h.editor.emit('pointerdown');h.documentRef.emit('pointerup');h.frames.flushAll();
    assert.equal(h.controller.editorIntent.revealed,false);assert.equal(h.writes.length,0);
    h.preview.clientHeight=200;h.controller.notifyLayoutGeometry();h.frames.flushAll();
    assert.equal(h.writes.length,1);assert.equal(h.controller.editorIntent.revealed,true);
  }finally{h.controller.destroy();}
});

test('a real pointer reveal records one unaggregated duration only after consecutive stable visible samples', () => {
  const h=fixture();let clock=100;const records=[];
  try {
    h.controller.now=()=>clock;h.controller.record=(operation,entry)=>records.push({operation,...entry});
    h.controller.start();h.editor.emit('pointerdown');h.documentRef.emit('pointerup');
    h.frames.flush();assert.equal(records.filter(r=>r.operation==='selection.reveal-latency').length,0);
    while(h.frames.activeCount()){clock+=16;h.frames.flush();}
    const timings=records.filter(r=>r.operation==='selection.reveal-latency');
    assert.equal(timings.length,1);assert.equal(timings[0].durationMs,48);
    assert.equal(timings[0].aggregate,undefined);assert.equal(timings[0].details.stableFrames,3);
    h.controller.notifyPreviewMeasured();h.frames.flushAll();
    assert.equal(records.filter(r=>r.operation==='selection.reveal-latency').length,1);
  }finally{h.controller.destroy();}
});
