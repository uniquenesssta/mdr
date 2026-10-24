import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { collectModuleSpecifiers } from '../scripts/architecture/source-analysis.mjs';
import { createVirtualEditor, createHybridMarkdownExtension, getHybridMarkdownStats } from '../src/features/editor/index.js';
import { createNativeDocumentStore, NativeDocumentStore } from '../src/features/persistence/index.js';

const baseline = 'ac3fc3e82b8e4d1258ed38ab991be10686d06317';
const migrations = [
  ['src/editor/hybrid-markdown.js', 'src/features/editor/infrastructure/codemirror-hybrid-extension.js', 'const setHybridBlockDecorations'],
  ['src/editor/virtual-editor.js', 'src/features/editor/infrastructure/virtual-editor.js', 'function countNonWhitespace'],
  ['src/storage/native-document-store.js', 'src/features/persistence/native-document-store/native-document-store.js', 'const NATIVE_DOCUMENT_THRESHOLD'],
  ['src/features/hybrid-editor/compatibility/codemirror-source-editor-port.js', 'src/features/editor/infrastructure/codemirror-source-editor-port.js', 'export const revealHybridSourceRangeEffect']
];
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();

// Reject both resurrection of retired paths and external bypass of the current feature API.
function importIssues(path, source) {
  const issues = [];
  for (const { specifier } of collectModuleSpecifiers(source)) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
    const target = specifier.startsWith('/') ? specifier.slice(1) : posix.normalize(posix.join(posix.dirname(path), specifier));
    for (const [old, current] of migrations) {
      if ([old, old.slice(0, -3)].includes(target)) issues.push('retired:' + target);
      if ([current, current.slice(0, -3)].includes(target)) {
        const feature = current.split('/').slice(0, 3).join('/') + '/';
        if (!path.startsWith(feature)) issues.push('private:' + target);
      }
    }
  }
  return issues;
}

for (const [old, current, marker] of migrations) {
  test('R16-06 removes ' + old + ' and preserves its complete implementation at the current owner', async () => {
    await assert.rejects(access(new URL(old, root)), { code: 'ENOENT' });
    const previous = git(['show', baseline + ':' + old]);
    const source = ['src/editor/hybrid-markdown.js','src/editor/virtual-editor.js','src/storage/native-document-store.js'].includes(old)
      ? git(['show', '3f22fd6b79e17d481d69ae2822c49268e1e0e993:' + current]) : await read(current);
    assert.equal(previous.split(marker).length, 2, old);
    assert.equal(source.split(marker).length, 2, current);
    assert.equal(source.slice(source.indexOf(marker)).trimEnd(), previous.slice(previous.indexOf(marker)), current + ': logic changed beyond imports/header');
  });
}

test('R16-06 application and all production modules use the current public directory APIs', async () => {
  const paths = git(['ls-files', '-z', 'src', 'public']).split('\0').filter(path => /\.(?:js|mjs)$/.test(path));
  for (const path of paths) assert.deepEqual(importIssues(path, await read(path)), [], path);
  const main = await read('src/main.js');
  assert.match(main, /createVirtualEditor[\s\S]*?from '\.\/features\/editor\/index\.js'/);
  assert.match(main, /createNativeDocumentStore[\s\S]*?from '\.\/features\/persistence\/index\.js'/);
});

test('R16-06 import admission rejects static, dynamic and re-export bypasses', () => {
  for (const statement of [
    "import { createVirtualEditor } from './editor/virtual-editor.js';",
    "import './editor/virtual-editor';",
    "import('./features/editor/infrastructure/codemirror-hybrid-extension.js');",
    "export * from './features/persistence/native-document-store/native-document-store.js';"
  ]) assert.equal(importIssues('src/main.js', statement).length, 1, statement);
  assert.deepEqual(importIssues('src/main.js', "import { createVirtualEditor } from './features/editor/index.js';"), []);
});

test('R16-06 public APIs expose the same factories and native source mismatch preserves the error contract', async () => {
  assert.equal(createVirtualEditor(null), null);
  assert.equal(typeof createHybridMarkdownExtension(), 'object');
  assert.equal(typeof getHybridMarkdownStats, 'function');
  const store = createNativeDocumentStore({ available: true, documentStore: { save() { throw new Error('must not write'); } } });
  assert.ok(store instanceof NativeDocumentStore);
  await assert.rejects(store.save({ documentId: 'old' }, { id: 'new' }), /DOCUMENT_SOURCE_MISMATCH/);
  assert.equal(store.saveQueues.size, 0);
  assert.equal(store.sessions.size, 0);
});
