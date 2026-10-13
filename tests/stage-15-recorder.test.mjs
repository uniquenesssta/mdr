import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createTelemetryRecorder } from '../src/features/telemetry/index.js';

function fixture(extra = {}) {
  let epoch = 1000, monotonic = 5;
  const entries = [], aggregates = [];
  const recorder = createTelemetryRecorder({ sessionId: 'recorder-fixture', now: () => epoch,
    monotonicNow: () => monotonic, emit: entry => entries.push(entry),
    aggregate: (operation, options) => aggregates.push({ operation, options }), ...extra });
  return { recorder, entries, aggregates, advance(ms) { epoch += ms; monotonic += ms; } };
}

test('R15-02 owns one pure Recorder implementation and runtime consumes its public capability', () => {
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const source = read('src/features/telemetry/performance-recorder.js');
  assert.doesNotMatch(source, /\b(?:window|document|setTimeout|setInterval|PerformanceObserver|fetch)\s*[.(]|writePerformance|node:fs|@tauri/);
  assert.match(read('src/features/telemetry/index.js'), /export \{ createTelemetryRecorder \}/);
  const runtime = read('src/runtime/performance.js');
  assert.match(runtime, /from '..\/features\/telemetry\/index.js'/);
  assert.match(runtime, /const \{ record, measure, createEntry: makeEntry, normalizeDetails: safeDetails \} = recorder/);
  assert.doesNotMatch(runtime, /function (?:record|measure|makeEntry|safeDetails)\(/);
});

test('R15-02 exact envelope uses separate wall and monotonic clocks with detached details', () => {
  const f = fixture(), details = { nested: { count: 2 } };
  const result = f.recorder.measure('custom.event', () => { f.advance(3); return details; }, { details, category: 'custom', status: 'ignored-by-measure' });
  assert.equal(result, details); details.nested.count = 9;
  assert.deepEqual(JSON.parse(JSON.stringify(f.entries[0])), { timestampMs: 1003, sessionId: 'recorder-fixture', source: 'frontend',
    category: 'custom', operation: 'custom.event', durationMs: 3, status: 'ok', details: { nested: { count: 2 } } });
});

for (const key of ['sessionId', 'now', 'monotonicNow', 'emit', 'aggregate']) {
  test('R15-02 invalid construction dependency ' + key + ' is rejected before recording', () => {
    assert.throws(() => fixture({ [key]: null }), TypeError);
  });
}

test('R15-02 invalid operation types and empty names never reach an output port', () => {
  const f = fixture();
  for (const value of [null, undefined, '', '   ', 42, {}, []]) f.recorder.record(value);
  assert.equal(f.entries.length, 0); assert.equal(f.aggregates.length, 0);
});
for (const options of [null, [], {category: {}}, {status: 12}]) {
  test('R15-02 malformed options ' + JSON.stringify(options) + ' never reach transport', () => {
    const f = fixture(); assert.throws(() => f.recorder.record('custom', options), TypeError);
    assert.equal(f.entries.length, 0);
  });
}

test('R15-02 arbitrary valid categories/statuses remain open instead of using catalogue as a whitelist', () => {
  const f = fixture(); f.recorder.record('future.operation', {category: 'future.category', status: 'future.status'});
  assert.equal(f.entries[0].category, 'future.category'); assert.equal(f.entries[0].status, 'future.status');
});

test('R15-02 aggregation port receives detached validated inputs without a second normal emission', () => {
  const f = fixture(), details = {samples: [1, 2]};
  f.recorder.record('interaction.input.frame', {aggregate: true, durationMs: 7, details}); details.samples.push(3);
  assert.equal(f.entries.length, 0); assert.equal(f.aggregates.length, 1);
  assert.equal(f.aggregates[0].options.category, 'ui.operation');
  assert.deepEqual(JSON.parse(JSON.stringify(f.aggregates[0].options.details)), {samples: [1, 2]});
});

test('R15-02 instances preserve independent session identities and destroy only their own output ports', () => {
  const a = fixture(), b = fixture({sessionId: 'second-session'});
  a.recorder.destroy(); a.recorder.destroy(); a.recorder.record('gone'); b.recorder.record('live');
  assert.equal(a.entries.length, 0); assert.equal(b.entries[0].sessionId, 'second-session');
  assert.equal(a.recorder.createEntry('gone'), null); assert.ok(Object.isFrozen(b.recorder));
});
for (const outcome of ['resolve', 'reject']) {
  test('R15-02 disposal before async ' + outcome + ' preserves caller settlement and suppresses late details/output', async () => {
    const f = fixture(), value = {}, error = new Error('same identity'); let resolve, reject, detailsCalls = 0;
    const pending = new Promise((a, b) => {resolve = a; reject = b;});
    const measured = f.recorder.measure('later', () => pending, {details: () => {detailsCalls++; return {};}});
    f.recorder.destroy();
    if (outcome === 'resolve') { resolve(value); assert.equal(await measured, value); }
    else { reject(error); await assert.rejects(measured, e => e === error); }
    assert.equal(detailsCalls, 0); assert.equal(f.entries.length, 0);
  });
}

test('R15-02 a measurement after destruction still performs the requested callback without telemetry', () => {
  const f = fixture(), value = {}; f.recorder.destroy();
  assert.equal(f.recorder.measure('gone', () => value), value); assert.equal(f.entries.length, 0);
});

test('R15-02 failing lazy details and hostile nested getters cannot replace a callback result', () => {
  const f = fixture(), value = {};
  assert.equal(f.recorder.measure('done', () => value, {details: () => {throw new Error('details');}}), value);
  const details = Object.defineProperty({}, 'field', {enumerable: true, get() {throw new Error('getter');}});
  f.recorder.record('bounded', {details}); assert.equal(f.entries[1].details, '[unserializable]');
});

test('R15-02 non-finite wall time is rejected without emitting a malformed envelope', () => {
  const f = fixture({now: () => Infinity}); assert.throws(() => f.recorder.record('clock'), /timestamp/); assert.equal(f.entries.length, 0);
});

for (const aggregate of [false, true]) {
  test('R15-02 reentrant details disposal stops the ' + (aggregate ? 'aggregate' : 'normal') + ' output port', () => {
    const f = fixture();
    const details = Object.defineProperty({}, 'dispose', {enumerable: true, get() {f.recorder.destroy(); return 1;}});
    f.recorder.record('reentrant', {aggregate, details});
    assert.equal(f.entries.length, 0); assert.equal(f.aggregates.length, 0);
  });
}
