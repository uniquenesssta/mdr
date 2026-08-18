import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createBrowserDocumentRepository } from '../src/features/persistence/index.js';
import { createSessionDocumentRepository } from '../src/features/documents/index.js';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
}

function createBrowser(overrides = {}) {
  return createBrowserDocumentRepository({ storage: createStorage(), ...overrides });
}

test('Atomic 10.9 BrowserDocumentRepository owns only browser fallback storage and body-cache lifecycle', async () => {
  const moduleSource = await source('src/features/persistence/browser/browser-document-repository.js');
  assert.doesNotMatch(moduleSource, /from\s+['"]|NativeDocumentStore|createNative|DocumentModel|createSnapshot|getChangesSince|markPersisted/);
  assert.doesNotMatch(moduleSource, /\bwindow\s*\.|\bdocument\s*\.|setTimeout|setInterval|requestAnimationFrame|Worker\s*\(/);
  const repository = createBrowser();
  assert.equal(repository.destroyed, false);
  assert.equal(repository.cachedBodyCount, 0);
  repository.destroy();
  assert.equal(repository.destroyed, true);
});

test('Atomic 10.9 persists browser document metadata and the authoritative cached body', () => {
  const storage = createStorage();
  const repository = createBrowserDocumentRepository({ storage });
  repository.rememberContent('doc-browser', '# browser body');
  assert.equal(repository.persistSession([{ id: 'doc-browser', title: 'Browser.md', nativeBacked: false }], 'doc-browser'), true);
  const records = JSON.parse(storage.getItem('md_editor_documents'));
  assert.deepEqual(records, [{ id: 'doc-browser', title: 'Browser.md', nativeBacked: false, content: '# browser body' }]);
  assert.equal(storage.getItem('md_editor_current_document'), 'doc-browser');
  assert.equal(storage.getItem('md_editor_documents_intentionally_empty'), null);
});

test('Atomic 10.9 never serializes a duplicate full body for native-backed records', () => {
  const storage = createStorage();
  const repository = createBrowserDocumentRepository({ storage });
  repository.rememberContent('doc-native', 'cached full body that must not be serialized');
  repository.persistSession([{ id: 'doc-native', title: 'Native.md', nativeBacked: true, content: 'record leak' }], 'doc-native');
  const [record] = JSON.parse(storage.getItem('md_editor_documents'));
  assert.deepEqual(record, { id: 'doc-native', title: 'Native.md', nativeBacked: true });
  repository.persistLegacyActiveSnapshot({ title: 'Native.md', content: 'duplicate', nativeBacked: true });
  assert.equal(storage.getItem('md_editor_content'), null);
  assert.equal(storage.getItem('md_editor_filename'), 'Native.md');
});

test('Atomic 10.9 reads legacy browser records and hydrates only non-native fallback bodies', () => {
  const storage = createStorage({
    md_editor_documents: JSON.stringify([
      { id: 'browser', title: 'Browser.md', nativeBacked: false, content: 'body' },
      { id: 'native', title: 'Native.md', nativeBacked: true, content: 'stale duplicate' }
    ])
  });
  const repository = createBrowserDocumentRepository({ storage });
  const records = repository.readLegacySession();
  assert.equal(records.length, 2);
  assert.equal(repository.hasContent('browser'), true);
  assert.equal(repository.readContent('browser'), 'body');
  assert.equal(repository.hasContent('native'), false);
});

test('Atomic 10.9 keeps browser storage failures explicit through the injected reporter without inventing success', () => {
  const failure = new Error('quota');
  const errors = [];
  const storage = createStorage();
  storage.setItem = () => { throw failure; };
  const repository = createBrowserDocumentRepository({ storage, reportError: (message, error) => errors.push([message, error]) });
  repository.rememberContent('doc', 'body');
  assert.equal(repository.persistSession([{ id: 'doc', nativeBacked: false }], 'doc'), false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1], failure);
});

test('Atomic 10.9 reset and destroy clear browser body ownership and destroy is terminal', () => {
  const storage = createStorage({ md_editor_documents: '[]', md_editor_content: 'legacy', md_editor_filename: 'A.md' });
  const repository = createBrowserDocumentRepository({ storage });
  repository.rememberContent('doc', 'body');
  assert.equal(repository.resetLegacySession(), true);
  assert.equal(repository.cachedBodyCount, 0);
  assert.equal(storage.getItem('md_editor_documents'), null);
  assert.equal(storage.getItem('md_editor_content'), null);
  repository.rememberContent('doc', 'again');
  repository.destroy();
  repository.destroy();
  assert.throws(() => repository.readContent('doc'), error => error?.code === 'BROWSER_DOCUMENT_REPOSITORY_DESTROYED');
});

test('Atomic 10.9 SessionDocumentRepository delegates browser fallback reads and writes without owning storage keys or body cache', async () => {
  const browser = createBrowser();
  const repository = createSessionDocumentRepository({ browserRepository: browser });
  const sourceModel = {
    getTextLength: () => 4,
    getDocumentVersion: () => 2,
    createSnapshot: () => 'body',
    markPersisted(version, backendVersion) { this.persisted = [version, backendVersion]; }
  };
  const result = await repository.save(sourceModel, { id: 'doc', nativeBacked: false });
  assert.deepEqual(result, { native: false });
  assert.equal(browser.readContent('doc'), 'body');
  assert.deepEqual(sourceModel.persisted, [2, 0]);
  const loaded = await repository.load({ id: 'doc', nativeBacked: false });
  assert.equal(loaded.content, 'body');

  const moduleSource = await source('src/features/documents/infrastructure/session-document-repository.js');
  assert.doesNotMatch(moduleSource, /md_editor_documents|md_editor_content|localStorage|storage\.setItem|storage\.getItem|bodyCache\s*=\s*new Map/);
});

test('Atomic 10.9 successful native persistence evicts browser fallback body and native load remains authoritative', async () => {
  const browser = createBrowser();
  const nativeStore = {
    available: true,
    shouldUse() { return true; },
    async save() { return { native: true, nativeVersion: 3 }; },
    async load() { return { content: 'native body', title: 'Native.md', version: 3, updatedAt: 5 }; },
    activateDocument() {}, cancelLoad() {}
  };
  const repository = createSessionDocumentRepository({ browserRepository: browser, nativeStore });
  const sourceModel = { getTextLength: () => 5, getDocumentVersion: () => 1, createSnapshot: () => 'local' };
  const record = { id: 'native', title: 'Native.md', nativeBacked: false };
  const saved = await repository.save(sourceModel, record);
  assert.equal(saved.native, true);
  assert.equal(browser.hasContent('native'), false);
  const loaded = await repository.load({ ...record, nativeBacked: true });
  assert.equal(loaded.content, 'native body');
  assert.equal(loaded.metadataPatch.nativeVersion, 3);
  assert.equal(browser.hasContent('native'), false);
});

test('Atomic 10.9 preserves the native-backed no-fallback protection and scheduled native cleanup semantics', async () => {
  const browser = createBrowser();
  const deleted = [];
  const tasks = [];
  const nativeStore = {
    available: true,
    async load() { return null; },
    async delete(id) { deleted.push(id); },
    cancelLoad() {}
  };
  const repository = createSessionDocumentRepository({
    browserRepository: browser,
    nativeStore,
    scheduleCleanup(task) { tasks.push(task); }
  });
  await assert.rejects(repository.load({ id: 'native-missing', nativeBacked: true }), /无法恢复后台文档快照/);
  repository.resetLegacySession([{ id: 'a' }, { id: 'a' }, { id: 'b' }]);
  assert.equal(tasks.length, 1);
  await tasks[0]();
  assert.deepEqual(deleted.sort(), ['a', 'b']);
});

test('Atomic 10.9 keeps one BrowserDocumentRepository authority after later Persistence application atomics', async () => {
  const [entry, mainSource, sessionSource, fixtureText, handoff] = await Promise.all([
    source('src/features/persistence/index.js'),
    source('src/main.js'),
    source('src/features/documents/infrastructure/session-document-repository.js'),
    source('tests/architecture/fixtures/production-modules.json'),
    source('tests/stage-01-handoff.test.mjs')
  ]);
  assert.match(entry, /createBrowserDocumentRepository/);
  assert.match(mainSource, /createBrowserDocumentRepository/);
  assert.match(mainSource, /browserRepository:\s*browserDocumentRepository/);
  assert.match(mainSource, /browserDocumentRepository\.destroy\(\)/);
  assert.match(sessionSource, /browserRepository\.persistSession/);
  assert.doesNotMatch(sessionSource, /localStorage|sessionStorage|const\s+DOCS_KEY|const\s+STORAGE_KEY/);
  assert.match(entry, /createLoadController/);
  assert.match(mainSource, /createLoadController/);
  const fixture = JSON.parse(fixtureText);
  assert.ok(fixture.modules.length >= 394);
  assert.ok(fixture.modules.some(record => record[0] === 'src/features/persistence/browser/browser-document-repository.js'));
  assert.match(handoff, /moduleFixture\.modules\.length/);
});
