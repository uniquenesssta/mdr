import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createNativeSaveSession } from '../src/features/persistence/index.js';
import { createNativeDocumentStore } from '../src/storage/native-document-store.js';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('Atomic 10.4 NativeSaveSession owns only native metadata and one source reference', async () => {
  const moduleSource = await source('src/features/persistence/native-document-store/native-save-session.js');
  assert.doesNotMatch(moduleSource, /\bwindow\s*\.|\bdocument\s*\.|localStorage|sessionStorage|setTimeout|setInterval|requestAnimationFrame|Worker\s*\(/);
  assert.doesNotMatch(moduleSource, /from\s+['"]/);
  const session = createNativeSaveSession('doc-1');
  assert.deepEqual(session.snapshot(), { documentId: 'doc-1', backendVersion: 0, lastEditorVersion: 0, title: '', initialized: false });
  for (const forbidden of ['content', 'body', 'snapshotContent', 'transactions', 'document', 'waiters', 'running', 'forceSnapshot']) {
    assert.equal(Object.hasOwn(session.snapshot(), forbidden), false, `NativeSaveSession must not own ${forbidden}`);
  }
  session.destroy();
});

test('Atomic 10.4 activation preserves consumer registration and native/non-native initialization semantics', () => {
  const registrations = [];
  const sourceRef = { registerConsumer: (...args) => registrations.push(args) };
  const session = createNativeSaveSession('doc-1');
  session.activate({ source: sourceRef, editorVersion: 7, title: 'Draft.md', nativeBacked: true, nativeVersion: 4 });
  assert.equal(session.source, sourceRef);
  assert.deepEqual(registrations, [['storage', 7]]);
  assert.deepEqual(session.snapshot(), { documentId: 'doc-1', backendVersion: 4, lastEditorVersion: 7, title: 'Draft.md', initialized: true });
  session.activate({ source: sourceRef, editorVersion: 8, title: 'Draft.md', nativeBacked: false, nativeVersion: 99 });
  assert.deepEqual(session.snapshot(), { documentId: 'doc-1', backendVersion: 0, lastEditorVersion: 8, title: 'Draft.md', initialized: false });
  session.activate({ source: sourceRef, editorVersion: 9, title: 'Loaded.md', loaded: true, loadedVersion: 0, nativeBacked: true, nativeVersion: 5 });
  assert.deepEqual(session.snapshot(), { documentId: 'doc-1', backendVersion: 0, lastEditorVersion: 9, title: 'Loaded.md', initialized: true });
  session.destroy();
});

test('Atomic 10.4 loaded metadata updates only backend initialization state', () => {
  const sourceRef = {};
  const session = createNativeSaveSession('doc-1');
  session.activate({ source: sourceRef, editorVersion: 12, title: 'Keep.md', nativeBacked: false });
  session.recordLoaded(6);
  assert.equal(session.source, sourceRef);
  assert.deepEqual(session.snapshot(), { documentId: 'doc-1', backendVersion: 6, lastEditorVersion: 12, title: 'Keep.md', initialized: true });
  session.destroy();
});

test('Atomic 10.4 commit updates metadata before preserved model persistence acknowledgements', () => {
  const observations = [];
  const session = createNativeSaveSession('doc-1');
  const sourceRef = {
    markPersisted(editorVersion, backendVersion) { observations.push(['markPersisted', editorVersion, backendVersion, session.snapshot()]); },
    acknowledge(consumer, editorVersion) { observations.push(['acknowledge', consumer, editorVersion, session.snapshot()]); }
  };
  session.attachSource(sourceRef);
  session.commit({ editorVersion: 14, backendVersion: 9, title: 'Saved.md' });
  assert.deepEqual(session.snapshot(), { documentId: 'doc-1', backendVersion: 9, lastEditorVersion: 14, title: 'Saved.md', initialized: true });
  assert.deepEqual(observations[0].slice(0, 3), ['markPersisted', 14, 9]);
  assert.deepEqual(observations[0][3], session.snapshot());
  assert.deepEqual(observations[1].slice(0, 3), ['acknowledge', 'storage', 14]);
  assert.deepEqual(observations[1][3], session.snapshot());
  session.destroy();
});

test('Atomic 10.4 VERSION_MISMATCH invalidation does not erase the last committed session baseline', () => {
  const sourceRef = {};
  const session = createNativeSaveSession('doc-1');
  session.activate({ source: sourceRef, editorVersion: 3, title: 'Draft.md', nativeBacked: true, nativeVersion: 4 });
  session.invalidateInitialization();
  assert.equal(session.source, sourceRef);
  assert.deepEqual(session.snapshot(), { documentId: 'doc-1', backendVersion: 4, lastEditorVersion: 3, title: 'Draft.md', initialized: false });
  session.destroy();
});

test('Atomic 10.4 destroy is terminal and rejects stale late session publication', () => {
  const session = createNativeSaveSession('doc-1');
  session.attachSource({});
  session.destroy();
  session.destroy();
  assert.equal(session.destroyed, true);
  assert.throws(() => session.snapshot(), /destroyed/);
  assert.throws(() => session.attachSource({}), /destroyed/);
  assert.throws(() => session.recordLoaded(2), /destroyed/);
  assert.throws(() => session.invalidateInitialization(), /destroyed/);
  assert.throws(() => session.commit({ editorVersion: 1, backendVersion: 1, title: 'Late.md' }), /destroyed/);
});

test('Atomic 10.4 NativeDocumentStore preserves skip and title-only native-save behavior through NativeSaveSession', async () => {
  const requests = [];
  const registrations = [];
  const persisted = [];
  const acknowledgements = [];
  const modelSource = {
    documentId: 'doc-1', getTextLength: () => 120000, getDocumentVersion: () => 2,
    getChangesSince: (version, consumer) => { assert.equal(version, 2); assert.equal(consumer, 'storage'); return []; },
    registerConsumer: (...args) => registrations.push(args),
    markPersisted: (...args) => persisted.push(args),
    acknowledge: (...args) => acknowledgements.push(args)
  };
  const documentStore = { async save(request) { requests.push(request); return { version: request.nextVersion, snapshotCreated: false, journalEntries: 1 }; }, async remove() {} };
  const store = createNativeDocumentStore({ documentStore, available: true });
  const record = { id: 'doc-1', title: 'Draft.md', nativeBacked: true, nativeVersion: 4, updatedAt: 10 };
  store.activateDocument(modelSource, record);
  assert.deepEqual(registrations, [['storage', 2]]);
  const first = await store.save(modelSource, record);
  assert.equal(first.skipped, true);
  assert.equal(first.version, 4);
  assert.equal(requests.length, 0);
  record.title = 'Renamed.md';
  const second = await store.save(modelSource, record);
  assert.equal(second.native, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].baseVersion, 4);
  assert.equal(requests[0].nextVersion, 5);
  assert.equal(requests[0].title, 'Renamed.md');
  assert.deepEqual(persisted, [[2, 5]]);
  assert.deepEqual(acknowledgements, [['storage', 2]]);
  const session = store.getSession('doc-1');
  assert.deepEqual(session.snapshot(), { documentId: 'doc-1', backendVersion: 5, lastEditorVersion: 2, title: 'Renamed.md', initialized: true });
  assert.equal(Object.hasOwn(session.snapshot(), 'content'), false);
  await store.delete('doc-1');
  assert.equal(session.destroyed, true);
});

test('Atomic 10.4 integration keeps NativeSaveSession as the only native session metadata owner across later Stage 10 atomics', async () => {
  const [entry, nativeStoreSource, sessionSource, fixtureText] = await Promise.all([
    source('src/features/persistence/index.js'),
    source('src/storage/native-document-store.js'),
    source('src/features/persistence/native-document-store/native-save-session.js'),
    source('tests/architecture/fixtures/production-modules.json')
  ]);
  assert.match(entry, /createNativeSaveSession/);
  assert.match(nativeStoreSource, /from ['"]\.\.\/features\/persistence\/index\.js['"]/);
  assert.doesNotMatch(nativeStoreSource, /session\.(?:backendVersion|lastEditorVersion|title|initialized|source)\s*=/);
  assert.equal(/waiters|running|forceSnapshot/.test(sessionSource), false);
  const fixture = JSON.parse(fixtureText);
  assert.ok(fixture.modules.length >= 389);
  assert.ok(fixture.modules.some(record => record[0] === 'src/features/persistence/native-document-store/native-save-session.js'));
});
