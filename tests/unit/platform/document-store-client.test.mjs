import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDocumentStoreClient } from '../../../src/platform/index.js';

function createInvokeRecorder(results = new Map()) {
  const calls = [];
  const invoke = async (operation, args, details) => {
    calls.push({ operation, args, details });
    if (results.has(operation)) {
      const value = results.get(operation);
      return typeof value === 'function' ? value(operation, args, details) : value;
    }
    return Object.freeze({ operation, args, details });
  };
  return { invoke, calls };
}

test('Atomic Task 3.8 maps all ten Rust document-store commands with exact camelCase fields', async () => {
  const { invoke, calls } = createInvokeRecorder();
  const client = createDocumentStoreClient({ invoke });
  const request = Object.freeze({
    documentId: 'doc-1', title: '文档', baseVersion: 2, nextVersion: 3,
    fullContent: null, transactions: [{ changes: [{ from: 0, to: 0, insert: 'A' }] }],
    updatedAt: 123, forceSnapshot: false
  });
  const searchRequest = Object.freeze({ documentId: 'doc-1', query: 'hello', from: 7, wrap: true });

  await client.save(request);
  await client.beginSnapshotUpload('doc-1', 'upload-1');
  await client.appendSnapshotChunk('doc-1', 'upload-1', 123, 4);
  await client.commitSnapshotUpload(request, 'upload-1');
  await client.abortSnapshotUpload('doc-1', 'upload-1');
  await client.load('doc-1');
  await client.loadManifest('doc-1');
  await client.readChunk('doc-1', 2048, 65536);
  await client.search(searchRequest);
  await client.remove('doc-1');

  assert.deepEqual(calls.map(call => call.operation), [
    'save_document_state',
    'begin_document_snapshot_upload',
    'append_document_snapshot_chunk',
    'commit_document_snapshot_upload',
    'abort_document_snapshot_upload',
    'load_document_state',
    'load_document_manifest',
    'read_document_chunk',
    'search_document_state',
    'delete_document_state'
  ]);
  assert.equal(calls[0].args.request, request);
  assert.deepEqual(calls[1].args, { documentId: 'doc-1', uploadId: 'upload-1' });
  assert.deepEqual(calls[2].args, { documentId: 'doc-1', uploadId: 'upload-1', chunk: '123' });
  assert.deepEqual(calls[2].details, { documentId: 'doc-1', uploadId: 'upload-1', chunkIndex: 4, characters: 3 });
  assert.deepEqual(calls[3].args, { request, uploadId: 'upload-1' });
  assert.deepEqual(calls[7].args, { documentId: 'doc-1', byteOffset: 2048, maxBytes: 65536 });
  assert.equal(calls[8].args.request, searchRequest);
  assert.deepEqual(calls[9].args, { documentId: 'doc-1' });
  assert.ok(Object.isFrozen(client));
});

test('chunk read normalization and telemetry details preserve the legacy facade contract', async () => {
  const { invoke, calls } = createInvokeRecorder();
  const client = createDocumentStoreClient({ invoke });

  await client.readChunk('doc-2', -12, 1);
  await client.readChunk('doc-2', '32', undefined);

  assert.deepEqual(calls[0], {
    operation: 'read_document_chunk',
    args: { documentId: 'doc-2', byteOffset: 0, maxBytes: 16 * 1024 },
    details: { documentId: 'doc-2', byteOffset: -12, maxBytes: 1 }
  });
  assert.deepEqual(calls[1], {
    operation: 'read_document_chunk',
    args: { documentId: 'doc-2', byteOffset: 32, maxBytes: 512 * 1024 },
    details: { documentId: 'doc-2', byteOffset: '32', maxBytes: 512 * 1024 }
  });
});

test('save, commit and search telemetry keep existing version and query fields', async () => {
  const { invoke, calls } = createInvokeRecorder();
  const client = createDocumentStoreClient({ invoke });
  const request = { documentId: 'doc-3', baseVersion: 8, nextVersion: 9, fullContent: '正文', transactions: [] };
  const searchRequest = { documentId: 'doc-3', query: '😀abc', from: '11', wrap: false };

  await client.save(request);
  await client.commitSnapshotUpload(request, 'up-3');
  await client.search(searchRequest);

  assert.deepEqual(calls[0].details, {
    documentId: 'doc-3', baseVersion: 8, nextVersion: 9, transactions: 0, fullSnapshot: true
  });
  assert.deepEqual(calls[1].details, {
    documentId: 'doc-3', uploadId: 'up-3', baseVersion: 8, nextVersion: 9
  });
  assert.deepEqual(calls[2].details, { documentId: 'doc-3', queryLength: 5, from: 11 });
});

test('Rust DTO results and null cancellation-like values pass through without client interpretation', async () => {
  const loaded = Object.freeze({ documentId: 'doc-4', title: 'A', content: '正文', version: 4, updatedAt: 1, recovered: false, recoveryMessage: null });
  const manifest = Object.freeze({ documentId: 'doc-4', contentBytes: 6, textLength: 2, lineCount: 1, nonWhitespaceCount: 2, headings: [] });
  const chunk = Object.freeze({ documentId: 'doc-4', byteOffset: 0, nextByteOffset: 6, totalBytes: 6, content: '正文', done: true });
  const search = Object.freeze({ from: 1, to: 2, wrapped: false, version: 4 });
  const results = new Map([
    ['load_document_state', loaded],
    ['load_document_manifest', manifest],
    ['read_document_chunk', chunk],
    ['search_document_state', search],
    ['delete_document_state', undefined]
  ]);
  const client = createDocumentStoreClient(createInvokeRecorder(results));

  assert.equal(await client.load('doc-4'), loaded);
  assert.equal(await client.loadManifest('doc-4'), manifest);
  assert.equal(await client.readChunk('doc-4', 0), chunk);
  assert.equal(await client.search({ documentId: 'doc-4', query: '文' }), search);
  assert.equal(await client.remove('doc-4'), undefined);
});

test('native document-store errors retain their original identity', async () => {
  const expected = new Error('VERSION_MISMATCH:4:3');
  const client = createDocumentStoreClient({ invoke: async () => { throw expected; } });
  await assert.rejects(client.save({ documentId: 'doc-5' }), error => error === expected);
  await assert.rejects(client.readChunk('doc-5', 0), error => error === expected);
});

test('invalid client options fail at the adapter boundary', () => {
  assert.throws(() => createDocumentStoreClient(null), /options must be an object/);
  assert.throws(() => createDocumentStoreClient(), /requires an invoke function/);
  assert.throws(() => createDocumentStoreClient({ invoke: null }), /requires an invoke function/);
});

test('DocumentStore client contains transport mapping only and leaves session/version policy in storage', async () => {
  const clientSource = await readFile(new URL('../../../src/platform/desktop/document-store-client.js', import.meta.url), 'utf8');
  const storeSource = await readFile(new URL('../../../src/storage/native-document-store.js', import.meta.url), 'utf8');
  assert.doesNotMatch(clientSource, /sessions|loadSequence|VERSION_MISMATCH|forceSnapshot =|queueMicrotask|saveSnapshotInChunks|DOCUMENT_LOAD_CANCELLED/);
  assert.match(storeSource, /this\.sessions = new Map\(\)/);
  assert.match(storeSource, /this\.loadSequence = 0/);
  assert.match(storeSource, /VERSION_MISMATCH/);
  assert.match(storeSource, /saveSnapshotInChunks/);
  assert.match(storeSource, /DOCUMENT_LOAD_CANCELLED/);
});

test('Rust document-store structs and commands remain camelCase authorities', async () => {
  const rustSource = await readFile(new URL('../../../src-tauri/src/document_store.rs', import.meta.url), 'utf8');
  assert.ok((rustSource.match(/#\[serde\(rename_all = "camelCase"\)\]/g) || []).length >= 8);
  for (const command of [
    'save_document_state', 'begin_document_snapshot_upload', 'append_document_snapshot_chunk',
    'commit_document_snapshot_upload', 'abort_document_snapshot_upload', 'load_document_state',
    'load_document_manifest', 'read_document_chunk', 'search_document_state', 'delete_document_state'
  ]) assert.match(rustSource, new RegExp(`pub async fn ${command}`));
  for (const field of ['document_id', 'base_version', 'next_version', 'full_content', 'updated_at', 'force_snapshot']) {
    assert.match(rustSource, new RegExp(`\\b${field}\\b`));
  }
});

test('legacy runtime delegates all ten document-store commands through the public client', async () => {
  const source = await readFile(new URL('../../../src/runtime/tauri.js', import.meta.url), 'utf8');
  assert.match(source, /createDocumentStoreClient\(\{ invoke: invokeClient\.invoke \}\)/);
  for (const delegation of [
    'documentStoreClient.save(request)',
    'documentStoreClient.beginSnapshotUpload(documentId, uploadId)',
    'documentStoreClient.appendSnapshotChunk(documentId, uploadId, chunk, chunkIndex)',
    'documentStoreClient.commitSnapshotUpload(request, uploadId)',
    'documentStoreClient.abortSnapshotUpload(documentId, uploadId)',
    'documentStoreClient.load(documentId)',
    'documentStoreClient.loadManifest(documentId)',
    'documentStoreClient.readChunk(documentId, byteOffset, maxBytes)',
    'documentStoreClient.search(request)',
    'documentStoreClient.remove(documentId)'
  ]) assert.ok(source.includes(delegation), `missing delegation: ${delegation}`);
  assert.equal((source.match(/invokeClient\.invoke\('/g) || []).length, 0);
  for (const command of [
    'save_document_state', 'begin_document_snapshot_upload', 'append_document_snapshot_chunk',
    'commit_document_snapshot_upload', 'abort_document_snapshot_upload', 'load_document_state',
    'load_document_manifest', 'read_document_chunk', 'search_document_state', 'delete_document_state'
  ]) assert.doesNotMatch(source, new RegExp(`invokeClient\\.invoke\\('${command}'`));
});

test('DocumentStore client is exported, registered and verified before the Stage 3 hard gate', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../../tests/architecture/fixtures/production-modules.json', import.meta.url), 'utf8'));
  assert.ok(fixture.modules.some(record => record[0] === 'src/platform/desktop/document-store-client.js'));
  const publicEntry = await readFile(new URL('../../../src/platform/index.js', import.meta.url), 'utf8');
  assert.match(publicEntry, /desktop\/document-store-client\.js/);
  const workflow = await readFile(new URL('../../../.github/workflows/stage-03-atomic.yml', import.meta.url), 'utf8');
  const fileSystemIndex = workflow.indexOf('Verify Atomic Task 3.7 file-system client');
  const documentStoreIndex = workflow.indexOf('Verify Atomic Task 3.8 document-store client');
  const webLinkLogIndex = workflow.indexOf('Verify Atomic Task 3.9 web link log clients');
  const browserIndex = workflow.indexOf('Verify Atomic Task 3.10 browser adapters');
  const architectureIndex = workflow.indexOf('Run architecture hard gate');
  assert.ok(fileSystemIndex >= 0 && documentStoreIndex > fileSystemIndex && webLinkLogIndex > documentStoreIndex && browserIndex > webLinkLogIndex && architectureIndex > browserIndex);
  assert.match(workflow, /node --test tests\/unit\/platform\/document-store-client\.test\.mjs/);
  assert.match(workflow, /03-10-architecture-scan\.json/);
  assert.doesNotMatch(workflow, /Atomic Task 3\.11|Atomic Task 3\.12/);
});
