import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPerformanceLogClient } from '../../../src/platform/index.js';

function createInvokeRecorder(result) {
  const calls = [];
  const invoke = async (operation, args, details, options) => {
    calls.push({ operation, args, details, options });
    return result;
  };
  return { invoke, calls };
}

test('Atomic Task 3.9 writes the supplied performance batch with recursive telemetry disabled', async () => {
  const entries = Object.freeze([{ operation: 'ui.click' }, { operation: 'runtime.long-task' }]);
  const { invoke, calls } = createInvokeRecorder('logs/performance.jsonl');
  const client = createPerformanceLogClient({ invoke });

  assert.equal(await client.writePerformance(entries), 'logs/performance.jsonl');
  assert.deepEqual(calls, [{
    operation: 'write_performance_logs',
    args: { entries },
    details: {},
    options: { record: false }
  }]);
  assert.equal(calls[0].args.entries, entries);
  assert.ok(Object.isFrozen(client));
});

test('performance-log client leaves queueing aggregation retry and diagnostics in the performance runtime', async () => {
  const clientSource = await readFile(new URL('../../../src/platform/desktop/performance-log-client.js', import.meta.url), 'utf8');
  const runtimeSource = await readFile(new URL('../../../src/runtime/performance.js', import.meta.url), 'utf8');

  assert.doesNotMatch(clientSource, /MAX_QUEUE|aggregates|diagnosticStates|flushInProgress|setTimeout|queue\.unshift/);
  assert.match(runtimeSource, /const queue = \[\]/);
  assert.match(runtimeSource, /const aggregates = new Map\(\)/);
  assert.match(runtimeSource, /const diagnosticStates = new Map\(\)/);
  assert.match(runtimeSource, /queue\.unshift\(\.\.\.batch\)/);
});

test('performance-log client preserves native result and error identity', async () => {
  const result = 'C:\\logs\\performance.jsonl';
  const success = createPerformanceLogClient({ invoke: async () => result });
  assert.equal(await success.writePerformance([]), result);

  const expected = new Error('log write failed');
  const failure = createPerformanceLogClient({ invoke: async () => { throw expected; } });
  await assert.rejects(failure.writePerformance([]), error => error === expected);
});

test('invalid performance-log client dependencies fail at the adapter boundary', () => {
  assert.throws(() => createPerformanceLogClient(null), /options must be an object/);
  assert.throws(() => createPerformanceLogClient(), /requires an invoke function/);
  assert.throws(() => createPerformanceLogClient({ invoke: null }), /requires an invoke function/);
});

test('legacy runtime delegates writePerformanceLogs through the dedicated client', async () => {
  const source = await readFile(new URL('../../../src/runtime/tauri.js', import.meta.url), 'utf8');
  assert.match(source, /createPerformanceLogClient\(\{ invoke: invokeClient\.invoke \}\)/);
  assert.match(source, /return performanceLogClient\.writePerformance\(entries\)/);
  assert.doesNotMatch(source, /invokeClient\.invoke\('write_performance_logs'/);
});

test('Atomic Task 3.9 keeps Web Link and Log as three separate desktop clients with no generic native client', async () => {
  const desktopFiles = await readdir(new URL('../../../src/platform/desktop/', import.meta.url));
  for (const file of ['web-fetch-client.js', 'link-client.js', 'performance-log-client.js']) {
    assert.ok(desktopFiles.includes(file), `missing dedicated client: ${file}`);
  }
  assert.ok(!desktopFiles.some(file => /generic.*native|native.*generic/i.test(file)));
  const runtimeSource = await readFile(new URL('../../../src/runtime/tauri.js', import.meta.url), 'utf8');
  assert.equal((runtimeSource.match(/invokeClient\.invoke\('/g) || []).length, 0);
});
