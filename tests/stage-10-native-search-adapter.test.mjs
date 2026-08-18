import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createNativeSearchAdapter } from '../src/features/persistence/index.js';
import { createNativeDocumentStore } from '../src/storage/native-document-store.js';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('Atomic 10.8 NativeSearchAdapter owns only native search mapping and terminal lifecycle', async () => {
  const moduleSource = await source('src/features/persistence/native-document-store/native-search-adapter.js');
  assert.doesNotMatch(moduleSource, /from\s+['"]|createNativeSaveSession|createNativeSaveQueue|createNativeSnapshotUploader|createNativeSegmentedLoader|createSnapshot|getChangesSince/);
  assert.doesNotMatch(moduleSource, /\bwindow\s*\.|\bdocument\s*\.|localStorage|sessionStorage|setTimeout|setInterval|requestAnimationFrame|Worker\s*\(/);
  const adapter = createNativeSearchAdapter({ available: true, documentStore: { async search() { return null; } } });
  assert.equal(adapter.supported, true);
  assert.equal(adapter.destroyed, false);
  assert.equal(typeof adapter.search, 'function');
  assert.equal(typeof adapter.destroy, 'function');
  adapter.destroy();
  assert.equal(adapter.destroyed, true);
});

test('Atomic 10.8 support and empty-input gating preserve the previous NativeDocumentStore contract', async () => {
  let calls = 0;
  const transport = { async search() { calls += 1; return { from: 0, to: 1, wrapped: false, version: 1 }; } };
  const unavailable = createNativeSearchAdapter({ available: false, documentStore: transport });
  assert.equal(unavailable.supported, false);
  assert.equal(await unavailable.search('doc', 'x'), null);
  const missing = createNativeSearchAdapter({ available: true, documentStore: {} });
  assert.equal(missing.supported, false);
  assert.equal(await missing.search('doc', 'x'), null);
  const available = createNativeSearchAdapter({ available: true, documentStore: transport });
  assert.equal(await available.search('', 'x'), null);
  assert.equal(await available.search('doc', ''), null);
  assert.equal(calls, 0);
});

test('Atomic 10.8 maps document query from and wrap exactly as the legacy native search path', async () => {
  const requests = [];
  const adapter = createNativeSearchAdapter({
    available: true,
    documentStore: { async search(request) { requests.push(request); return null; } }
  });
  await adapter.search('doc-1', 123, -9, false);
  await adapter.search('doc-2', 'needle', '11', undefined);
  assert.deepEqual(requests, [
    { documentId: 'doc-1', query: '123', from: 0, wrap: false },
    { documentId: 'doc-2', query: 'needle', from: 11, wrap: true }
  ]);
});

test('Atomic 10.8 preserves UTF-16 offsets backend version and result identity without JS reinterpretation', async () => {
  const result = Object.freeze({ from: 1, to: 3, wrapped: false, version: 17, marker: 'utf16-emoji' });
  const adapter = createNativeSearchAdapter({
    available: true,
    documentStore: { async search() { return result; } }
  });
  const actual = await adapter.search('doc-utf16', '😀', 0, true);
  assert.equal(actual, result);
  assert.deepEqual(actual, { from: 1, to: 3, wrapped: false, version: 17, marker: 'utf16-emoji' });
});

test('Atomic 10.8 preserves null not-found results from the Platform command', async () => {
  const adapter = createNativeSearchAdapter({
    available: true,
    documentStore: { async search() { return null; } }
  });
  assert.equal(await adapter.search('doc-none', 'absent'), null);
});

test('Atomic 10.8 propagates native search failures with original identity', async () => {
  const failure = new Error('后台搜索任务失败：boom');
  const adapter = createNativeSearchAdapter({
    available: true,
    documentStore: { async search() { throw failure; } }
  });
  await assert.rejects(adapter.search('doc-fail', 'x'), error => error === failure);
});

test('Atomic 10.8 destroy is terminal and a late in-flight result cannot escape the adapter', async () => {
  const gate = deferred();
  const adapter = createNativeSearchAdapter({
    available: true,
    documentStore: { async search() { return gate.promise; } }
  });
  const pending = adapter.search('doc-late', 'x');
  adapter.destroy();
  adapter.destroy();
  gate.resolve({ from: 0, to: 1, wrapped: false, version: 1 });
  await assert.rejects(pending, error => error?.code === 'NATIVE_SEARCH_ADAPTER_DESTROYED');
  await assert.rejects(adapter.search('doc-late', 'x'), error => error?.code === 'NATIVE_SEARCH_ADAPTER_DESTROYED');
});

test('Atomic 10.8 NativeDocumentStore delegates native search while preserving the existing classic Find caller contract', async () => {
  const requests = [];
  const result = Object.freeze({ from: 2, to: 4, wrapped: true, version: 9 });
  const platformStore = {
    async save() { return { version: 1 }; },
    async search(request) { requests.push(request); return result; }
  };
  const store = createNativeDocumentStore({ documentStore: platformStore, available: true });
  assert.equal(await store.search('doc-integration', '😀', 2, true), result);
  assert.deepEqual(requests, [{ documentId: 'doc-integration', query: '😀', from: 2, wrap: true }]);

  const [entry, nativeStoreSource, webClipperSource, fixtureText] = await Promise.all([
    source('src/features/persistence/index.js'),
    source('src/storage/native-document-store.js'),
    source('public/app/web-clipper.js'),
    source('tests/architecture/fixtures/production-modules.json')
  ]);
  assert.match(entry, /createNativeSearchAdapter/);
  assert.match(nativeStoreSource, /createNativeSearchAdapter/);
  assert.match(nativeStoreSource, /searchAdapter\.search\(documentId, query, from, wrap\)/);
  assert.doesNotMatch(nativeStoreSource, /documentStore\?\.search|documentStore\.search\(/);
  assert.match(webClipperSource, /nativeStore\.search\(currentDoc\.id, query, from, wrap\)/);
  assert.doesNotMatch(nativeStoreSource, /createLoadController/);
  const fixture = JSON.parse(fixtureText);
  assert.ok(fixture.modules.length >= 393);
  assert.ok(fixture.modules.some(record => record[0] === 'src/features/persistence/native-document-store/native-search-adapter.js'));
});
