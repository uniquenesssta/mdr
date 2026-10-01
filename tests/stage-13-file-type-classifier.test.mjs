import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  IMPORT_KINDS as K, classifyBrowserFile, classifyImportPath, classifyImportResult,
  mountClassicImportClassifierPort
} from '../src/features/import/index.js';

test('browser classification preserves text precedence and MIME-only image selection', () => {
  for (const name of ['note.md', 'note.MARKDOWN', '中文.TxT', '.md', 'md']) {
    assert.equal(classifyBrowserFile({ name, type: 'image/png' }), K.TEXT);
    assert.equal(classifyBrowserFile({ name, type: 'image/png' }, { imageOnly: true }), K.IMAGE);
    assert.equal(classifyBrowserFile({ name, type: '' }, { imageOnly: true }), K.UNSUPPORTED);
  }
  for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/']) {
    assert.equal(classifyBrowserFile({ name: 'photo.unknown', type }), K.IMAGE);
  }
  for (const type of ['', 'text/plain', 'application/pdf', 'IMAGE/PNG', ' image/png']) {
    assert.equal(classifyBrowserFile({ name: 'photo.png', type }), K.UNSUPPORTED);
  }
  assert.equal(classifyBrowserFile({ name: 'note.md.exe', type: '' }), K.UNSUPPORTED);
});

test('native paths use final basename and preserve text/image extension differences', () => {
  for (const suffix of ['md', 'MARKDOWN', 'TxT']) {
    assert.equal(classifyImportPath(' C:\\笔记\\正文.' + suffix + ' '), K.TEXT);
    assert.equal(classifyImportPath('\\\\server\\share\\正文.' + suffix), K.TEXT);
  }
  for (const suffix of ['png', 'JPG', 'jpeg', 'gif', 'webp', 'svg']) {
    assert.equal(classifyImportPath('C:/images/a.' + suffix), K.IMAGE);
  }
  for (const path of ['', '  ', 'C:\\dir.md\\file', 'C:\\dir.md\\', 'a.bmp', 'a.md.exe', 'a.png?x=1', 'a.pdf', 'a.']) {
    assert.equal(classifyImportPath(path), K.UNSUPPORTED, path);
  }
  // These unusual names retain the former split/pop semantics, not a new policy.
  assert.equal(classifyImportPath('C:\\md'), K.TEXT);
  assert.equal(classifyImportPath('C:\\.PNG'), K.IMAGE);
});

test('returned native kind is explicit and cannot be guessed from filename or MIME', () => {
  assert.equal(classifyImportResult({ kind: 'text', name: 'photo.png' }), K.TEXT);
  assert.equal(classifyImportResult({ kind: 'image', name: 'note.md' }), K.IMAGE);
  for (const kind of [undefined, null, '', 'TEXT', ' image ', 'file', 'directory', 'html', 1]) {
    assert.equal(classifyImportResult({ kind, name: 'note.md', mime: 'image/png' }), K.UNSUPPORTED);
  }
});

test('empty or malformed metadata is unsupported and inputs are not mutated', () => {
  for (const input of [undefined, null, false, 42, 'note.md', [], () => {}]) {
    assert.equal(classifyBrowserFile(input), K.UNSUPPORTED);
    assert.equal(classifyImportResult(input), K.UNSUPPORTED);
  }
  for (const input of [undefined, null, false, 42, {}, []]) assert.equal(classifyImportPath(input), K.UNSUPPORTED);
  assert.equal(classifyBrowserFile({ name: 42, type: 42 }), K.UNSUPPORTED);
  assert.equal(classifyBrowserFile(Object.freeze({ name: 'note.md', type: '' })), K.TEXT);
  assert.equal(classifyImportResult(Object.freeze({ kind: 'image' })), K.IMAGE);
  assert.equal(Object.isFrozen(K), true);
});

test('classification never reads contents, size or platform capabilities', () => {
  const file = { name: 'photo.png', type: 'image/png' };
  const result = { kind: 'text' };
  for (const key of ['size', 'content', 'dataUrl', 'text', 'arrayBuffer', 'stream', 'slice']) {
    for (const input of [file, result]) Object.defineProperty(input, key, { get() { assert.fail('read ' + key); } });
  }
  assert.equal(classifyBrowserFile(file), K.IMAGE);
  assert.equal(classifyBrowserFile(file, { imageOnly: true }), K.IMAGE);
  assert.equal(classifyImportResult(result), K.TEXT);
});

test('scoped classic port uses the classifier and has terminal, idempotent teardown', () => {
  assert.throws(() => mountClassicImportClassifierPort(null), /requires a host/);
  const host = {}, mounted = mountClassicImportClassifierPort(host), api = mounted.api;
  assert.equal(host.markdownEditorImportClassifierPort, api);
  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(Object.keys(host), []);
  assert.throws(() => mountClassicImportClassifierPort(host), /already mounted/);
  assert.equal(api.classifyFile({ name: 'a.md', type: 'image/png' }), K.TEXT);
  assert.equal(api.classifyPath('C:\\a.SVG'), K.IMAGE);
  mounted.destroy(); mounted.destroy();
  assert.equal(Object.hasOwn(host, 'markdownEditorImportClassifierPort'), false);
  assert.throws(() => api.classifyFile({ name: 'a.md' }), /destroyed/);
  assert.throws(() => api.classifyPath('a.md'), /destroyed/);
  const replacement = mountClassicImportClassifierPort(host);
  mounted.destroy();
  assert.equal(host.markdownEditorImportClassifierPort, replacement.api);
  replacement.destroy();
});

test('production routing consumes one public classifier with startup and teardown wiring', async () => {
  const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
  const [events, main, image] = await Promise.all([
    read('public/app/events.js'), read('src/main.js'), read('src/features/editor/ui/image-dialog-view.js')
  ]);
  assert.match(events, /eventsCompatibilityHost\?\.markdownEditorImportClassifierPort/);
  assert.match(events, /eventsImportClassifierPort\.classifyFile\(file\)/);
  assert.match(events, /eventsImportClassifierPort\.classifyPath\(resolvedPath\)/);
  assert.doesNotMatch(events, /allowedText|includes\(ext\)|file\.type\.startsWith/);
  assert.match(main, /import \{ mountClassicImportClassifierPort \} from '\.\/features\/import\/index\.js'/);
  assert.ok(main.indexOf('mountClassicImportClassifierPort(compatibilityPlatformHost)') < main.indexOf('for (const src of APP_MODULES)'));
  assert.equal(main.match(/importClassifierPort\.destroy\(\)/g).length, 2);
  assert.match(image, /from '\.\.\/\.\.\/import\/index\.js'/);
  assert.match(image, /classifyBrowserFile\(file, \{ imageOnly: true \}\)/);
});
