import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinalSelectionController } from './helpers/stage-09-selection-controller-harness.mjs';

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
