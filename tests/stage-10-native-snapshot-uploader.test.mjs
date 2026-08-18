import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createNativeSnapshotUploader } from '../src/features/persistence/index.js';
import { createNativeDocumentStore } from '../src/storage/native-document-store.js';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const CHUNK_CHARS = 256 * 1024;
const UPLOAD_THRESHOLD = 512 * 1024;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createTransport(overrides = {}) {
  return {
    async beginSnapshotUpload() {},
    async appendSnapshotChunk() {},
    async commitSnapshotUpload(request) { return { version: request.nextVersion }; },
    async abortSnapshotUpload() {},
    ...overrides
  };
}

test('Atomic 10.6 NativeSnapshotUploader owns only upload lifecycle and transient chunk transport', async () => {
  const moduleSource = await source('src/features/persistence/native-document-store/native-snapshot-uploader.js');
  assert.doesNotMatch(moduleSource, /\bwindow\s*\.|\bdocument\.(?:getElementById|querySelector|body|addEventListener|removeEventListener|createElement|defaultView)|localStorage|sessionStorage|setTimeout|setInterval|requestAnimationFrame|Worker\s*\(/);
  assert.doesNotMatch(moduleSource, /from\s+['"]/);
  assert.doesNotMatch(moduleSource, /createSnapshot|getChangesSince|markPersisted|acknowledge|createNativeSaveQueue|createNativeSaveSession/);
  const uploader = createNativeSnapshotUploader({ documentStore: createTransport() });
  assert.equal(uploader.supported, true);
  assert.equal(uploader.activeCount, 0);
  assert.equal(uploader.destroyed, false);
  await uploader.destroy();
});

test('Atomic 10.6 chunked support requires abort and preserves the existing 512K character threshold', async () => {
  const incomplete = createTransport();
  delete incomplete.abortSnapshotUpload;
  const unsupported = createNativeSnapshotUploader({ documentStore: incomplete });
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.shouldUpload('x'.repeat(UPLOAD_THRESHOLD)), false);
  await unsupported.destroy();

  const uploader = createNativeSnapshotUploader({ documentStore: createTransport() });
  assert.equal(uploader.shouldUpload('x'.repeat(UPLOAD_THRESHOLD - 1)), false);
  assert.equal(uploader.shouldUpload('x'.repeat(UPLOAD_THRESHOLD)), true);
  await uploader.destroy();
});

test('Atomic 10.6 chunk boundaries never split a UTF-16 surrogate pair', async () => {
  const chunks = [];
  const content = `${'a'.repeat(CHUNK_CHARS - 1)}😀tail`;
  const transport = createTransport({
    async appendSnapshotChunk(documentId, uploadId, chunk) { chunks.push(chunk); }
  });
  const uploader = createNativeSnapshotUploader({
    documentStore: transport,
    createUploadId: () => 'upload-safe-pair'
  });
  await uploader.upload({ request: { documentId: 'doc-1', nextVersion: 1 }, content });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, CHUNK_CHARS - 1);
  assert.equal(chunks[0].charCodeAt(chunks[0].length - 1) >= 0xD800 && chunks[0].charCodeAt(chunks[0].length - 1) <= 0xDBFF, false);
  assert.equal(chunks.join(''), content);
  await uploader.destroy();
});

test('Atomic 10.6 executes begin append commit in order and preserves progress semantics', async () => {
  const calls = [];
  const events = [];
  const content = 'x'.repeat(CHUNK_CHARS + 3);
  let targetVersion = 7;
  let pending = 2;
  const transport = createTransport({
    async beginSnapshotUpload(documentId, uploadId) { calls.push(['begin', documentId, uploadId]); },
    async appendSnapshotChunk(documentId, uploadId, chunk, index) {
      calls.push(['append', index, chunk.length]);
      if (index === 0) {
        targetVersion = 8;
        pending = 1;
      }
    },
    async commitSnapshotUpload(request, uploadId) {
      calls.push(['commit', request.documentId, uploadId]);
      return { version: request.nextVersion, snapshotCreated: true };
    }
  });
  const uploader = createNativeSnapshotUploader({
    documentStore: transport,
    notify: event => events.push(event),
    createUploadId: () => 'upload-order',
    yieldControl: async () => {}
  });
  const response = await uploader.upload({
    request: { documentId: 'doc-1', nextVersion: 3 },
    content,
    getTargetVersion: () => targetVersion,
    backendVersion: 2,
    getPendingCount: () => pending
  });
  assert.deepEqual(response, { version: 3, snapshotCreated: true });
  assert.deepEqual(calls.map(call => call[0]), ['begin', 'append', 'append', 'commit']);
  assert.deepEqual(calls.filter(call => call[0] === 'append').map(call => call[1]), [0, 1]);
  assert.equal(events.length, 2);
  assert.equal(events[0].uploadedChars, CHUNK_CHARS);
  assert.equal(events[0].targetVersion, 8);
  assert.equal(events[0].backendVersion, 2);
  assert.equal(events[0].pending, 1);
  assert.equal(events[1].progress, 1);
  assert.equal(events[1].totalChars, content.length);
  await uploader.destroy();
});

test('Atomic 10.6 append failure aborts the upload and preserves the original failure', async () => {
  const calls = [];
  const failure = new Error('append failed');
  const uploader = createNativeSnapshotUploader({
    documentStore: createTransport({
      async beginSnapshotUpload() { calls.push('begin'); },
      async appendSnapshotChunk() { calls.push('append'); throw failure; },
      async abortSnapshotUpload() { calls.push('abort'); }
    }),
    createUploadId: () => 'upload-append-fail'
  });
  await assert.rejects(
    uploader.upload({ request: { documentId: 'doc-1', nextVersion: 1 }, content: 'body' }),
    error => error === failure
  );
  assert.deepEqual(calls, ['begin', 'append', 'abort']);
  assert.equal(uploader.activeCount, 0);
  await uploader.destroy();
});

test('Atomic 10.6 commit failure aborts after all appended chunks', async () => {
  const calls = [];
  const failure = new Error('commit failed');
  const uploader = createNativeSnapshotUploader({
    documentStore: createTransport({
      async beginSnapshotUpload() { calls.push('begin'); },
      async appendSnapshotChunk() { calls.push('append'); },
      async commitSnapshotUpload() { calls.push('commit'); throw failure; },
      async abortSnapshotUpload() { calls.push('abort'); }
    }),
    createUploadId: () => 'upload-commit-fail'
  });
  await assert.rejects(
    uploader.upload({ request: { documentId: 'doc-1', nextVersion: 1 }, content: 'body' }),
    error => error === failure
  );
  assert.deepEqual(calls, ['begin', 'append', 'commit', 'abort']);
  await uploader.destroy();
});

test('Atomic 10.6 explicit cancellation aborts and suppresses late progress or commit', async () => {
  const appendGate = deferred();
  const calls = [];
  const events = [];
  const uploader = createNativeSnapshotUploader({
    documentStore: createTransport({
      async beginSnapshotUpload() { calls.push('begin'); },
      async appendSnapshotChunk() { calls.push('append'); return appendGate.promise; },
      async commitSnapshotUpload() { calls.push('commit'); return { version: 1 }; },
      async abortSnapshotUpload() { calls.push('abort'); }
    }),
    notify: event => events.push(event),
    createUploadId: () => 'upload-cancel'
  });
  const upload = uploader.upload({ request: { documentId: 'doc-1', nextVersion: 1 }, content: 'body' });
  await tick();
  assert.equal(await uploader.cancel('doc-1', 'user-cancelled'), true);
  appendGate.resolve();
  await assert.rejects(upload, error => error?.code === 'NATIVE_SNAPSHOT_UPLOAD_CANCELLED' && error.reason === 'user-cancelled');
  assert.deepEqual(calls, ['begin', 'append', 'abort']);
  assert.equal(events.length, 0);
  assert.equal(uploader.activeCount, 0);
  await uploader.destroy();
});

test('Atomic 10.6 abort failure is surfaced instead of silently swallowing cleanup failure', async () => {
  const original = new Error('append failed');
  const abortFailure = new Error('abort failed');
  const uploader = createNativeSnapshotUploader({
    documentStore: createTransport({
      async appendSnapshotChunk() { throw original; },
      async abortSnapshotUpload() { throw abortFailure; }
    }),
    createUploadId: () => 'upload-abort-fail'
  });
  await assert.rejects(
    uploader.upload({ request: { documentId: 'doc-1', nextVersion: 1 }, content: 'body' }),
    error => {
      assert.equal(error?.code, 'NATIVE_SNAPSHOT_UPLOAD_ABORT_FAILED');
      assert.equal(error?.cause, original);
      assert.deepEqual(error?.errors, [original, abortFailure]);
      return true;
    }
  );
  await uploader.destroy();
});

test('Atomic 10.6 destroy is terminal, aborts active uploads and rejects late completion', async () => {
  const appendGate = deferred();
  const calls = [];
  const uploader = createNativeSnapshotUploader({
    documentStore: createTransport({
      async appendSnapshotChunk() { calls.push('append'); return appendGate.promise; },
      async commitSnapshotUpload() { calls.push('commit'); return { version: 1 }; },
      async abortSnapshotUpload() { calls.push('abort'); }
    }),
    createUploadId: () => 'upload-destroy'
  });
  const upload = uploader.upload({ request: { documentId: 'doc-1', nextVersion: 1 }, content: 'body' });
  await tick();
  await uploader.destroy();
  await uploader.destroy();
  appendGate.resolve();
  await assert.rejects(upload, error => error?.code === 'NATIVE_SNAPSHOT_UPLOADER_DESTROYED');
  assert.deepEqual(calls, ['append', 'abort']);
  assert.equal(uploader.destroyed, true);
  assert.throws(() => uploader.shouldUpload('body'), /NATIVE_SNAPSHOT_UPLOADER_DESTROYED/);
  await assert.rejects(
    uploader.upload({ request: { documentId: 'doc-2' }, content: 'body' }),
    /NATIVE_SNAPSHOT_UPLOADER_DESTROYED/
  );
});

test('Atomic 10.6 NativeDocumentStore delegates large reset snapshots through the public uploader without changing save result semantics', async () => {
  const content = `${'a'.repeat(UPLOAD_THRESHOLD + 5)}😀tail`;
  const chunks = [];
  const calls = [];
  const sourceModel = {
    documentId: 'doc-large',
    getTextLength: () => content.length,
    getDocumentVersion: () => 4,
    getChangesSince: () => null,
    createSnapshot: () => content,
    registerConsumer() {},
    markPersisted() {},
    acknowledge() {}
  };
  const platformStore = {
    async save() { throw new Error('full save must not be used for chunked reset'); },
    async beginSnapshotUpload(documentId, uploadId) { calls.push(['begin', documentId, uploadId]); },
    async appendSnapshotChunk(documentId, uploadId, chunk, index) { chunks.push(chunk); calls.push(['append', index]); },
    async commitSnapshotUpload(request, uploadId) {
      calls.push(['commit', request, uploadId]);
      assert.equal(request.fullContent, null);
      return { documentId: request.documentId, version: request.nextVersion, snapshotCreated: true, journalEntries: 0 };
    },
    async abortSnapshotUpload() { calls.push(['abort']); },
    async remove() {}
  };
  const store = createNativeDocumentStore({ documentStore: platformStore, available: true });
  const record = { id: 'doc-large', title: 'Large.md', nativeBacked: false, nativeVersion: 0, updatedAt: 22 };
  store.activateDocument(sourceModel, record);
  const result = await store.save(sourceModel, record, { forceSnapshot: true });
  assert.equal(result.native, true);
  assert.equal(result.nativeBacked, true);
  assert.equal(result.nativeVersion, 1);
  assert.equal(result.snapshotCreated, true);
  assert.equal(chunks.join(''), content);
  assert.equal(calls[0][0], 'begin');
  assert.equal(calls.at(-1)[0], 'commit');

  const [entry, nativeStoreSource, queueSource, fixtureText, handoff] = await Promise.all([
    source('src/features/persistence/index.js'),
    source('src/storage/native-document-store.js'),
    source('src/features/persistence/native-document-store/native-save-queue.js'),
    source('tests/architecture/fixtures/production-modules.json'),
    source('tests/stage-01-handoff.test.mjs')
  ]);
  assert.match(entry, /createNativeSnapshotUploader/);
  assert.match(nativeStoreSource, /createNativeSnapshotUploader/);
  assert.match(nativeStoreSource, /snapshotUploader\.upload/);
  assert.doesNotMatch(nativeStoreSource, /saveSnapshotInChunks\(|getSafeSnapshotChunkEnd\(|SNAPSHOT_UPLOAD_CHUNK_CHARS/);
  assert.doesNotMatch(queueSource, /beginSnapshotUpload|appendSnapshotChunk|commitSnapshotUpload|abortSnapshotUpload/);
  assert.doesNotMatch(nativeStoreSource, /createNativeSearchAdapter/);
  assert.match(handoff, /moduleFixture\.modules\.length,\s*\d+/);
  const fixture = JSON.parse(fixtureText);
  assert.ok(fixture.modules.length >= 391);
  assert.ok(fixture.modules.some(item => item[0] === 'src/features/persistence/native-document-store/native-snapshot-uploader.js'));
  await store.delete('doc-large');
});

test('Atomic 10.6 deleting a document aborts its in-flight chunk upload before backend removal and no late commit survives', async () => {
  const content = 'x'.repeat(UPLOAD_THRESHOLD + 10);
  const appendGate = deferred();
  const calls = [];
  const sourceModel = {
    documentId: 'doc-delete',
    getTextLength: () => content.length,
    getDocumentVersion: () => 2,
    getChangesSince: () => null,
    createSnapshot: () => content,
    registerConsumer() {},
    markPersisted() {},
    acknowledge() {}
  };
  const platformStore = {
    async save() { throw new Error('unexpected full save'); },
    async beginSnapshotUpload() { calls.push('begin'); },
    async appendSnapshotChunk() { calls.push('append'); return appendGate.promise; },
    async commitSnapshotUpload() { calls.push('commit'); return { version: 1 }; },
    async abortSnapshotUpload() { calls.push('abort'); },
    async remove() { calls.push('remove'); }
  };
  const store = createNativeDocumentStore({ documentStore: platformStore, available: true });
  const record = { id: 'doc-delete', title: 'Delete.md', nativeBacked: false, nativeVersion: 0, updatedAt: 1 };
  store.activateDocument(sourceModel, record);
  const save = store.save(sourceModel, record);
  const rejectedSave = assert.rejects(save, error => error?.code === 'NATIVE_SAVE_QUEUE_DESTROYED');
  await tick();
  await store.delete('doc-delete');
  await rejectedSave;
  assert.deepEqual(calls.slice(0, 4), ['begin', 'append', 'abort', 'remove']);
  appendGate.resolve();
  await tick();
  assert.equal(calls.includes('commit'), false);
  assert.equal(store.saveQueues.has('doc-delete'), false);
  assert.equal(store.sessions.has('doc-delete'), false);
});