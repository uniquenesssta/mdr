import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  IMPORT_KINDS as K, classifyBrowserFile, classifyImportPath, classifyImportResult
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

test('production routing consumes one public classifier with startup and teardown wiring', async () => {
  const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
  const [events, main, image, drop, entry] = await Promise.all([
    read('public/app/events.js'), read('src/main.js'), read('src/features/editor/ui/image-dialog-view.js'),
    read('src/features/import/files/drop-import-controller.js'), read('src/features/import/index.js')
  ]);
  assert.doesNotMatch(events, /eventsDropImportPort|eventsFileImportPort/);
  assert.match(drop, /classifyBrowserFile\(file\)/);
  assert.match(drop, /classifyImportPath\(resolvedPath\)/);
  assert.doesNotMatch(events, /allowedText|includes\(ext\)|file\.type\.startsWith|eventsImportClassifierPort/);
  assert.doesNotMatch(entry + main, /mountClassicImportClassifierPort|classic-import-classifier-port/);
  assert.match(main, /dropImportController\.start\(\{/);
  assert.match(main, /openNativeText: \(path, request\) => importDocumentController\.openNativeText\(path, request\)/);
  assert.ok(main.indexOf('dropImportController.start({') < main.indexOf('for (const src of APP_MODULES)'));
  assert.equal(main.match(/dropImportController\.destroy\(\)/g).length, 3);
  assert.doesNotMatch(entry + main, /mountClassicDropImportPort|classic-drop-import-port/);
  assert.match(image, /from '\.\.\/\.\.\/import\/index\.js'/);
  assert.match(image, /imageController\.readFile\(file, \{ source: 'dialog', confirmLargeFile \}\)/);
});
