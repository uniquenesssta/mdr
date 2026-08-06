import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createInvokeClient } from '../../../src/platform/index.js';

function sequenceClock(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test('Atomic Task 3.3 passes command fields and argument identity through unchanged', async () => {
  const args = Object.freeze({ documentId: 'doc-1', request: { version: 4 } });
  const expected = Object.freeze({ ok: true });
  const calls = [];
  const records = [];
  const details = Object.freeze({ documentId: 'doc-1' });
  const client = createInvokeClient({
    invoke: async (operation, receivedArgs) => {
      calls.push({ operation, args: receivedArgs });
      return expected;
    },
    now: sequenceClock([10, 17.25]),
    record: (operation, entry) => records.push({ operation, entry })
  });

  const result = await client.invoke('save_document_state', args, details);
  assert.equal(result, expected);
  assert.deepEqual(calls, [{ operation: 'save_document_state', args }]);
  assert.equal(calls[0].args, args);
  assert.deepEqual(records, [{
    operation: 'native.save_document_state',
    entry: {
      category: 'native.roundtrip',
      durationMs: 7.25,
      details
    }
  }]);
  assert.ok(Object.isFrozen(client));
});

test('invoke errors retain their original identity and receive error telemetry', async () => {
  const expectedError = new Error('native rejected');
  const details = { documentId: 'doc-2' };
  const records = [];
  const client = createInvokeClient({
    invoke: () => { throw expectedError; },
    now: sequenceClock([20, 24]),
    record: (operation, entry) => records.push({ operation, entry })
  });

  await assert.rejects(
    client.invoke('load_document_state', { documentId: 'doc-2' }, details),
    error => error === expectedError
  );
  assert.deepEqual(details, { documentId: 'doc-2' });
  assert.deepEqual(records, [{
    operation: 'native.load_document_state',
    entry: {
      category: 'native.roundtrip',
      durationMs: 4,
      status: 'error',
      details: { documentId: 'doc-2', error: 'native rejected' }
    }
  }]);
});

test('telemetry failures never replace native success or failure semantics', async () => {
  const expectedResult = { path: 'ok' };
  const successClient = createInvokeClient({
    invoke: async () => expectedResult,
    now: sequenceClock([1, 2]),
    record: () => { throw new Error('telemetry failed'); }
  });
  assert.equal(await successClient.invoke('initial_file_path', {}), expectedResult);

  const expectedError = new Error('invoke failed');
  const failureClient = createInvokeClient({
    invoke: async () => { throw expectedError; },
    now: sequenceClock([3, 5]),
    record: () => { throw new Error('telemetry failed'); }
  });
  await assert.rejects(failureClient.invoke('fetch_url', { url: 'https://example.com' }), error => error === expectedError);
});

test('record false suppresses recursive telemetry without bypassing invoke', async () => {
  const calls = [];
  const records = [];
  const client = createInvokeClient({
    invoke: async (operation, args) => {
      calls.push({ operation, args });
      return 'logs/performance.jsonl';
    },
    now: () => { throw new Error('clock must not run'); },
    record: (...args) => records.push(args)
  });
  const entries = [{ operation: 'ui.click' }];
  const result = await client.invoke('write_performance_logs', { entries }, {}, { record: false });
  assert.equal(result, 'logs/performance.jsonl');
  assert.deepEqual(calls, [{ operation: 'write_performance_logs', args: { entries } }]);
  assert.deepEqual(records, []);
});

test('invalid invoke client dependencies fail at the client boundary', () => {
  assert.throws(() => createInvokeClient(null), /options must be an object/);
  assert.throws(() => createInvokeClient({ invoke: null }), /requires an invoke function/);
  assert.throws(() => createInvokeClient({ invoke() {}, now: null }), /now must be a function/);
  assert.throws(() => createInvokeClient({ invoke() {}, record: {} }), /record must be a function/);
});

test('the desktop invoke client is the sole production owner of the Tauri core invoke import', async () => {
  const fixture = JSON.parse(await readFile(
    new URL('../../../tests/architecture/fixtures/production-modules.json', import.meta.url),
    'utf8'
  ));
  const owners = [];
  for (const [path] of fixture.modules) {
    const source = await readFile(new URL('../../../' + path, import.meta.url), 'utf8');
    if (source.includes("@tauri-apps/api/core")) owners.push(path);
  }
  assert.deepEqual(owners, ['src/platform/desktop/invoke-client.js']);

  const publicEntry = await readFile(new URL('../../../src/platform/index.js', import.meta.url), 'utf8');
  assert.match(publicEntry, /desktop\/invoke-client\.js/);
});

test('legacy runtime delegates all nineteen native commands without changing command strings', async () => {
  const source = await readFile(new URL('../../../src/runtime/tauri.js', import.meta.url), 'utf8');
  const expectedCommands = [
    'abort_document_snapshot_upload',
    'append_document_snapshot_chunk',
    'begin_document_snapshot_upload',
    'commit_document_snapshot_upload',
    'delete_document_state',
    'fetch_url',
    'initial_file_path',
    'list_text_file_tree',
    'load_document_manifest',
    'load_document_state',
    'open_external_url',
    'read_document_chunk',
    'read_dropped_file',
    'read_local_image',
    'save_document_state',
    'search_document_state',
    'write_local_binary_file',
    'write_local_text_file',
    'write_performance_logs'
  ];
  const delegatedCommands = [...source.matchAll(/invokeClient\.invoke\('([^']+)'/g)]
    .map(match => match[1])
    .sort();
  assert.deepEqual(delegatedCommands, expectedCommands);
  assert.doesNotMatch(source, /@tauri-apps\/api\/core|\binvokeMeasured\b/);
  assert.match(source, /createInvokeClient\(/);
  assert.match(source, /write_performance_logs[\s\S]*record: false/);
});

test('Stage 3 verification runs Atomic Task 3.3 before dialog, architecture and later adapters', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/stage-03-atomic.yml', import.meta.url),
    'utf8'
  );
  const detectionIndex = workflow.indexOf('Verify Atomic Task 3.2 capability detection');
  const invokeIndex = workflow.indexOf('Verify Atomic Task 3.3 invoke client');
  const dialogIndex = workflow.indexOf('Verify Atomic Task 3.4 dialog client');
  const architectureIndex = workflow.indexOf('Run architecture hard gate');
  assert.ok(detectionIndex >= 0 && invokeIndex > detectionIndex && dialogIndex > invokeIndex && architectureIndex > dialogIndex);
  assert.match(workflow, /node --test tests\/unit\/platform\/invoke-client\.test\.mjs/);
  assert.match(workflow, /03-04-architecture-scan\.json/);
  assert.doesNotMatch(workflow, /Atomic Task 3\.[5-9]|Atomic Task 3\.1[0-9]/);
});
