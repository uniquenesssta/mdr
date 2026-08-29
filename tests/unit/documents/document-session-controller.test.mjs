import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DocumentOperationStaleError,
  createDocumentRecord,
  createDocumentSessionController,
  createDocumentSessionStore,
  updateDocumentRecord,
  createSessionDocumentRepository,
  mountClassicDocumentControllerPort
} from '../../../src/features/documents/index.js';
import { createBrowserDocumentRepository, createLoadController } from '../../../src/features/persistence/index.js';
import { NativeDocumentStore } from '../../../src/storage/native-document-store.js';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const readText = path => readFile(resolve(ROOT, path), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return new Map(values); }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createModel(initial = '') {
  let content = String(initial ?? '');
  return {
    documentId: '',
    title: '',
    generation: 0,
    version: 0,
    dirty: false,
    activate(document, options = {}) {
      if (Array.isArray(options.chunks)) content = options.chunks.join('');
      else if (Object.prototype.hasOwnProperty.call(options, 'content')) content = String(options.content ?? '').replace(/\r\n/g, '\n');
      this.documentId = String(document?.id || '');
      this.title = String(document?.title || '');
      this.generation += 1;
      this.version = 0;
      this.dirty = false;
      return this.getState();
    },
    adoptDocument(document) {
      if (this.documentId) throw new Error('already bound');
      this.documentId = String(document?.id || '');
      this.title = String(document?.title || '');
      this.generation += 1;
      return this.getState();
    },
    updateTitle(title) {
      this.title = String(title || '');
      this.dirty = true;
    },
    createSnapshot() { return content; },
    getTextLength() { return content.length; },
    getDocumentVersion() { return this.version; },
    markPersisted() { this.dirty = false; },
    registerConsumer() {},
    acknowledge() {},
    getState() { return { documentId: this.documentId, title: this.title, generation: this.generation, version: this.version, dirty: this.dirty }; },
    setContent(next) { content = String(next ?? ''); this.version += 1; this.dirty = true; }
  };
}

function createRepository({ loads = new Map(), saveImpl = null } = {}) {
  const content = new Map();
  const persisted = [];
  const removed = [];
  const isolatedLoads = [];
  let cancelledLoads = 0;
  let legacyTitle = '';
  let destroyed = false;
  const assertActive = () => { if (destroyed) throw new Error('repo destroyed'); };
  return {
    content,
    persisted,
    removed,
    isolatedLoads,
    get cancelledLoads() { return cancelledLoads; },
    get legacyTitle() { return legacyTitle; },
    readLegacySession() { assertActive(); return []; },
    resetLegacySession() { assertActive(); content.clear(); },
    rememberContent(id, value) { assertActive(); content.set(String(id), String(value ?? '')); },
    forgetContent(id) { assertActive(); content.delete(String(id)); },
    persistSession(records, activeId) { assertActive(); persisted.push({ ids: records.map(item => item.id), activeId }); return true; },
    async load(record, options = {}) {
      assertActive();
      isolatedLoads.push(Boolean(options.isolated));
      const custom = loads.get(record.id);
      if (custom) return custom(record, options);
      return { content: content.get(record.id) || '', chunks: null, loaded: null, metadataPatch: null };
    },
    async save(model, record, options) {
      assertActive();
      content.set(record.id, model.createSnapshot(options?.snapshotReason));
      if (saveImpl) return saveImpl(model, record, options);
      model.markPersisted();
      return { native: false };
    },
    activate() { assertActive(); },
    cancelPendingLoad() { assertActive(); cancelledLoads += 1; },
    async remove(id) { assertActive(); content.delete(String(id)); removed.push(String(id)); },
    materializeLoadedContent(restored) {
      if (typeof restored?.content === 'string' && restored.content.length) return restored.content;
      if (Array.isArray(restored?.chunks)) return restored.chunks.join('');
      return String(restored?.content || '');
    },
    persistLegacyActiveTitle(title) { assertActive(); legacyTitle = String(title || ''); },
    persistLegacyActiveSnapshot({ title = '' } = {}) { assertActive(); legacyTitle = String(title || ''); },
    clearLegacyActiveSnapshot() { assertActive(); legacyTitle = ''; },
    destroy() { destroyed = true; content.clear(); }
  };
}

function record(id, title = id + '.md') {
  return createDocumentRecord({ id, title, updatedAt: 1 });
}

function createHarness(options = {}) {
  const session = options.session || createDocumentSessionStore();
  const model = options.model || createModel();
  const repository = options.repository || createRepository();
  let clock = 100;
  let controller = null;
  const loadController = createLoadController({
    documents: session,
    model,
    editor: { getTextLength: () => model.getTextLength() },
    repository,
    resolveRecord(record, patch, options) { return updateDocumentRecord(record, patch, options); },
    assertGeneration(operation) {
      if (controller?.isCurrentGeneration(operation)) return true;
      throw new DocumentOperationStaleError(operation, null);
    }
  });
  controller = createDocumentSessionController({
    session,
    model,
    repository,
    loadController,
    now: () => ++clock,
    random: () => 0.25
  });
  return { session, model, repository, controller, loadController };
}

test('Atomic 5.3 coordinates new, open, rename and close through one session/model/persistence path', async () => {
  const { session, model, repository, controller } = createHarness();
  const alpha = await controller.newDocument({ title: 'Alpha', content: 'alpha body' });
  assert.equal(session.activeId, alpha.record.id);
  assert.equal(model.documentId, alpha.record.id);
  assert.equal(model.createSnapshot(), 'alpha body');

  const beta = await controller.newDocument({ title: 'Beta', content: 'beta body', currentTitle: 'Alpha.md' });
  assert.deepEqual(session.records.map(item => item.title), ['Beta.md', 'Alpha.md']);
  assert.equal(session.activeId, beta.record.id);
  assert.equal(repository.content.get(alpha.record.id), 'alpha body');

  const renamed = controller.renameDocument(beta.record.id, 'Beta Renamed');
  assert.equal(renamed.record.title, 'Beta Renamed.md');
  assert.equal(model.title, 'Beta Renamed.md');

  const opened = await controller.openDocument(alpha.record.id, { currentTitle: 'Beta Renamed.md' });
  assert.equal(opened.opened, true);
  assert.equal(session.activeId, alpha.record.id);
  assert.equal(model.documentId, alpha.record.id);
  assert.equal(model.createSnapshot(), 'alpha body');

  const closedAlpha = await controller.closeDocument(alpha.record.id, { persistDirty: false });
  assert.equal(closedAlpha.closed, true);
  assert.equal(session.activeId, beta.record.id);
  assert.equal(model.documentId, beta.record.id);
  assert.equal(model.createSnapshot(), 'beta body');
  assert.deepEqual(repository.removed, [alpha.record.id]);

  const closedBeta = await controller.closeDocument(beta.record.id, { persistDirty: false });
  assert.equal(closedBeta.closed, true);
  assert.equal(session.activeId, null);
  assert.equal(model.documentId, '');
  assert.equal(model.createSnapshot(), '');
  assert.equal(session.records.length, 0);
  assert.ok(session.records.every(item => !('content' in item)));
});

test('Atomic 5.3 operation generation prevents a slower open from overwriting a newer document', async () => {
  const aLoad = deferred();
  const bLoad = deferred();
  const repository = createRepository({
    loads: new Map([
      ['a', () => aLoad.promise],
      ['b', () => bLoad.promise]
    ])
  });
  const session = createDocumentSessionStore({ initialRecords: [record('a'), record('b')] });
  const { model, controller } = createHarness({ session, repository });

  const first = controller.openDocument('a');
  await tick();
  const second = controller.openDocument('b');
  await tick();
  bLoad.resolve({ content: 'body b', chunks: null, loaded: null, metadataPatch: null });
  const secondResult = await second;
  assert.equal(secondResult.record.id, 'b');
  assert.equal(session.activeId, 'b');
  assert.equal(model.documentId, 'b');
  assert.equal(model.createSnapshot(), 'body b');

  aLoad.resolve({ content: 'body a', chunks: null, loaded: null, metadataPatch: null });
  await assert.rejects(first, error => error instanceof DocumentOperationStaleError && error.code === 'DOCUMENT_OPERATION_STALE');
  assert.equal(session.activeId, 'b');
  assert.equal(model.documentId, 'b');
  assert.equal(model.createSnapshot(), 'body b');
});

test('Atomic 5.3 begins external-open generation before async file I/O so stale file reads cannot commit', async () => {
  const loader = deferred();
  const { session, model, controller } = createHarness();
  const importing = controller.openExternalDocument({
    title: 'slow.md',
    loadContent: () => loader.promise,
    expectedTextLength: 4
  });
  await tick();
  const created = await controller.newDocument({ title: 'Newer', content: 'new' });
  loader.resolve('slow');
  await assert.rejects(importing, /DOCUMENT_OPERATION_STALE/);
  assert.equal(session.activeId, created.record.id);
  assert.equal(model.documentId, created.record.id);
  assert.equal(model.createSnapshot(), 'new');
  assert.equal(session.records.some(item => item.title === 'slow.md'), false);
});

test('Atomic 5.3 rolls back runtime activation when import validation fails before Session Store commit', async () => {
  const { session, model, controller } = createHarness();
  const original = await controller.newDocument({ title: 'Original', content: 'stable body' });
  await assert.rejects(
    controller.openExternalDocument({
      title: 'Broken.md',
      currentTitle: 'Original.md',
      loadContent: async () => 'abc',
      expectedTextLength: 99
    }),
    /长度校验失败/
  );
  assert.equal(session.activeId, original.record.id);
  assert.equal(session.records.length, 1);
  assert.equal(model.documentId, original.record.id);
  assert.equal(model.createSnapshot(), 'stable body');
});

test('Atomic 5.3 stale close cannot remove or activate documents after a newer lifecycle operation wins', async () => {
  const bLoad = deferred();
  const repository = createRepository({ loads: new Map([['b', () => bLoad.promise]]) });
  const session = createDocumentSessionStore({ initialRecords: [record('a'), record('b')], activeId: 'a' });
  repository.content.set('a', 'body a');
  repository.content.set('b', 'body b');
  const model = createModel();
  model.activate(session.getRecord('a'), { content: 'body a' });
  const { controller } = createHarness({ session, model, repository });

  const closing = controller.closeDocument('a', { persistDirty: false });
  await tick();
  const newer = await controller.newDocument({ title: 'Newest', content: 'newest', currentTitle: 'a.md' });
  bLoad.resolve({ content: 'body b', chunks: null, loaded: null, metadataPatch: null });
  await assert.rejects(closing, /DOCUMENT_OPERATION_STALE/);
  assert.equal(session.activeId, newer.record.id);
  assert.equal(model.documentId, newer.record.id);
  assert.equal(model.createSnapshot(), 'newest');
  assert.equal(session.getRecord('a')?.id, 'a');
  assert.deepEqual(repository.removed, []);
});

test('Atomic 5.3 stale native save completion cannot write native metadata into a newer generation', async () => {
  const saveDeferred = deferred();
  let deferNextSave = true;
  const repository = createRepository({
    saveImpl(model) {
      if (deferNextSave) {
        deferNextSave = false;
        return saveDeferred.promise;
      }
      model.markPersisted();
      return { native: false };
    }
  });
  const { session, model, controller } = createHarness({ repository });
  const created = await controller.newDocument({ title: 'Save Race', content: 'body' });
  model.setContent('changed');
  deferNextSave = true;
  const saving = controller.saveActive({ title: 'Save Race.md' });
  await tick();
  controller.renameDocument(created.record.id, 'Renamed');
  saveDeferred.resolve({ native: true, version: 7, nativeVersion: 7 });
  await assert.rejects(saving, /DOCUMENT_OPERATION_STALE/);
  const current = session.getRecord(created.record.id);
  assert.equal(current.title, 'Renamed.md');
  assert.equal(current.nativeBacked, undefined);
  assert.equal(current.nativeVersion, undefined);
});

test('Atomic 5.3 read-only inactive content uses an isolated repository load and remains generation-guarded', async () => {
  const session = createDocumentSessionStore({ initialRecords: [record('a'), record('b')], activeId: 'a' });
  const repository = createRepository();
  repository.content.set('a', 'A');
  repository.content.set('b', 'B');
  const model = createModel();
  model.activate(session.getRecord('a'), { content: 'A' });
  const { controller } = createHarness({ session, model, repository });
  const result = await controller.readDocumentContent('b');
  assert.equal(result.content, 'B');
  assert.equal(repository.isolatedLoads.at(-1), true);
  assert.equal(session.activeId, 'a');
  assert.equal(model.documentId, 'a');
});

test('Atomic 5.3 session repository owns only compatibility body persistence and isolated native reads', async () => {
  const storage = createMemoryStorage();
  const nativeLoadOptions = [];
  const nativeStore = {
    available: true,
    async load(documentId, options) {
      nativeLoadOptions.push({ documentId, options });
      return {
        title: 'Native.md',
        updatedAt: 5,
        version: 3,
        contentChunks: ['native body']
      };
    },
    shouldUse() { return false; },
    activateDocument() {},
    cancelLoad() {},
    async delete() {}
  };
  const browserRepository = createBrowserDocumentRepository({ storage });
  const repository = createSessionDocumentRepository({ browserRepository, nativeStore, scheduleCleanup: task => task() });
  const metadata = record('browser', 'Browser.md');
  repository.rememberContent(metadata.id, 'browser body');
  repository.persistSession([metadata], metadata.id);
  const serialized = JSON.parse(storage.getItem('md_editor_documents'));
  assert.equal(serialized[0].content, 'browser body');
  assert.equal('content' in metadata, false);

  const nativeRecord = Object.freeze({ ...record('native', 'Native.md'), nativeBacked: true, nativeVersion: 2 });
  const restored = await repository.load(nativeRecord, { isolated: true });
  assert.equal(restored.chunks.join(''), 'native body');
  assert.equal(nativeLoadOptions[0].options.cancelPrevious, false);
  assert.deepEqual(restored.metadataPatch, {
    title: 'Native.md',
    updatedAt: 5,
    nativeBacked: true,
    nativeVersion: 3
  });
  repository.destroy();
  browserRepository.destroy();
  assert.throws(() => repository.persistSession([], null), /destroyed/);
});

test('Atomic 5.3 NativeDocumentStore isolated reads neither cancel nor are cancelled by lifecycle loads', async () => {
  const pending = new Map();
  const backend = {
    async save() { return { version: 1 }; },
    load(documentId) {
      const request = deferred();
      pending.set(documentId, request);
      return request.promise;
    }
  };
  const store = new NativeDocumentStore({ documentStore: backend, available: true });

  const lifecycleLoad = store.load('lifecycle');
  await tick();
  const isolatedLoad = store.load('isolated', { cancelPrevious: false });
  await tick();
  pending.get('isolated').resolve({ title: 'Isolated.md', version: 1, content: 'isolated' });
  pending.get('lifecycle').resolve({ title: 'Lifecycle.md', version: 1, content: 'lifecycle' });
  assert.equal((await isolatedLoad).content, 'isolated');
  assert.equal((await lifecycleLoad).content, 'lifecycle');

  const staleLoad = store.load('stale');
  await tick();
  const winningLoad = store.load('winner');
  await tick();
  pending.get('stale').resolve({ title: 'Stale.md', version: 1, content: 'stale' });
  await assert.rejects(staleLoad, /DOCUMENT_LOAD_CANCELLED/);
  pending.get('winner').resolve({ title: 'Winner.md', version: 1, content: 'winner' });
  assert.equal((await winningLoad).content, 'winner');
});

test('Atomic 5.3 classic controller port exposes only controller commands and has a terminal host lifecycle', async () => {
  const { controller } = createHarness();
  const host = {};
  const port = mountClassicDocumentControllerPort(host, controller);
  assert.equal(host.markdownEditorDocumentControllerPort, port);
  const created = await port.newDocument({ title: 'Port', content: 'body' });
  assert.equal(port.activeId, created.record.id);
  assert.throws(() => mountClassicDocumentControllerPort(host, controller), /already mounted/);
  port.destroy();
  port.destroy();
  assert.equal('markdownEditorDocumentControllerPort' in host, false);
  assert.throws(() => port.getActiveRecord(), /destroyed/);
  controller.destroy();
});

test('Atomic 5.3 production integration removes classic lifecycle/body-cache authority and keeps the frozen DocumentModel exact', async () => {
  const [core, exportModule, events, main, nativeStore, segmentedLoader, entry, loadControllerSource, persistenceEntry, sessionControllerSource] = await Promise.all([
    readText('public/app/core.js'),
    readText('public/app/export.js'),
    readText('public/app/events.js'),
    readText('src/main.js'),
    readText('src/storage/native-document-store.js'),
    readText('src/features/persistence/native-document-store/native-segmented-loader.js'),
    readText('src/features/documents/index.js'),
    readText('src/features/persistence/application/load-controller.js'),
    readText('src/features/persistence/index.js'),
    readText('src/features/documents/application/document-session-controller.js')
  ]);
  assert.doesNotMatch(core, /legacyDocumentContentCache/);
  assert.doesNotMatch(core, /function\s+activateDocumentRuntime\b/);
  assert.doesNotMatch(core, /function\s+loadDocumentContent\b/);
  assert.doesNotMatch(core, /function\s+saveDocumentsToStorage\b/);
  assert.match(core, /markdownEditorDocumentControllerPort/);
  assert.match(exportModule, /markdownEditorDocumentControllerPort/);
  assert.match(events, /markdownEditorDocumentControllerPort/);
  assert.match(main, /createSessionDocumentRepository/);
  assert.match(main, /createDocumentSessionController/);
  assert.match(main, /createLoadController/);
  assert.match(main, /mountClassicDocumentControllerPort/);
  assert.match(loadControllerSource, /repository\.load/);
  assert.match(persistenceEntry, /createLoadController/);
  assert.doesNotMatch(sessionControllerSource, /repository\.load|materializeLoadedContent/);
  assert.match(nativeStore, /segmentedLoader\.load\(documentId, options\)/);
  assert.match(segmentedLoader, /cancelPrevious/);
  assert.match(entry, /document-session-controller\.js/);
  assert.match(entry, /session-document-repository\.js/);
  assert.match(entry, /classic-document-controller-port\.js/);
  const classic = core + '\n' + exportModule + '\n' + events;
  assert.doesNotMatch(classic, /coreDocumentSessionPort\.(?:insertRecord|updateRecord|setActive|removeRecord|reset)\s*\(/);
  assert.doesNotMatch(exportModule, /exportDocumentSessionPort\.(?:insertRecord|updateRecord|setActive|removeRecord|reset)\s*\(/);
  const frozenHash = execFileSync('git', ['hash-object', 'src/document/document-model.js'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(frozenHash, 'd767d9025be05a6f6b87d7cd3527782db1c3303a');
});
