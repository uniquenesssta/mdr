import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOCUMENT_SESSION_CHANGED_EVENT,
  createDocumentRecord,
  createDocumentSessionStore,
  mountClassicDocumentSessionPort
} from '../../../src/features/documents/index.js';
import { createNativeDocumentStore } from '../../../src/storage/native-document-store.js';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const readText = path => readFile(resolve(ROOT, path), 'utf8');
const record = (id, title = id + '.md', updatedAt = 1) => createDocumentRecord({ id, title, updatedAt });

test('Atomic 5.2 owns one immutable metadata-only records list and activeId snapshot', () => {
  const store = createDocumentSessionStore();
  assert.deepEqual(store.snapshot, { records: [], activeId: null, revision: 0 });
  assert.equal(Object.isFrozen(store.snapshot), true);
  assert.equal(Object.isFrozen(store.records), true);
  const alpha = record('alpha');
  store.insertRecord(alpha, { activate: true, reason: 'test-insert' });
  assert.equal(store.activeId, 'alpha');
  assert.equal(store.getActiveRecord(), store.records[0]);
  assert.equal(Object.isFrozen(store.records[0]), true);
  assert.equal('content' in store.records[0], false);
  assert.throws(() => store.insertRecord({ id: 'body', title: 'Body.md', updatedAt: 1, content: 'forbidden' }), /must not contain document body/);
});

test('Atomic 5.2 rejects duplicate ids and invalid active targets before state mutation', () => {
  const store = createDocumentSessionStore({ initialRecords: [record('alpha')], activeId: 'alpha' });
  const before = store.snapshot;
  assert.throws(() => store.insertRecord(record('alpha')), /already contains/);
  assert.equal(store.snapshot, before);
  assert.throws(() => store.setActive('missing'), /does not exist/);
  assert.equal(store.snapshot, before);
  assert.throws(() => store.replaceRecords([record('a'), record('a')], { activeId: 'a' }), /duplicate/);
  assert.equal(store.snapshot, before);
});

test('Atomic 5.2 updates, activates and removes records through immutable session events with no-op suppression', () => {
  const store = createDocumentSessionStore({ initialRecords: [record('alpha'), record('beta')], activeId: 'alpha' });
  const events = [];
  store.subscribe(event => events.push(event));
  const sameRevision = store.snapshot.revision;
  store.setActive('alpha');
  assert.equal(store.snapshot.revision, sameRevision);
  const updated = store.updateRecord('beta', { title: 'Beta Renamed', updatedAt: 2 }, { reason: 'rename' });
  assert.equal(updated.title, 'Beta Renamed.md');
  store.setActive('beta', { reason: 'activate' });
  const removed = store.removeRecord('alpha', { reason: 'close' });
  assert.equal(removed.id, 'alpha');
  assert.deepEqual(store.records.map(item => item.id), ['beta']);
  assert.equal(store.activeId, 'beta');
  assert.equal(events.length, 3);
  for (const event of events) {
    assert.equal(event.type, DOCUMENT_SESSION_CHANGED_EVENT);
    assert.equal(Object.isFrozen(event), true);
    assert.equal(Object.isFrozen(event.snapshot), true);
    assert.equal(Object.isFrozen(event.snapshot.records), true);
    assert.ok(event.snapshot.revision > event.previous.revision);
  }
});

test('Atomic 5.2 listener failures are reported without rolling back committed session state', () => {
  const errors = [];
  const store = createDocumentSessionStore({ reportListenerError: (error, event) => errors.push({ error, event }) });
  store.subscribe(() => { throw new Error('listener boom'); });
  store.insertRecord(record('alpha'), { activate: true });
  assert.equal(store.activeId, 'alpha');
  assert.equal(store.records.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0].error.message, /listener boom/);
  assert.equal(errors[0].event.snapshot.activeId, 'alpha');
});

test('Atomic 5.2 classic port projects legacy body-bearing inputs into metadata-only Store records and owns only host lifecycle', () => {
  const store = createDocumentSessionStore();
  const host = {};
  const port = mountClassicDocumentSessionPort(host, store);
  port.insertRecord({ id: 'legacy', title: 'Legacy.md', updatedAt: 3, content: 'must stay outside store' }, { activate: true });
  assert.equal(host.markdownEditorDocumentSessionPort, port);
  assert.deepEqual(port.records, [{ id: 'legacy', title: 'Legacy.md', updatedAt: 3 }]);
  assert.equal('content' in port.records[0], false);
  assert.throws(() => mountClassicDocumentSessionPort(host, store), /already mounted/);
  port.destroy();
  port.destroy();
  assert.equal('markdownEditorDocumentSessionPort' in host, false);
  assert.throws(() => port.getActiveRecord(), /destroyed/);
  assert.equal(store.activeId, 'legacy');
});

test('Atomic 5.2 destroy is idempotent, removes listeners and makes Store operations terminal', () => {
  const store = createDocumentSessionStore();
  let events = 0;
  store.subscribe(() => { events += 1; });
  store.destroy();
  store.destroy();
  assert.equal(events, 0);
  for (const action of [
    () => store.snapshot,
    () => store.records,
    () => store.activeId,
    () => store.getRecord('x'),
    () => store.insertRecord(record('x')),
    () => store.setActive(null),
    () => store.reset(),
    () => store.subscribe(() => {})
  ]) assert.throws(action, /destroyed/);
});

test('Atomic 5.2 NativeDocumentStore accepts frozen records and returns native metadata without mutating them', async () => {
  const frozen = record('native');
  const source = {
    documentId: 'native',
    getDocumentVersion: () => 1,
    getTextLength: () => 120000,
    getChangesSince: () => null,
    createSnapshot: () => '# native',
    registerConsumer() {},
    markPersisted() {},
    acknowledge() {}
  };
  const backend = {
    async save(request) { return { version: request.nextVersion, snapshotCreated: true, journalEntries: 0 }; }
  };
  const nativeStore = createNativeDocumentStore({ documentStore: backend, available: true });
  nativeStore.activateDocument(source, frozen, null);
  const result = await nativeStore.save(source, frozen, { forceSnapshot: true });
  assert.deepEqual(frozen, { id: 'native', title: 'native.md', updatedAt: 1 });
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(result.native, true);
  assert.equal(result.nativeBacked, true);
  assert.equal(result.nativeVersion, 1);
  assert.equal(result.version, 1);
});

test('Atomic 5.2 production integration removes classic session-state authority and keeps the frozen DocumentModel exact', async () => {
  const [core, exportModule, preview, bootstrap, nativeStore, entry] = await Promise.all([
    readText('public/app/core.js'),
    readText('public/app/export.js'),
    readText('public/app/preview.js'),
    readText('src/bootstrap/module-entry.js'),
    readText('src/storage/native-document-store.js'),
    readText('src/features/documents/index.js')
  ]);
  assert.doesNotMatch(core, /\blet\s+documents\b/);
  assert.doesNotMatch(core, /\blet\s+currentDocumentId\b/);
  assert.match(core, /markdownEditorDocumentSessionPort/);
  assert.match(exportModule, /markdownEditorDocumentSessionPort/);
  assert.doesNotMatch(exportModule, /\bcurrentDocumentId\b|\bdocuments\b/);
  assert.match(preview, /markdownEditorDocumentSessionPort/);
  assert.doesNotMatch(preview, /\bcurrentDocumentId\b/);
  assert.match(bootstrap, /createDocumentSessionStore\(\)/);
  assert.match(bootstrap, /mountClassicDocumentSessionPort\(portsHost, documentSessionStore\)/);
  assert.doesNotMatch(nativeStore, /Object\.assign\((?:session\.)?document/);
  assert.match(nativeStore, /nativeVersion: session\.backendVersion/);
  assert.match(entry, /document-session-store\.js/);
  assert.match(entry, /classic-document-session-port\.js/);
  const globals = core + '\n' + exportModule + '\n' + preview + '\n' + bootstrap;
  assert.doesNotMatch(globals, /window\.markdownEditorDocumentSession/);
  const frozenHash = execFileSync('git', ['hash-object', 'src/document/document-model.js'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(frozenHash, 'd767d9025be05a6f6b87d7cd3527782db1c3303a');
});
