import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorScrollMapper } from '../src/features/sync/index.js';

function createModel() {
  const ranges = [
    { start: 0, end: 3 },
    { start: 4, end: 8 },
    { start: 9, end: 9 }
  ];
  return {
    getTextLength() { return 9; },
    getLineCount() { return ranges.length; },
    getLineNumberAtPosition(position) {
      const value = Math.max(0, Math.min(9, Number(position) || 0));
      if (value <= 3) return 1;
      if (value <= 8) return 2;
      return 3;
    },
    getLineStart(line) { return ranges[Math.max(0, Math.min(2, Number(line) - 1))].start; },
    getLineEnd(line) { return ranges[Math.max(0, Math.min(2, Number(line) - 1))].end; }
  };
}

function createEditorApi() {
  const calls = { lineAtHeight: [], heightForLine: [], heightForPosition: [] };
  return {
    calls,
    selection: { anchor: 5, head: 5, start: 5, end: 5 },
    scrollMetrics: { top: 140, clientHeight: 200, height: 1000 },
    getSelection() { return { ...this.selection }; },
    getScrollMetrics() { return { ...this.scrollMetrics }; },
    getLineAtHeight(height) { calls.lineAtHeight.push(height); return 1 + height / 100; },
    getHeightForLine(line) { calls.heightForLine.push(line); return line * 100; },
    getHeightForPosition(position) { calls.heightForPosition.push(position); return 50 + position * 10; }
  };
}

function createHarness() {
  const model = createModel();
  const editorApi = createEditorApi();
  const mapper = createEditorScrollMapper({ editorApi, model });
  return { model, editorApi, mapper };
}

test('R9-04 requires explicit neutral CodeMirror geometry and frozen model line-range capabilities', () => {
  const model = createModel();
  const editorApi = createEditorApi();
  assert.throws(() => createEditorScrollMapper({ model }), /CodeMirror geometry capabilities/);
  assert.throws(() => createEditorScrollMapper({ editorApi }), /DocumentModel line-range capabilities/);
  assert.throws(
    () => createEditorScrollMapper({ editorApi: { ...editorApi, getLineAtHeight: null }, model }),
    /CodeMirror geometry capabilities/
  );
});

test('R9-04 model position and line-range mapping is clamped and immutable', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getLineNumberAtPosition(-20), 1);
    assert.equal(h.mapper.getLineNumberAtPosition(5), 2);
    assert.equal(h.mapper.getLineNumberAtPosition(999), 3);
    assert.deepEqual(h.mapper.getLineRange(-5), { lineNumber: 1, start: 0, end: 3 });
    const last = h.mapper.getLineRange(99);
    assert.deepEqual(last, { lineNumber: 3, start: 9, end: 9 });
    assert.equal(Object.isFrozen(last), true);
  } finally {
    h.mapper.destroy();
  }
});

test('R9-04 content Y maps to a bounded fractional source line through CodeMirror geometry', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getLineAtContentY(-50), 1);
    assert.equal(h.mapper.getLineAtContentY(150), 2.5);
    assert.equal(h.mapper.getLineAtContentY(9999), 3.999);
    assert.deepEqual(h.editorApi.calls.lineAtHeight, [0, 150, 9999]);
  } finally {
    h.mapper.destroy();
  }
});

test('R9-04 source line maps to content Y through CodeMirror geometry with model bounds', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getContentYForLine(2.5), 250);
    assert.ok(Math.abs(h.mapper.getContentYForLine(99) - 399.9) < 1e-9);
    assert.deepEqual(h.editorApi.calls.heightForLine, [2.5, 3.999]);
  } finally {
    h.mapper.destroy();
  }
});

test('R9-04 source position maps through its frozen model line range before geometry lookup', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getContentYForPosition(5), 100);
    assert.equal(h.mapper.getContentYForPosition(999), 140);
    assert.deepEqual(h.editorApi.calls.heightForPosition, [5, 9]);
  } finally {
    h.mapper.destroy();
  }
});

test('R9-04 cursor and top-visible line reads remain geometry-only and never own scroll writes', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getCursorLine(), 2);
    assert.equal(h.mapper.getTopVisibleLine(), 2);
    assert.equal(h.mapper.getTopVisibleLine(60), 3);
    assert.deepEqual(h.editorApi.calls.lineAtHeight, [148, 200]);
    assert.equal('setScrollTop' in h.editorApi, false);
  } finally {
    h.mapper.destroy();
  }
});

test('R9-04 destroy is terminal and idempotent', () => {
  const h = createHarness();
  h.mapper.destroy();
  h.mapper.destroy();
  assert.throws(() => h.mapper.getLineCount(), /destroyed/);
  assert.throws(() => h.mapper.getLineRange(1), /destroyed/);
  assert.throws(() => h.mapper.getContentYForLine(1), /destroyed/);
});
