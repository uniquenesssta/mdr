import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DocumentOperationStaleError,
  createDocumentRecord,
  createDocumentSessionController,
  createDocumentSessionStore,
  updateDocumentRecord
} from '../src/features/documents/index.js';
import { createLoadController } from '../src/features/persistence/index.js';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function record(id, title = `${id}.md`) {
  return createDocumentRecord({ id, title, updatedAt: 1 });
}

function createModel(initial = '') {
  let text = String(initial ?? '');
  const activations = [];
  return {
    documentId: '',
    title: '',
    dirty: false,
    activations,
    activate(document, options = {}) {
      text = Array.isArray(options.chunks) ? options.chunks.join('') : String(options.content ?? '');
      this.documentId = String(document?.id || '');
      this.title = String(document?.title || '');
      this.dirty = false;
      activations.push({ id: this.documentId, title: this.title, text });
    },
    getTextLength() { return text.length; },
    createSnapshot() { return text; },
    getDocumentVersion() { return 0; },
    updateTitle(title) { this.title = String(title || ''); this.dirty = true; },
    markPersisted() { this.dirty = false; },
    adoptDocument(document) { this.documentId = String(document?.id || ''); this.title = String(document?.title || ''); },
    setText(value) { text = String(value ?? ''); }
  };
}

function createRepository({ loadImpl = null } = {}) {
  const calls = [];
  let cancelled = 0;
  return {
    calls,
    get cancelled() { return cancelled; },
    async load(rec, options = {}) {
      calls.push(['load', rec.id, options]);
      if (loadImpl) return loadImpl(rec, options);
      return { content: rec.id.toUpperCase(), chunks: null, loaded: null, metadataPatch: null };
    },
    activate(model, rec, loaded) { calls.push(['activate', rec.id, loaded]); },
    persistSession(records, activeId) { calls.push(['persistSession', records.map(item => item.id), activeId]); },
    persistLegacyActiveTitle(title) { calls.push(['persistTitle', title]); },
    materializeLoadedContent(restored) {
      if (typeof restored?.content === 'string' && restored.content.length) return restored.content;
      if (Array.isArray(restored?.chunks)) return restored.chunks.join('');
      return String(restored?.content || '');
    },
    cancelPendingLoad() { cancelled += 1; calls.push(['cancel']); },
    async save(model) { model.markPersisted?.(); return { native: false }; },
    rememberContent() {}, forgetContent() {}, remove: async () => {},
    clearLegacyActiveSnapshot() {}, persistLegacyActiveSnapshot() {}, readLegacySession: () => [], resetLegacySession() {}
  };
}

function createLoadHarness({ records = [record('a')], activeId = null, repository = null, currentGeneration = 1 } = {}) {
  const documents = createDocumentSessionStore({ initialRecords: records, activeId });
  const model = createModel();
  const editor = { getTextLength: () => model.getTextLength() };
  const repo = repository || createRepository();
  let generation = currentGeneration;
  const controller = createLoadController({
    documents,
    model,
    editor,
    repository: repo,
    resolveRecord(rec, patch, options) { return updateDocumentRecord(rec, patch, options); },
    assertGeneration(operation) {
      if (Number(operation?.generation) === generation) return true;
      throw new DocumentOperationStaleError(operation, generation);
    }
  });
  return { documents, model, editor, repository: repo, controller, setGeneration(value) { generation = value; } };
}

test('Atomic 10.10 LoadController owns only persisted load orchestration and terminal lifecycle', async () => {
  const moduleSource = await source('src/features/persistence/application/load-controller.js');
  assert.doesNotMatch(moduleSource, /from\s+['"]|localStorage|sessionStorage|\bwindow\s*\.|\bdocument\s*\.|setTimeout|setInterval|requestAnimationFrame|Worker\s*\(/);
  assert.doesNotMatch(moduleSource, /bodyCache\s*=\s*new Map|createSnapshot\(|getChangesSince|markPersisted|forceSnapshot/);
  const { controller } = createLoadHarness();
  assert.equal(controller.destroyed, false);
  controller.destroy();
  assert.equal(controller.destroyed, true);
});

test('Atomic 10.10 rejects a stale async load before any model/editor activation', async () => {
  const gate = deferred();
  const repository = createRepository({ loadImpl: () => gate.promise });
  const { controller, model, setGeneration } = createLoadHarness({ repository });
  const pending = controller.loadExisting('a', { generation: 1, kind: 'open' });
  await tick();
  setGeneration(2);
  gate.resolve({ content: 'stale body', chunks: null, loaded: null, metadataPatch: null });
  await assert.rejects(pending, error => error instanceof DocumentOperationStaleError);
  assert.equal(model.activations.length, 0);
});

test('Atomic 10.10 loads metadata then activates model/editor before committing Documents session state', async () => {
  const repository = createRepository({
    loadImpl: async () => ({
      content: 'native body',
      chunks: null,
      loaded: { version: 7 },
      metadataPatch: { title: 'Native.md', updatedAt: 9, nativeBacked: true, nativeVersion: 7 }
    })
  });
  const { controller, documents, model } = createLoadHarness({ repository });
  const result = await controller.loadExisting('a', { generation: 1, kind: 'open' });
  assert.equal(result.record.title, 'Native.md');
  assert.equal(result.editorCharacters, 'native body'.length);
  assert.equal(documents.activeId, 'a');
  assert.equal(documents.getRecord('a').nativeVersion, 7);
  assert.equal(model.documentId, 'a');
  assert.equal(model.createSnapshot(), 'native body');
  assert.deepEqual(repository.calls.map(call => call[0]), ['load', 'activate', 'persistSession', 'persistTitle']);
});

test('Atomic 10.10 can prepare a close-neighbour runtime without committing active/metadata/session state', async () => {
  const repository = createRepository({
    loadImpl: async () => ({ content: 'B body', chunks: null, loaded: { version: 3 }, metadataPatch: { title: 'B Native.md', nativeVersion: 3 } })
  });
  const { controller, documents, model } = createLoadHarness({ records: [record('a'), record('b')], activeId: 'a', repository });
  const result = await controller.loadExisting('b', { generation: 1, kind: 'close' }, {
    commitActive: false,
    commitMetadata: false,
    persist: false
  });
  assert.equal(documents.activeId, 'a');
  assert.equal(documents.getRecord('b').title, 'b.md');
  assert.equal(result.record.title, 'B Native.md');
  assert.equal(result.metadataPatch.nativeVersion, 3);
  assert.equal(model.documentId, 'b');
  assert.deepEqual(repository.calls.map(call => call[0]), ['load', 'activate']);
});

test('Atomic 10.10 isolated read materializes content without activating model or Documents state', async () => {
  const repository = createRepository({ loadImpl: async () => ({ content: '', chunks: ['B', ' body'], loaded: { version: 2 }, metadataPatch: null }) });
  const { controller, documents, model } = createLoadHarness({ records: [record('a'), record('b')], activeId: 'a', repository });
  model.activate(documents.getRecord('a'), { content: 'A body' });
  const before = model.activations.length;
  const result = await controller.readContent('b', { generation: 1, kind: 'read' }, { isolated: true });
  assert.equal(result.content, 'B body');
  assert.equal(documents.activeId, 'a');
  assert.equal(model.documentId, 'a');
  assert.equal(model.activations.length, before);
  assert.equal(repository.calls[0][2].isolated, true);
});

test('Atomic 10.10 preserves repository load failures without fake activation or session commit', async () => {
  const failure = new Error('load failed');
  const repository = createRepository({ loadImpl: async () => { throw failure; } });
  const { controller, documents, model } = createLoadHarness({ repository });
  await assert.rejects(controller.loadExisting('a', { generation: 1, kind: 'open' }), error => error === failure);
  assert.equal(documents.activeId, null);
  assert.equal(model.activations.length, 0);
  assert.deepEqual(repository.calls.map(call => call[0]), ['load']);
});

test('Atomic 10.10 cancellation and destroy delegate pending-load invalidation and suppress late activation', async () => {
  const gate = deferred();
  const repository = createRepository({ loadImpl: () => gate.promise });
  const { controller, model } = createLoadHarness({ repository });
  controller.cancelPending();
  assert.equal(repository.cancelled, 1);
  const pending = controller.loadExisting('a', { generation: 1, kind: 'open' });
  await tick();
  controller.destroy();
  controller.destroy();
  assert.equal(repository.cancelled, 2);
  gate.resolve({ content: 'late', chunks: null, loaded: null, metadataPatch: null });
  await assert.rejects(pending, error => error?.code === 'LOAD_CONTROLLER_DESTROYED');
  assert.equal(model.activations.length, 0);
  assert.throws(() => controller.cancelPending(), error => error?.code === 'LOAD_CONTROLLER_DESTROYED');
});

test('Atomic 10.10 Documents lifecycle delegates persisted reads while keeping one operation-generation authority', async () => {
  const [sessionSource, openSource, closeSource] = await Promise.all([
    source('src/features/documents/application/document-session-controller.js'),
    source('src/features/documents/application/document-open-coordinator.js'),
    source('src/features/documents/application/document-close-coordinator.js')
  ]);
  assert.doesNotMatch(sessionSource, /repository\.load|materializeLoadedContent/);
  assert.match(sessionSource, /loadController\.loadExisting/);
  assert.match(sessionSource, /loadController\.readContent/);
  assert.match(sessionSource, /let generation = 0/);
  assert.doesNotMatch(openSource, /repository\.load|openExisting|activateLoaded/);
  assert.match(openSource, /activateNew/);
  assert.match(closeSource, /loadController\.loadExisting/);
  assert.doesNotMatch(closeSource, /repository\.load/);
});

test('Atomic 10.10 slower persisted open cannot overwrite the newer Documents generation through the migrated chain', async () => {
  const aGate = deferred();
  const bGate = deferred();
  const repository = createRepository({
    loadImpl(rec) {
      if (rec.id === 'a') return aGate.promise;
      if (rec.id === 'b') return bGate.promise;
      return Promise.resolve({ content: '', chunks: null, loaded: null, metadataPatch: null });
    }
  });
  const documents = createDocumentSessionStore({ initialRecords: [record('a'), record('b')] });
  const model = createModel();
  let documentController = null;
  const loadController = createLoadController({
    documents,
    model,
    editor: { getTextLength: () => model.getTextLength() },
    repository,
    resolveRecord(rec, patch, options) { return updateDocumentRecord(rec, patch, options); },
    assertGeneration(operation) {
      if (documentController?.isCurrentGeneration(operation)) return true;
      throw new DocumentOperationStaleError(operation, null);
    }
  });
  documentController = createDocumentSessionController({
    session: documents,
    model,
    repository,
    loadController,
    now: () => 1,
    random: () => 0.5
  });

  const first = documentController.openDocument('a');
  await tick();
  const second = documentController.openDocument('b');
  await tick();
  bGate.resolve({ content: 'body b', chunks: null, loaded: null, metadataPatch: null });
  await second;
  aGate.resolve({ content: 'body a', chunks: null, loaded: null, metadataPatch: null });
  await assert.rejects(first, error => error instanceof DocumentOperationStaleError);
  assert.equal(documents.activeId, 'b');
  assert.equal(model.documentId, 'b');
  assert.equal(model.createSnapshot(), 'body b');
  documentController.destroy();
  loadController.destroy();
});

test('Atomic 10.10 keeps one LoadController authority after later Persistence application atomics', async () => {
  const [entry, mainSource, fixtureText, handoff, readme] = await Promise.all([
    source('src/features/persistence/index.js'),
    source('src/main.js'),
    source('tests/architecture/fixtures/production-modules.json'),
    source('tests/stage-01-handoff.test.mjs'),
    source('README.md')
  ]);
  assert.match(entry, /createLoadController/);
  assert.match(mainSource, /createLoadController/);
  assert.match(mainSource, /loadController\s*\n?\s*\}/);
  assert.match(mainSource, /loadController\.destroy\(\)/);
  const fixture = JSON.parse(fixtureText);
  assert.ok(fixture.modules.length >= 394);
  assert.ok(fixture.modules.some(row => row[0] === 'src/features/persistence/application/load-controller.js'));
  assert.match(handoff, /moduleFixture\.modules\.length,\s*(?:394|39[5-9]|[4-9]\d{2,})/);
  assert.match(readme, /Stage 10/);
});
