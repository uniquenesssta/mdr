import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createNativeSegmentedLoader } from '../src/features/persistence/index.js';
import { createNativeDocumentStore } from '../src/storage/native-document-store.js';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('Atomic 10.7 loader owns only segmented traversal, assembly and cancellation state', async () => {
  const moduleSource = await source('src/features/persistence/native-document-store/native-segmented-loader.js');
  assert.doesNotMatch(moduleSource, /from\s+['"]|createNativeSaveSession|createNativeSaveQueue|createNativeSnapshotUploader|\.search\s*\(/);
  assert.doesNotMatch(moduleSource, /\bwindow\s*\.|\bdocument\s*\.|localStorage|sessionStorage|requestAnimationFrame|Worker\s*\(/);
  const loader = createNativeSegmentedLoader({ documentStore: { async load() { return null; } } });
  assert.equal(loader.supported, false);
  assert.equal(typeof loader.load, 'function');
  assert.equal(typeof loader.cancelLoad, 'function');
});

test('Atomic 10.7 preserves manifest byte traversal contentChunks progress and yield semantics', async () => {
  const events = [];
  let yields = 0;
  const reads = [];
  const chunks = new Map([[0, ['abcd', 4]], [4, ['efgh', 8]], [8, ['ij', 10]]]);
  const loader = createNativeSegmentedLoader({
    chunkBytes: 4,
    notify: event => events.push(event),
    yieldControl: async () => { yields += 1; },
    documentStore: {
      async loadManifest() { return { version: 4, contentBytes: 10, title: 'Doc.md' }; },
      async readChunk(documentId, offset, maxBytes) {
        reads.push([documentId, offset, maxBytes]);
        const [content, nextByteOffset] = chunks.get(offset);
        return { content, nextByteOffset };
      }
    }
  });
  const outcome = await loader.load('doc-1');
  assert.deepEqual(outcome.loaded.contentChunks, ['abcd', 'efgh', 'ij']);
  assert.equal(outcome.loaded.segmented, true);
  assert.equal(outcome.totalBytes, 10);
  assert.deepEqual(reads, [['doc-1', 0, 4], ['doc-1', 4, 4], ['doc-1', 8, 4]]);
  assert.equal(yields, 3);
  assert.deepEqual(events.map(event => event.state), ['loading-index', 'manifest', 'loading', 'loading', 'loading']);
  assert.equal(events.at(-1).progress, 1);
});

test('Atomic 10.7 null manifest returns null without false completion', async () => {
  const events = [];
  const loader = createNativeSegmentedLoader({
    notify: event => events.push(event),
    documentStore: {
      async loadManifest() { return null; },
      async readChunk() { throw new Error('must not read'); }
    }
  });
  assert.deepEqual(await loader.load('doc-null'), { loaded: null, segmented: true, totalBytes: 0 });
  assert.deepEqual(events.map(event => event.state), ['loading-index']);
});

test('Atomic 10.7 rejects a non-advancing native chunk and emits one load error', async () => {
  const events = [];
  const loader = createNativeSegmentedLoader({
    notify: event => events.push(event),
    documentStore: {
      async loadManifest() { return { version: 1, contentBytes: 5 }; },
      async readChunk() { return { content: 'x', nextByteOffset: 0 }; }
    }
  });
  await assert.rejects(loader.load('doc-bad'), /后台文档分段读取未前进/);
  assert.deepEqual(events.map(event => event.state), ['loading-index', 'manifest', 'load-error']);
});

test('Atomic 10.7 preserves whole-document compatibility fallback', async () => {
  const events = [];
  const loaded = { version: 3, content: 'legacy body' };
  const loader = createNativeSegmentedLoader({
    notify: event => events.push(event),
    documentStore: { async load() { return loaded; } }
  });
  assert.deepEqual(await loader.load('legacy'), { loaded, segmented: false, totalBytes: 0 });
  assert.deepEqual(events, []);
});

test('Atomic 10.7 cancelLoad invalidates an active segmented token without load-error', async () => {
  const gate = deferred();
  const events = [];
  const loader = createNativeSegmentedLoader({
    notify: event => events.push(event),
    documentStore: {
      async loadManifest() { return gate.promise; },
      async readChunk() { throw new Error('must not read'); }
    }
  });
  const pending = loader.load('old');
  loader.cancelLoad();
  gate.resolve({ version: 1, contentBytes: 0 });
  await assert.rejects(pending, error => error?.message === 'DOCUMENT_LOAD_CANCELLED');
  assert.deepEqual(events.map(event => event.state), ['loading-index']);
});

test('Atomic 10.7 a newer cancellable load supersedes the old token', async () => {
  const oldGate = deferred();
  const loader = createNativeSegmentedLoader({
    documentStore: {
      async loadManifest(id) { return id === 'old' ? oldGate.promise : { version: 9, contentBytes: 0 }; },
      async readChunk() { throw new Error('must not read'); }
    }
  });
  const old = loader.load('old');
  assert.equal((await loader.load('fresh')).loaded.version, 9);
  oldGate.resolve({ version: 1, contentBytes: 0 });
  await assert.rejects(old, error => error?.message === 'DOCUMENT_LOAD_CANCELLED');
});

test('Atomic 10.7 cancelPrevious=false remains isolated from cancellation', async () => {
  const gate = deferred();
  const loader = createNativeSegmentedLoader({
    documentStore: {
      async loadManifest() { return gate.promise; },
      async readChunk() { throw new Error('must not read'); }
    }
  });
  const isolated = loader.load('isolated', { cancelPrevious: false });
  loader.cancelLoad();
  gate.resolve({ version: 6, contentBytes: 0 });
  assert.equal((await isolated).loaded.version, 6);
});

test('Atomic 10.7 compatibility fallback checks cancellation after whole load resolves', async () => {
  const gate = deferred();
  const loader = createNativeSegmentedLoader({ documentStore: { async load() { return gate.promise; } } });
  const pending = loader.load('legacy-old');
  loader.cancelLoad();
  gate.resolve({ version: 2, content: 'stale' });
  await assert.rejects(pending, error => error?.message === 'DOCUMENT_LOAD_CANCELLED');
});

test('Atomic 10.7 NativeDocumentStore publishes Session metadata only for the accepted load', async () => {
  const oldGate = deferred();
  const events = [];
  const platformStore = {
    async save() { return { version: 1 }; },
    async loadManifest(id) { return id === 'old' ? oldGate.promise : { version: 8, contentBytes: 0 }; },
    async readChunk() { throw new Error('must not read'); },
    async remove() {}
  };
  const store = createNativeDocumentStore({ documentStore: platformStore, available: true });
  store.subscribe(event => events.push(event));
  const stale = store.load('old');
  const fresh = await store.load('fresh');
  assert.equal(fresh.version, 8);
  assert.equal(store.sessions.get('fresh').backendVersion, 8);
  oldGate.resolve({ version: 1, contentBytes: 0 });
  await assert.rejects(stale, error => error?.message === 'DOCUMENT_LOAD_CANCELLED');
  assert.equal(store.sessions.has('old'), false);
  assert.deepEqual(events.filter(event => event.state === 'loaded').map(event => event.documentId), ['fresh']);

  const [entry, nativeStoreSource] = await Promise.all([
    source('src/features/persistence/index.js'),
    source('src/storage/native-document-store.js')
  ]);
  assert.match(entry, /createNativeSegmentedLoader/);
  assert.match(nativeStoreSource, /createNativeSegmentedLoader/);
  assert.match(nativeStoreSource, /segmentedLoader\.load\(documentId, options\)/);
  assert.doesNotMatch(nativeStoreSource, /DOCUMENT_CHUNK_BYTES|loadSequence|documentStore\?\.loadManifest|documentStore\.readChunk/);
  assert.doesNotMatch(nativeStoreSource, /createBrowserDocumentRepository/);
});
