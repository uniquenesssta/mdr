import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createNativeSaveQueue } from '../src/features/persistence/index.js';
import { createNativeDocumentStore } from '../src/storage/native-document-store.js';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function outcome({ version = 1, title = 'Draft.md', forceSnapshot = false, value = null } = {}) {
  return Object.freeze({
    completedVersion: version,
    completedTitle: title,
    forceSnapshotApplied: forceSnapshot,
    version,
    snapshotCreated: forceSnapshot,
    journalEntries: 1,
    value: value ?? Object.freeze({ native: true, version })
  });
}

test('Atomic 10.5 NativeSaveQueue owns only queue lifecycle and waiter metadata', async () => {
  const moduleSource = await source('src/features/persistence/native-document-store/native-save-queue.js');
  assert.doesNotMatch(moduleSource, /\bwindow\s*\.|\bdocument\s*\.|localStorage|sessionStorage|setTimeout|setInterval|requestAnimationFrame|Worker\s*\(/);
  assert.doesNotMatch(moduleSource, /from\s+['"]/);
  assert.doesNotMatch(moduleSource, /createSnapshot|getChangesSince|markPersisted|acknowledge|backendVersion|lastEditorVersion/);
  const queue = createNativeSaveQueue('doc-1', { executeBatch: async () => outcome() });
  assert.deepEqual(queue.snapshot(), { documentId: 'doc-1', running: false, pending: 0 });
  for (const forbidden of ['content', 'body', 'snapshot', 'source', 'document', 'transactions', 'title']) {
    assert.equal(Object.hasOwn(queue.snapshot(), forbidden), false, `queue snapshot must not own ${forbidden}`);
  }
  queue.destroy();
});

test('Atomic 10.5 serializes one document and merges same-version waiters covered by the active batch', async () => {
  const first = deferred();
  const batches = [];
  const events = [];
  const queue = createNativeSaveQueue('doc-1', {
    executeBatch(batch) {
      batches.push(batch);
      return first.promise;
    },
    notify: event => events.push(event)
  });
  const one = queue.enqueue({ targetVersion: 2, context: { title: 'Draft.md' } });
  const two = queue.enqueue({ targetVersion: 2, context: { title: 'Draft.md' } });
  assert.equal(batches.length, 1);
  assert.equal(queue.pendingCount, 2);
  first.resolve(outcome({ version: 2, title: 'Draft.md', value: { batch: 1 } }));
  assert.deepEqual(await one, { batch: 1 });
  assert.deepEqual(await two, { batch: 1 });
  assert.equal(batches.length, 1, 'covered same-version waiter must not create a redundant native write');
  assert.equal(queue.idle, true);
  assert.deepEqual(events.filter(event => event.state === 'queued').map(event => event.pending), [1, 2]);
  assert.equal(events.at(-1).state, 'saved');
  assert.equal(events.at(-1).pending, 0);
  queue.destroy();
});

test('Atomic 10.5 a forceSnapshot waiter arriving during a non-force write is retained for the next serialized batch', async () => {
  const gates = [deferred(), deferred()];
  const batches = [];
  const queue = createNativeSaveQueue('doc-1', {
    executeBatch(batch) {
      batches.push(batch);
      return gates[batches.length - 1].promise;
    }
  });
  const normal = queue.enqueue({ targetVersion: 3, context: { title: 'Draft.md' } });
  const forced = queue.enqueue({ targetVersion: 3, forceSnapshot: true, context: { title: 'Draft.md' } });
  assert.equal(batches[0].forceSnapshot, false);
  gates[0].resolve(outcome({ version: 3, title: 'Draft.md', forceSnapshot: false, value: { batch: 1 } }));
  assert.deepEqual(await normal, { batch: 1 });
  await tick();
  assert.equal(batches.length, 2);
  assert.equal(batches[1].forceSnapshot, true);
  let forcedSettled = false;
  forced.finally(() => { forcedSettled = true; });
  await tick();
  assert.equal(forcedSettled, false);
  gates[1].resolve(outcome({ version: 3, title: 'Draft.md', forceSnapshot: true, value: { batch: 2 } }));
  assert.deepEqual(await forced, { batch: 2 });
  queue.destroy();
});

test('Atomic 10.5 coalesces multiple pending forceSnapshot requests into one forced follow-up batch', async () => {
  const gates = [deferred(), deferred()];
  const batches = [];
  const queue = createNativeSaveQueue('doc-1', {
    executeBatch(batch) {
      batches.push(batch);
      return gates[batches.length - 1].promise;
    }
  });
  const first = queue.enqueue({ targetVersion: 4, context: { title: 'Draft.md' } });
  const forcedA = queue.enqueue({ targetVersion: 4, forceSnapshot: true, context: { title: 'Draft.md' } });
  const forcedB = queue.enqueue({ targetVersion: 4, forceSnapshot: true, context: { title: 'Draft.md' } });
  gates[0].resolve(outcome({ version: 4, title: 'Draft.md', value: { batch: 1 } }));
  await first;
  await tick();
  assert.equal(batches.length, 2);
  assert.equal(batches[1].forceSnapshot, true);
  assert.equal(batches[1].pending, 2);
  gates[1].resolve(outcome({ version: 4, title: 'Draft.md', forceSnapshot: true, value: { batch: 2 } }));
  assert.deepEqual(await Promise.all([forcedA, forcedB]), [{ batch: 2 }, { batch: 2 }]);
  assert.equal(batches.length, 2);
  queue.destroy();
});

test('Atomic 10.5 keeps a newer title request pending until a batch persists that request context', async () => {
  const gates = [deferred(), deferred()];
  const batches = [];
  const queue = createNativeSaveQueue('doc-1', {
    executeBatch(batch) {
      batches.push(batch);
      return gates[batches.length - 1].promise;
    }
  });
  const oldTitle = queue.enqueue({ targetVersion: 5, context: { title: 'Draft.md' } });
  const newTitle = queue.enqueue({ targetVersion: 5, context: { title: 'Renamed.md' } });
  gates[0].resolve(outcome({ version: 5, title: 'Draft.md', value: { title: 'Draft.md' } }));
  assert.deepEqual(await oldTitle, { title: 'Draft.md' });
  await tick();
  assert.equal(batches.length, 2);
  assert.equal(batches[1].context.title, 'Renamed.md');
  gates[1].resolve(outcome({ version: 5, title: 'Renamed.md', value: { title: 'Renamed.md' } }));
  assert.deepEqual(await newTitle, { title: 'Renamed.md' });
  queue.destroy();
});

test('Atomic 10.5 preserves a higher-version waiter for the next batch and never overlaps executors', async () => {
  const gates = [deferred(), deferred()];
  let active = 0;
  let maximumActive = 0;
  const batches = [];
  const queue = createNativeSaveQueue('doc-1', {
    async executeBatch(batch) {
      batches.push(batch);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        return await gates[batches.length - 1].promise;
      } finally {
        active -= 1;
      }
    }
  });
  const v2 = queue.enqueue({ targetVersion: 2, context: { title: 'Draft.md' } });
  const v3 = queue.enqueue({ targetVersion: 3, context: { title: 'Draft.md' } });
  gates[0].resolve(outcome({ version: 2, title: 'Draft.md', value: { version: 2 } }));
  assert.deepEqual(await v2, { version: 2 });
  await tick();
  assert.equal(batches.length, 2);
  assert.equal(maximumActive, 1);
  gates[1].resolve(outcome({ version: 3, title: 'Draft.md', value: { version: 3 } }));
  assert.deepEqual(await v3, { version: 3 });
  assert.equal(maximumActive, 1);
  queue.destroy();
});

test('Atomic 10.5 one batch failure notifies and rejects every waiter, including requests queued during the write', async () => {
  const gate = deferred();
  const events = [];
  const queue = createNativeSaveQueue('doc-1', {
    executeBatch: () => gate.promise,
    notify: event => events.push(event)
  });
  const first = queue.enqueue({ targetVersion: 6, context: { title: 'Draft.md' } });
  const second = queue.enqueue({ targetVersion: 7, forceSnapshot: true, context: { title: 'Draft.md' } });
  const failure = new Error('disk full');
  gate.reject(failure);
  await assert.rejects(first, error => error === failure);
  await assert.rejects(second, error => error === failure);
  assert.equal(queue.pendingCount, 0);
  assert.equal(queue.idle, true);
  assert.equal(events.filter(event => event.state === 'error').length, 1);
  assert.equal(events.at(-1).message, 'disk full');
  queue.destroy();
});

test('Atomic 10.5 destroy is terminal, rejects pending waiters and suppresses late in-flight publication', async () => {
  const gate = deferred();
  const events = [];
  const queue = createNativeSaveQueue('doc-1', {
    executeBatch: () => gate.promise,
    notify: event => events.push(event)
  });
  const pending = queue.enqueue({ targetVersion: 8, context: { title: 'Draft.md' } });
  queue.destroy();
  queue.destroy();
  await assert.rejects(pending, error => error?.code === 'NATIVE_SAVE_QUEUE_DESTROYED');
  const eventCount = events.length;
  gate.resolve(outcome({ version: 8, title: 'Draft.md' }));
  await tick();
  assert.equal(events.length, eventCount, 'late completion after destroy must not publish saved/error');
  assert.equal(queue.destroyed, true);
  assert.throws(() => queue.snapshot(), /NATIVE_SAVE_QUEUE_DESTROYED/);
  await assert.rejects(queue.enqueue({ targetVersion: 9 }), /NATIVE_SAVE_QUEUE_DESTROYED/);
});

test('Atomic 10.5 NativeDocumentStore delegates queue state while preserving native skip/title semantics and later uploader scope', async () => {
  const requests = [];
  const sourceModel = {
    documentId: 'doc-1',
    getTextLength: () => 120000,
    getDocumentVersion: () => 2,
    getChangesSince: () => [],
    registerConsumer() {},
    markPersisted() {},
    acknowledge() {}
  };
  const platformStore = {
    async save(request) {
      requests.push(request);
      return { version: request.nextVersion, snapshotCreated: false, journalEntries: 1 };
    },
    async remove() {}
  };
  const store = createNativeDocumentStore({ documentStore: platformStore, available: true });
  const record = { id: 'doc-1', title: 'Draft.md', nativeBacked: true, nativeVersion: 4, updatedAt: 10 };
  store.activateDocument(sourceModel, record);
  const skipped = await store.save(sourceModel, record);
  assert.equal(skipped.skipped, true);
  assert.equal(requests.length, 0);
  record.title = 'Renamed.md';
  const saved = await store.save(sourceModel, record);
  assert.equal(saved.native, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].title, 'Renamed.md');
  assert.equal(requests[0].baseVersion, 4);
  assert.equal(requests[0].nextVersion, 5);

  const [entry, queueSource, nativeStoreSource, fixtureText, handoff] = await Promise.all([
    source('src/features/persistence/index.js'),
    source('src/features/persistence/native-document-store/native-save-queue.js'),
    source('src/storage/native-document-store.js'),
    source('tests/architecture/fixtures/production-modules.json'),
    source('tests/stage-01-handoff.test.mjs')
  ]);
  assert.match(entry, /createNativeSaveQueue/);
  assert.match(nativeStoreSource, /createNativeSaveQueue/);
  assert.match(nativeStoreSource, /getSaveQueue\(documentId\)/);
  assert.doesNotMatch(nativeStoreSource, /function\s+createSaveRuntime\s*\(|saveRuntimes|runtime\.waiters|runtime\.running|runtime\.forceSnapshot/);
  assert.doesNotMatch(nativeStoreSource, /saveSnapshotInChunks\(|getSafeSnapshotChunkEnd\(/);
  assert.doesNotMatch(queueSource, /beginSnapshotUpload|appendSnapshotChunk|commitSnapshotUpload|abortSnapshotUpload/);
  assert.match(handoff, /moduleFixture\.modules\.length,\s*\d+/);
  const fixture = JSON.parse(fixtureText);
  assert.ok(fixture.modules.length >= 390);
  assert.ok(fixture.modules.some(record => record[0] === 'src/features/persistence/native-document-store/native-save-queue.js'));
  await store.delete('doc-1');
  assert.equal(store.saveQueues.has('doc-1'), false);
});
