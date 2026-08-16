import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewScrollMapper } from '../src/features/sync/index.js';

function anchor(startLine, endLine, top, height) {
  return {
    dataset: { sourceLine: String(startLine), sourceEndLine: String(endLine) },
    offsetTop: top,
    offsetHeight: height
  };
}

function createHarness({ virtual = false } = {}) {
  const body = { offsetTop: 20 };
  const anchors = [anchor(1, 2, 0, 100), anchor(5, 6, 180, 80)];
  const calls = { query: [], virtualY: [], virtualLine: [], disconnect: 0, observe: [] };
  const previewElement = {
    querySelector(selector) { calls.query.push(selector); return selector === '.markdown-body' ? body : null; },
    querySelectorAll(selector) { calls.query.push(selector); return selector === '[data-source-line]' ? anchors : []; }
  };
  const virtualApi = {
    active: virtual,
    getMountedAnchors() { return [anchor(10, 11, 0, 50)]; },
    getMetrics() { return [{ anchor: 'virtual', startLine: 10, endLine: 11, top: 500, bottom: 600 }]; },
    getContentYForLine(line) { calls.virtualY.push(line); return 700 + Number(line); },
    getLineForContentY(y) { calls.virtualLine.push(y); return 20 + Number(y) / 100; }
  };
  let resizeCallback = null;
  const observer = {
    observe(target) { calls.observe.push(target); },
    disconnect() { calls.disconnect += 1; }
  };
  const timers = new Map();
  let nextTimer = 1;
  const geometry = [];
  const mapper = createPreviewScrollMapper({
    previewElement,
    virtualApi,
    createResizeObserver(callback) { resizeCallback = callback; return observer; },
    setTimer(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimer(id) { timers.delete(id); },
    onGeometryChanged() { geometry.push('preview'); }
  });
  return { mapper, previewElement, virtualApi, body, anchors, calls, timers, geometry, getResizeCallback: () => resizeCallback };
}

test('R9-05 requires preview DOM and virtual geometry capabilities', () => {
  const h = createHarness();
  h.mapper.destroy();
  assert.throws(() => createPreviewScrollMapper({ virtualApi: h.virtualApi }), /preview DOM query capabilities/);
  assert.throws(() => createPreviewScrollMapper({ previewElement: h.previewElement }), /virtual preview geometry capabilities/);
});

test('R9-05 rendered anchors map fractional source lines to preview content Y including gaps', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getContentYForLine(1), 20);
    assert.equal(h.mapper.getContentYForLine(2), 70);
    assert.equal(h.mapper.getContentYForLine(3.5), 160);
    assert.equal(h.mapper.getContentYForLine(5), 200);
    assert.equal(h.mapper.getContentYForLine(6.5), 260);
  } finally { h.mapper.destroy(); }
});

test('R9-05 rendered preview Y maps back to fractional source lines with anchor-gap interpolation', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getLineForContentY(0), 1);
    assert.equal(h.mapper.getLineForContentY(70), 2);
    assert.ok(Math.abs(h.mapper.getLineForContentY(150) - 3.125) < 1e-9);
    assert.equal(h.mapper.getLineForContentY(200), 5);
    assert.equal(h.mapper.getTopVisibleLine(192, 8), 5);
  } finally { h.mapper.destroy(); }
});

test('R9-05 virtual mode delegates mapping and metrics to the Preview virtual height index without DOM reads', () => {
  const h = createHarness({ virtual: true });
  try {
    assert.equal(h.mapper.getContentYForLine(12.5), 712.5);
    assert.equal(h.mapper.getLineForContentY(300), 23);
    assert.deepEqual(h.mapper.getMetrics(), [{ anchor: 'virtual', startLine: 10, endLine: 11, top: 500, bottom: 600 }]);
    assert.equal(h.mapper.getAnchorCount(), 1);
    assert.deepEqual(h.calls.virtualY, [12.5]);
    assert.deepEqual(h.calls.virtualLine, [300]);
    assert.deepEqual(h.calls.query, []);
  } finally { h.mapper.destroy(); }
});

test('R9-05 metric invalidation and structure invalidation have separate cache ownership', () => {
  const h = createHarness();
  try {
    const firstAnchors = h.mapper.getAnchors();
    const firstMetrics = h.mapper.getMetrics();
    h.mapper.invalidateMetrics();
    assert.equal(h.mapper.getAnchors(), firstAnchors);
    assert.notEqual(h.mapper.getMetrics(), firstMetrics);
    h.mapper.invalidateStructure();
    assert.notEqual(h.mapper.getAnchors(), firstAnchors);
  } finally { h.mapper.destroy(); }
});

test('R9-05 replace refresh and findAnchor expose one mapper-owned anchor authority', () => {
  const h = createHarness();
  try {
    const replacement = [anchor(20, 22, 50, 30)];
    h.mapper.replaceAnchors(replacement);
    h.mapper.invalidateMetrics();
    assert.equal(h.mapper.getAnchorCount(), 1);
    assert.equal(h.mapper.findAnchor(21), replacement[0]);
    const refreshed = h.mapper.refreshStructure();
    assert.equal(refreshed.length, 2);
    assert.equal(h.calls.observe.includes(h.body), true);
  } finally { h.mapper.destroy(); }
});

test('R9-05 preview body ResizeObserver debounces metric invalidation and reports geometry without taking source ownership', () => {
  const h = createHarness();
  try {
    const firstMetrics = h.mapper.getMetrics();
    h.mapper.observeBodySize();
    const callback = h.getResizeCallback();
    assert.equal(typeof callback, 'function');
    callback();
    assert.equal(h.timers.size, 1);
    const [{ callback: flush, delay }] = [...h.timers.values()];
    assert.equal(delay, 64);
    flush();
    assert.deepEqual(h.geometry, ['preview']);
    assert.notEqual(h.mapper.getMetrics(), firstMetrics);
  } finally { h.mapper.destroy(); }
});

test('R9-05 destroy is terminal idempotent and releases observer timer and caches', () => {
  const h = createHarness();
  h.mapper.observeBodySize();
  h.getResizeCallback()();
  assert.equal(h.timers.size, 1);
  h.mapper.destroy();
  h.mapper.destroy();
  assert.equal(h.timers.size, 0);
  assert.ok(h.calls.disconnect >= 1);
  assert.throws(() => h.mapper.getMetrics(), /destroyed/);
  assert.throws(() => h.mapper.getContentYForLine(1), /destroyed/);
});
