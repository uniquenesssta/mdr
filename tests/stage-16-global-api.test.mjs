import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkLegacyRuntime } from '../scripts/architecture/checks.mjs';
import { telemetry, connectTelemetryRecorder } from '../src/features/telemetry/index.js';
import { configureHybridLinkPreview, getHybridLinkPreview } from '../src/features/hybrid-editor/runtime/hybrid-link-capabilities.js';
import { observeDocumentSnapshots } from '../src/features/documents/application/document-snapshot-telemetry.js';
import { createLinkPreview } from '../src/features/link-preview/index.js';
import {
  registerHybridWidgetCleanup, disposeHybridWidget, registerHybridDirectEditor,
  commitHybridDirectEditor, destroyHybridDirectEditor, registerHybridCellActivation,
  activateHybridTableCell, unregisterHybridCellActivation, registerHybridDirectActivation,
  disposeHybridDirectActivation
} from '../src/features/hybrid-editor/lifecycle/widget-lifecycle.js';

test('R16-03 current production scan rejects every business global publication', async () => {
  assert.deepEqual(await checkLegacyRuntime(), []);
  assert.deepEqual(JSON.parse(readFileSync('tests/architecture/fixtures/architecture-baseline.json')).businessGlobalWrites, []);
  const manifest = JSON.parse(readFileSync('tests/architecture/fixtures/production-modules.json'));
  const reads = [];
  for (const [path] of manifest.modules) {
    if (!path.endsWith('.js')) continue;
    const source = readFileSync(path, 'utf8');
    if (/\b(?:window|globalThis)(?:\?\.)?\.?(?:markdownEditor\w+|\['markdownEditor)/.test(source)) reads.push(path);
    if (path.includes('/widgets/') || path.includes('/bootstrap/')) assert.doesNotMatch(source, /__markdownEditor\w+\s*(?:=|\?\.\()/, path);
  }
  // Stage 0 byte freeze takes precedence over removing an unreachable optional read.
  assert.deepEqual(reads, ['src/document/document-model.js']);
  const frozen = JSON.parse(readFileSync('docs/rewrite-progress/stage-00/evidence/frozen-model-hashes.json'));
  const row = frozen.find(x => x.path === reads[0]);
  assert.equal(createHash('sha256').update(readFileSync(reads[0])).digest('hex'), row.sha256);
});

test('R16-03 telemetry is cold before connection and disconnects without publishing a slot', () => {
  const before = Object.getOwnPropertyNames(globalThis), calls = [];
  assert.equal(telemetry.record('cold'), undefined);
  const release = connectTelemetryRecorder({ record: (...args) => calls.push(args), diagnostic: () => 7 });
  assert.equal(telemetry.diagnostic('diagnostic'), 7);
  telemetry.record('event', { count: 2 });
  assert.deepEqual(calls, [['event', { count: 2 }]]);
  release(); release(); telemetry.record('late');
  assert.equal(calls.length, 1); assert.deepEqual(Object.getOwnPropertyNames(globalThis), before);
});
test('R16-03 recorder ownership rejects invalid and concurrent owners', () => {
  assert.throws(() => connectTelemetryRecorder({}), TypeError);
  const release = connectTelemetryRecorder({ record() {}, diagnostic() {} });
  try { assert.throws(() => connectTelemetryRecorder({ record() {}, diagnostic() {} }), /already connected/); }
  finally { release(); }
  const next = connectTelemetryRecorder({ record: () => 9, diagnostic() {} });
  release(); assert.equal(telemetry.record('next'), 9); next();
});
test('R16-03 Hybrid navigation is immutable, explicit and revocable', () => {
  assert.throws(() => configureHybridLinkPreview({ open() {} }), TypeError);
  let value;
  const source = { open: input => { value = input; }, openExternal: async () => {} };
  configureHybridLinkPreview(source); source.open = () => { throw Error('replaced'); };
  getHybridLinkPreview().open('https://example.com'); assert.equal(value, 'https://example.com');
  assert.equal(Object.isFrozen(getHybridLinkPreview()), true);
  configureHybridLinkPreview(null); assert.equal(getHybridLinkPreview(), null);
});
test('R16-03 direct editor commits through one owner and terminal destroy prevents late writes', () => {
  const element = {}, calls = [];
  const release = registerHybridDirectEditor(element, { commit: x => { calls.push(x); return 3; }, destroy: () => calls.push('destroy') });
  assert.equal(commitHybridDirectEditor(element, 'save'), 3);
  assert.deepEqual(Object.keys(element), []);
  destroyHybridDirectEditor(element); destroyHybridDirectEditor(element);
  assert.equal(commitHybridDirectEditor(element, 'late'), undefined); release();
  assert.deepEqual(calls, ['save', 'destroy']);
});
test('R16-03 stale direct editor release cannot detach its replacement', () => {
  const element = {}, old = registerHybridDirectEditor(element, { commit() {}, destroy() {} });
  assert.throws(() => registerHybridDirectEditor(element, { commit() {}, destroy() {} }), /already registered/);
  old(); const next = registerHybridDirectEditor(element, { commit: () => 8, destroy() {} });
  old(); assert.equal(commitHybridDirectEditor(element), 8); next();
});
test('R16-03 a throwing direct editor destroy is terminal and retains the original error', () => {
  const element = {}, error = new Error('fixture');
  registerHybridDirectEditor(element, { commit() { throw Error('late'); }, destroy() { throw error; } });
  assert.throws(() => destroyHybridDirectEditor(element), x => x === error);
  assert.equal(commitHybridDirectEditor(element), undefined); destroyHybridDirectEditor(element);
});
test('R16-03 widget cleanup and direct activation dispose once without DOM hooks', () => {
  const element = {}, calls = [];
  assert.throws(() => registerHybridWidgetCleanup(element, null), TypeError);
  assert.throws(() => registerHybridDirectActivation(element, null), TypeError);
  assert.throws(() => registerHybridCellActivation(element, null), TypeError);
  registerHybridWidgetCleanup(element, () => calls.push('widget'));
  registerHybridDirectActivation(element, () => calls.push('activation'));
  disposeHybridDirectActivation(element); disposeHybridDirectActivation(element);
  disposeHybridWidget(element); disposeHybridWidget(element);
  assert.deepEqual(calls, ['activation', 'widget']); assert.deepEqual(Object.keys(element), []);
});
test('R16-03 cell navigation cannot invoke a detached callback', () => {
  const cell = {}, calls = [];
  const release = registerHybridCellActivation(cell, options => calls.push(options));
  assert.equal(activateHybridTableCell(cell, { trigger: 'navigation' }), true);
  unregisterHybridCellActivation(cell); assert.equal(activateHybridTableCell(cell, {}), false); release();
  assert.deepEqual(calls, [{ trigger: 'navigation' }]);
});
test('R16-03 snapshot observation preserves body, identity, version and inherited method on release', () => {
  let time = 10;
  const proto = { createSnapshot(reason) { assert.equal(reason, 'explicit'); return '原文😀'; } };
  const model = Object.assign(Object.create(proto), { documentId: 'id', generation: 2, version: 4 }), events = [];
  const release = observeDocumentSnapshots(model, { now: () => time++, record: (...args) => events.push(args) });
  assert.equal(model.createSnapshot(), '原文😀'); assert.equal(model.version, 4);
  assert.equal(events[0][0], 'document.snapshot'); assert.equal(events[0][1].durationMs, 1);
  assert.equal(events[0][1].details.chars, 4); assert.equal(Object.hasOwn(events[0][1].details, 'body'), false);
  release(); release(); assert.equal(model.createSnapshot, proto.createSnapshot);
});
test('R16-03 snapshot observation propagates model failure and preserves a later owner', () => {
  const failure = new Error('model fixture'), model = { createSnapshot() { throw failure; } }, original = model.createSnapshot;
  const release = observeDocumentSnapshots(model, { now: () => 0, record() { throw Error('must not record success'); } });
  assert.throws(() => model.createSnapshot(), e => e === failure);
  release(); assert.equal(model.createSnapshot, original);
  const next = observeDocumentSnapshots(model, { now: () => 0, record() {} }), replacement = () => 'next';
  model.createSnapshot = replacement; next(); assert.equal(model.createSnapshot, replacement);
});

function linksFixture(options = {}) {
  const listeners = new Map(), notices = [], opened = [], records = [];
  const document = { documentElement: { classList: { remove() {} } },
    addEventListener(name, listener) { if (name === options.failInstall) throw Error('fixture install'); listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); if (name === options.failRemove) throw Error('fixture removal'); }
  };
  const preview = createLinkPreview({ document, window: { Element: class Element {}, cancelAnimationFrame() {} },
    links: { openExternal: url => { opened.push(url); return options.open ? options.open(url) : Promise.resolve(); } },
    notify: message => notices.push(message), record: (...args) => records.push(args) });
  return { preview, listeners, notices, opened, records };
}
test('R16-03 link preview binds and disposes document listeners exactly once', () => {
  const f = linksFixture(); assert.equal(f.listeners.size, 3); assert.equal(f.preview.isOpen(), false);
  assert.equal(f.preview.destroy(), true); assert.equal(f.listeners.size, 0); assert.equal(f.preview.destroy(), false);
  assert.equal(f.preview.open('https://example.com'), false);
});
test('R16-03 unsupported link is rejected with explicit notification', () => {
  const f = linksFixture();
  try { assert.equal(f.preview.open('javascript:alert(1)'), false); assert.equal(f.notices.length, 1); assert.deepEqual(f.opened, []); }
  finally { f.preview.destroy(); }
});
test('R16-03 late external navigation failure cannot notify after destruction', async () => {
  let reject;
  const f = linksFixture({ open: () => new Promise((_, fail) => { reject = fail; }) });
  assert.equal(f.preview.open('mailto:example@example.com'), true); f.preview.destroy(); reject(Error('late failure'));
  await Promise.resolve(); await Promise.resolve(); assert.deepEqual(f.notices, []);
  assert.deepEqual(f.opened, ['mailto:example@example.com']);
  assert.equal(await f.preview.openExternal('https://example.com'), false);
});
test('R16-03 link disposal continues after listener cleanup failure', () => {
  const f = linksFixture({ failRemove: 'click' });
  assert.throws(() => f.preview.destroy(), AggregateError); assert.equal(f.listeners.size, 0);
  assert.equal(f.preview.destroy(), false);
});
test('R16-03 partial link listener installation rolls back before rethrow', () => {
  const listeners = new Set();
  assert.throws(() => createLinkPreview({
    document: { documentElement: { classList: { remove() {} } },
      addEventListener(name) { if (name === 'click') throw Error('install failed'); listeners.add(name); },
      removeEventListener(name) { listeners.delete(name); } }, window: {},
    links: { openExternal() {} }, record() {}, notify() {}
  }), /install failed/);
  assert.equal(listeners.size, 0);
});
