import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDocumentId,
  createDocumentRecord,
  createRecentFileEntry,
  mountClassicDocumentDomainPort,
  normalizeDocumentId,
  normalizeDocumentNativeMetadata,
  normalizeDocumentPath,
  normalizeDocumentTitle,
  normalizeRecentFilePath,
  updateDocumentRecord
} from '../../../src/features/documents/index.js';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const readText = path => readFile(resolve(ROOT, path), 'utf8');

test('Atomic 5.1 creates safe compatible ids while preserving previously accepted persisted identifiers exactly', () => {
  assert.equal(createDocumentId({ now: () => 1234, random: () => 0.5 }), 'doc_1234_i');
  assert.throws(() => createDocumentId({ now: () => -1, random: () => 0.5 }), /timestamp/);
  assert.throws(() => createDocumentId({ now: () => 1, random: () => 1 }), /entropy/);
  assert.equal(normalizeDocumentId(' legacy id / v1 '), ' legacy id / v1 ');
  assert.throws(() => normalizeDocumentId(''), /must not be empty/);
});

test('Atomic 5.1 normalizes title and path without taking body ownership', () => {
  assert.equal(normalizeDocumentTitle(' Draft '), 'Draft.md');
  assert.equal(normalizeDocumentTitle('notes.txt'), 'notes.txt');
  assert.equal(normalizeDocumentTitle('', 'Untitled'), 'Untitled.md');
  assert.equal(normalizeDocumentPath(' C:\\Docs\\a.md '), ' C:\\Docs\\a.md ');
  assert.equal(normalizeRecentFilePath(' C:\\Docs\\a.md '), 'C:\\Docs\\a.md');
});

test('Atomic 5.1 new document records are immutable metadata-only values with compatible metadata surfaces', () => {
  const record = createDocumentRecord({
    title: 'Alpha',
    filePath: 'C:\\Docs\\alpha.md',
    nativeBacked: true,
    nativeVersion: 4.9
  }, { now: () => 100, random: () => 0.25 });
  assert.deepEqual(record, {
    id: 'doc_100_9',
    title: 'Alpha.md',
    createdAt: 100,
    updatedAt: 100,
    filePath: 'C:\\Docs\\alpha.md',
    nativeBacked: true,
    nativeVersion: 4.9
  });
  assert.equal(Object.isFrozen(record), true);
  assert.equal('content' in record, false);
  assert.equal('body' in record, false);
  assert.throws(() => createDocumentRecord({ title: 'x', content: 'forbidden' }), /must not contain document body/);
  assert.throws(() => createDocumentRecord({ title: 'x', contentChunks: [] }), /must not contain document body/);
});

test('Atomic 5.1 record updates preserve identity and tolerate legacy records that omitted createdAt', () => {
  const record = createDocumentRecord({ id: 'doc_existing', title: 'A.md', createdAt: 10, updatedAt: 10 });
  const updated = updateDocumentRecord(record, { title: 'B', updatedAt: 20, nativeBacked: true, nativeVersion: 2 });
  assert.deepEqual(updated, {
    id: 'doc_existing', title: 'B.md', createdAt: 10, updatedAt: 20, nativeBacked: true, nativeVersion: 2
  });
  assert.throws(() => updateDocumentRecord(record, { id: 'other' }), /immutable/);
  assert.throws(() => updateDocumentRecord(record, { content: 'no' }), /must not contain document body/);

  const legacy = Object.freeze({ id: ' legacy/id ', title: 'Legacy.md', updatedAt: '7' });
  const legacyUpdated = updateDocumentRecord(legacy, { title: 'Renamed', updatedAt: 5.5 });
  assert.deepEqual(legacyUpdated, { id: ' legacy/id ', title: 'Renamed.md', updatedAt: 5.5 });
  assert.equal('createdAt' in legacyUpdated, false);
});

test('Atomic 5.1 native metadata and recent-file entries preserve legacy numeric tolerance and exact persistence surfaces', () => {
  assert.deepEqual(normalizeDocumentNativeMetadata({ nativeBacked: 1, nativeVersion: 7.8 }), {
    nativeBacked: true, nativeVersion: 7.8
  });
  assert.deepEqual(normalizeDocumentNativeMetadata({ nativeBacked: false, nativeVersion: -2 }), {
    nativeBacked: false, nativeVersion: -2
  });
  assert.deepEqual(createDocumentRecord({ id: 'legacy', title: 'Legacy.md', updatedAt: 1, nativeBacked: false, nativeVersion: 0 }), {
    id: 'legacy', title: 'Legacy.md', updatedAt: 1, nativeBacked: false, nativeVersion: 0
  });
  const entry = createRecentFileEntry({ path: ' C:\\Docs\\one.md ', openedAt: -4.5 });
  assert.deepEqual(entry, { path: 'C:\\Docs\\one.md', name: 'one.md', openedAt: -4.5 });
  assert.equal(Object.isFrozen(entry), true);
  assert.throws(() => createRecentFileEntry({ path: '   ' }), /must not be empty/);
});

test('Atomic 5.1 classic compatibility port owns only one explicit host property lifecycle', () => {
  const host = {};
  const port = mountClassicDocumentDomainPort(host);
  assert.equal(host.markdownEditorDocumentDomainPort, port);
  assert.throws(() => mountClassicDocumentDomainPort(host), /already mounted/);
  assert.equal(port.normalizeTitle('x', 'Untitled'), 'x.md');
  port.destroy();
  port.destroy();
  assert.equal('markdownEditorDocumentDomainPort' in host, false);
  assert.throws(() => port.normalizeTitle('x'), /destroyed/);
});

test('Atomic 5.1 production integration removes classic metadata normalization authority without changing the frozen DocumentModel', async () => {
  const [core, bootstrap, nativeStore, entry] = await Promise.all([
    readText('public/app/core.js'),
    readText('src/bootstrap/module-entry.js'),
    readText('src/storage/native-document-store.js'),
    readText('src/features/documents/index.js')
  ]);
  assert.match(core, /coreCompatibilityHost\?\.markdownEditorDocumentDomainPort/);
  assert.doesNotMatch(core, /Math\.random\(\)\.toString\(36\)\.slice\(2, 8\)/);
  assert.doesNotMatch(core, /function normalizeRecentFilePath/);
  assert.match(core, /createRecentFileEntry/);
  assert.match(bootstrap, /mountClassicDocumentDomainPort\(portsHost\)/);
  assert.match(nativeStore, /features\/documents\/index\.js/);
  assert.equal((nativeStore.match(/normalizeDocumentNativeMetadata/g) || []).length, 3);
  assert.match(entry, /document-record\.js/);
  const globals = core + '\n' + bootstrap + '\n' + nativeStore + '\n' + entry;
  assert.doesNotMatch(globals, /window\.markdownEditorDocumentDomainPort/);
  const frozenHash = execFileSync('git', ['hash-object', 'src/document/document-model.js'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(frozenHash, 'd767d9025be05a6f6b87d7cd3527782db1c3303a');
});
