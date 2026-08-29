import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createRecentFilesRepository,
  mountClassicRecentFilesPort
} from '../../../src/features/documents/index.js';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const readText = path => readFile(resolve(ROOT, path), 'utf8');

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  let writes = 0;
  return {
    get writes() { return writes; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { writes += 1; values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return new Map(values); }
  };
}

const KEY = 'md_editor_recent_files';

test('Atomic 5.4 loads one bounded case-insensitive deduplicated recent-file snapshot and repairs serialization', () => {
  const raw = [
    { path: ' C:/Notes/Alpha.md ', name: 'Alpha', openedAt: '10', ignored: true },
    { path: 'c:/notes/alpha.md', name: 'Duplicate', openedAt: 9 },
    { path: 'C:/Notes/Nameless.md', name: '', openedAt: 11 },
    null,
    { path: '   ', name: 'Invalid', openedAt: 8 },
    ...Array.from({ length: 30 }, (_, index) => ({
      path: 'C:/Notes/File-' + String(index).padStart(2, '0') + '.md',
      name: 'File ' + index,
      openedAt: index + 1
    }))
  ];
  const storage = createMemoryStorage({ [KEY]: JSON.stringify(raw) });
  const repository = createRecentFilesRepository({ storage });
  const loaded = repository.load();
  assert.equal(loaded.readFailed, false);
  assert.equal(repository.entries.length, 20);
  assert.equal(repository.entries[0].path, 'C:/Notes/Alpha.md');
  assert.equal(repository.entries[1].name, 'Nameless.md');
  assert.equal(repository.entries.filter(item => item.path.toLocaleLowerCase() === 'c:/notes/alpha.md').length, 1);
  assert.ok(Object.isFrozen(repository.entries));
  assert.ok(repository.entries.every(Object.isFrozen));
  assert.ok(Object.isFrozen(repository.snapshot));
  assert.equal(repository.snapshot.entries, repository.entries);
  const serialized = JSON.parse(storage.getItem(KEY));
  assert.equal(serialized.length, 20);
  assert.deepEqual(Object.keys(serialized[0]).sort(), ['name', 'openedAt', 'path']);
  assert.deepEqual(serialized[0], { path: 'C:/Notes/Alpha.md', name: 'Alpha', openedAt: 10 });
  repository.destroy();
});

test('Atomic 5.4 add promotes one path, compares case-insensitively and enforces the exact 20-entry cap', () => {
  const storage = createMemoryStorage();
  let clock = 1000;
  const repository = createRecentFilesRepository({ storage, now: () => ++clock });
  repository.load();
  assert.equal(repository.add('C:/Notes/Derived.md').entries[0].name, 'Derived.md');
  for (let index = 0; index < 23; index += 1) {
    repository.add('C:/Notes/File-' + String(index).padStart(2, '0') + '.md', { name: 'File ' + index });
  }
  assert.equal(repository.entries.length, 20);
  const result = repository.add('c:/notes/FILE-05.md', { name: 'Reopened.md', openedAt: 77 });
  assert.equal(result.added, true);
  assert.equal(repository.entries.length, 20);
  assert.deepEqual(repository.entries[0], { path: 'c:/notes/FILE-05.md', name: 'Reopened.md', openedAt: 77 });
  assert.equal(repository.entries.filter(item => item.path.toLocaleLowerCase() === 'c:/notes/file-05.md').length, 1);
  assert.equal(JSON.parse(storage.getItem(KEY)).length, 20);
  repository.destroy();
});

test('Atomic 5.4 preserves legacy malformed-read and write-failure behavior without losing in-memory state', () => {
  const malformedStorage = createMemoryStorage({ [KEY]: '{broken-json' });
  const malformedRepository = createRecentFilesRepository({ storage: malformedStorage });
  const loaded = malformedRepository.load();
  assert.equal(loaded.readFailed, true);
  assert.deepEqual(malformedRepository.entries, []);
  assert.equal(malformedStorage.getItem(KEY), '{broken-json');
  malformedRepository.destroy();

  const errors = [];
  const failingStorage = {
    getItem() { return null; },
    setItem() { throw new Error('quota'); }
  };
  const repository = createRecentFilesRepository({
    storage: failingStorage,
    now: () => 5,
    reportError(message, error) { errors.push({ message, error: error.message }); }
  });
  assert.equal(repository.load().persisted, false);
  const added = repository.add('C:/Notes/Offline.md', { name: 'Offline.md' });
  assert.equal(added.persisted, false);
  assert.deepEqual(repository.entries[0], { path: 'C:/Notes/Offline.md', name: 'Offline.md', openedAt: 5 });
  const cleared = repository.clear();
  assert.equal(cleared.persisted, false);
  assert.deepEqual(repository.entries, []);
  assert.equal(errors.length, 3);
  assert.ok(errors.every(item => item.message === 'Recent file storage failed:' && item.error === 'quota'));
  repository.destroy();
});

test('Atomic 5.4 valid non-array legacy data normalizes to an empty serialized list and invalid add is a no-op', () => {
  const storage = createMemoryStorage({ [KEY]: JSON.stringify({ path: 'C:/not-an-array.md' }) });
  const repository = createRecentFilesRepository({ storage });
  repository.load();
  assert.deepEqual(repository.entries, []);
  assert.equal(storage.getItem(KEY), '[]');
  const writesBefore = storage.writes;
  const result = repository.add('   ');
  assert.equal(result.added, false);
  assert.equal(result.persisted, null);
  assert.equal(storage.writes, writesBefore);
  repository.destroy();
});

test('Atomic 5.4 clear persists an exact empty list while destroy is idempotent and terminal', () => {
  const storage = createMemoryStorage();
  const repository = createRecentFilesRepository({ storage, now: () => 1 });
  repository.load();
  repository.add('C:/Notes/A.md', { name: 'A.md' });
  const cleared = repository.clear();
  assert.equal(cleared.cleared, true);
  assert.equal(storage.getItem(KEY), '[]');
  repository.destroy();
  repository.destroy();
  assert.throws(() => repository.load(), /destroyed/);
  assert.throws(() => repository.add('C:/Notes/B.md'), /destroyed/);
  assert.throws(() => repository.clear(), /destroyed/);
  assert.throws(() => repository.entries, /destroyed/);
  assert.throws(() => repository.snapshot, /destroyed/);
  assert.throws(() => repository.subscribe(() => {}), /destroyed/);
});

test('Atomic 6.12 repository publishes immutable read-only snapshots only on semantic recent-file changes', () => {
  const storage = createMemoryStorage();
  let clock = 10;
  const listenerErrors = [];
  const repository = createRecentFilesRepository({
    storage,
    now: () => ++clock,
    reportError(message, error) { listenerErrors.push([message, error.message]); }
  });
  const events = [];
  const unsubscribe = repository.subscribe(event => events.push(event));
  repository.subscribe(() => { throw new Error('listener-failed'); });
  repository.load();
  assert.equal(events.length, 0);
  repository.add('C:/Notes/A.md', { name: 'A.md' });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'documents:recent-files-changed');
  assert.equal(events[0].reason, 'add');
  assert.equal(events[0].previous.revision, 0);
  assert.equal(events[0].snapshot.revision, 1);
  assert.ok(Object.isFrozen(events[0]));
  assert.ok(Object.isFrozen(events[0].snapshot));
  assert.ok(Object.isFrozen(events[0].snapshot.entries));
  repository.clear();
  assert.equal(events.length, 2);
  assert.equal(events[1].reason, 'clear');
  assert.equal(listenerErrors.length, 2);
  assert.ok(listenerErrors.every(item => item[0] === 'Recent files listener failed:' && item[1] === 'listener-failed'));
  unsubscribe();
  repository.add('C:/Notes/B.md', { name: 'B.md' });
  assert.equal(events.length, 2);
  repository.destroy();
});

test('Atomic 6.12 classic port exposes write commands only and owns one scoped host lifecycle', () => {
  const storage = createMemoryStorage();
  const repository = createRecentFilesRepository({ storage, now: () => 3 });
  repository.load();
  const host = {};
  const port = mountClassicRecentFilesPort(host, repository);
  assert.equal(host.markdownEditorRecentFilesPort, port);
  assert.throws(() => mountClassicRecentFilesPort(host, repository), /already mounted/);
  assert.deepEqual(Object.keys(port).sort(), ['add', 'clear', 'destroy']);
  assert.equal('entries' in port, false);
  assert.equal('load' in port, false);
  port.add('C:/Notes/A.md', { name: 'A.md' });
  assert.deepEqual(repository.entries[0], { path: 'C:/Notes/A.md', name: 'A.md', openedAt: 3 });
  port.clear();
  assert.deepEqual(repository.entries, []);
  port.destroy();
  port.destroy();
  assert.equal('markdownEditorRecentFilesPort' in host, false);
  assert.throws(() => port.add('C:/Notes/B.md'), /destroyed/);
  repository.destroy();
});

test('Atomic 6.12 production integration keeps persistence in Documents and removes classic Recent Files menu read authority', async () => {
  const [core, bootstrap, events, main, index, repositorySource, portSource, menuController] = await Promise.all([
    readText('public/app/core.js'),
    readText('public/app/bootstrap.js'),
    readText('public/app/events.js'),
    readText('src/main.js'),
    readText('src/features/documents/index.js'),
    readText('src/features/documents/infrastructure/recent-files-repository.js'),
    readText('src/features/documents/compatibility/classic-recent-files-port.js'),
    readText('src/features/menu/recent-files-menu-controller.js')
  ]);
  assert.match(core, /markdownEditorRecentFilesPort/);
  assert.ok(core.includes('coreRecentFilesPort.add('));
  assert.doesNotMatch(core, /coreRecentFilesPort\.(load|clear|entries)/);
  assert.doesNotMatch(core, /function (loadRecentFiles|renderRecentFilesMenu|openRecentFile|clearRecentFiles)\s*\(/);
  assert.doesNotMatch(bootstrap, /loadRecentFiles\(|renderRecentFilesMenu\(/);
  assert.ok(events.includes('if (opened) addRecentFile(resolvedPath, name)'));
  assert.match(main, /recentFilesRepository\.load\(\)/);
  assert.match(main, /createRecentFilesReadSource/);
  assert.match(main, /createRecentFilesMenuController/);
  assert.match(index, /recent-files-read-source\.js/);
  assert.match(index, /recent-files-repository\.js/);
  assert.match(index, /classic-recent-files-port\.js/);
  assert.doesNotMatch(repositorySource, /document\.|window\.|querySelector|createElement/);
  assert.doesNotMatch(portSource, /entries|\.load\(|window\.|querySelector|createElement/);
  assert.doesNotMatch(menuController, /localStorage|sessionStorage|recent-files-repository|platform\.files|handleNativeDroppedPath/);
  assert.ok(core.includes('if (storedDocument?.filePath) addRecentFile(storedDocument.filePath, storedDocument.title)'));
  const modelBlob = execFileSync('git', ['hash-object', 'src/document/document-model.js'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(modelBlob, 'd767d9025be05a6f6b87d7cd3527782db1c3303a');
});
