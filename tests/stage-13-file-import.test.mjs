import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createFileImportController, mountClassicFileImportPort } from '../src/features/import/index.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const cancelled = error => error.code === 'FILE_IMPORT_CANCELLED';

test('File Import returns the same immutable text shape for browser and native reads', async () => {
  const calls = [];
  const controller = createFileImportController({
    async readBrowserText(file, { signal }) { calls.push(file); assert.equal(signal.aborted, false); return '中文\r\n😀'; },
    async readNativeText(path) { calls.push(path); return '中文\r\n😀'; }
  });
  const file = { name: 'note.any', size: 0 };
  const browser = await controller.readBrowserFile(file);
  assert.deepEqual(browser, { kind: 'text', name: 'note.any', filePath: '', content: '中文\r\n😀' });
  const native = await controller.readPath(' C:\\docs\\note.MD ');
  assert.deepEqual(native, { kind: 'text', name: 'note.MD', filePath: 'C:\\docs\\note.MD', content: browser.content });
  assert.equal(Object.isFrozen(browser), true); assert.equal(Object.isFrozen(native), true);
  assert.deepEqual(calls, [file, 'C:\\docs\\note.MD']);
  controller.destroy();
});

test('empty text is valid, invalid file/path/result fail without coercing a DTO into content', async () => {
  const calls = [];
  const c = createFileImportController({ readBrowserText: async () => '', readNativeText: async path => { calls.push(path); return {}; } });
  assert.equal((await c.readBrowserFile({ name: 'empty.txt' })).content, '');
  await assert.rejects(c.readBrowserFile(null), /requires a file/);
  for (const path of ['', null, 'a.png', 'a.pdf']) await assert.rejects(c.readPath(path), /supported text path/);
  assert.deepEqual(calls, []);
  await assert.rejects(c.readPath('a.md'), /must return text/);
  c.destroy();
});

test('read errors preserve identity and do not poison the next import', async () => {
  const error = new Error('read denied'); let fail = true;
  const read = async () => { if (fail) throw error; return 'next'; };
  const c = createFileImportController({ readBrowserText: read, readNativeText: read });
  await assert.rejects(c.readPath('a.md'), value => value === error);
  await assert.rejects(c.readBrowserFile({ name: 'a.md' }), value => value === error);
  fail = false;
  assert.equal((await c.readPath('b.md')).content, 'next');
  c.destroy();
});

test('new read cancels the old browser signal and ignores its late success', async () => {
  const slow = deferred(); let signal;
  const c = createFileImportController({
    readBrowserText: (_file, options) => { signal = options.signal; return slow.promise; },
    readNativeText: async () => 'new'
  });
  const first = c.readBrowserFile({ name: 'old.md' }); const rejected = assert.rejects(first, cancelled);
  await Promise.resolve();
  const next = c.readPath('new.md');
  assert.equal(signal.aborted, true);
  slow.resolve('old'); await rejected;
  assert.equal((await next).content, 'new'); c.destroy();
});

test('cancel and destroy settle pending native reads without waiting for native I/O', async () => {
  for (const mode of ['cancel', 'destroy']) {
    const slow = deferred(); const c = createFileImportController({ readBrowserText: async () => '', readNativeText: () => slow.promise });
    const pending = c.readPath('a.md'); const rejected = assert.rejects(pending, cancelled);
    await Promise.resolve(); c[mode](); await rejected;
    slow.reject(new Error('late native error')); await Promise.resolve();
    if (mode === 'cancel') assert.equal(c.cancel(), false);
    c.destroy(); c.destroy();
    assert.throws(() => c.readPath('a.md'), /destroyed/);
    assert.throws(() => c.readBrowserFile({ name: 'a.md' }), /destroyed/);
  }
});

test('cancel before the read microtask prevents I/O from starting', async () => {
  let calls = 0;
  const read = async () => { calls++; return ''; };
  const c = createFileImportController({ readBrowserText: read, readNativeText: read });
  const pending = c.readPath('a.md'); const rejected = assert.rejects(pending, cancelled);
  c.cancel(); await rejected; assert.equal(calls, 0); c.destroy();
});

test('classic File Import bridge is scoped, rejects duplicates and becomes terminal', async () => {
  const c = createFileImportController({ readBrowserText: async () => 'browser', readNativeText: async () => 'native' });
  const host = {}; const port = mountClassicFileImportPort(host, c);
  assert.equal(host.markdownEditorFileImportPort, port.api); assert.deepEqual(Object.keys(host), []);
  assert.throws(() => mountClassicFileImportPort(host, c), /already mounted/);
  assert.equal((await port.api.readPath('a.md')).content, 'native');
  port.destroy(); port.destroy(); assert.equal(Object.hasOwn(host, 'markdownEditorFileImportPort'), false);
  assert.throws(() => port.api.readPath('a.md'), /destroyed/); c.destroy();
});

test('text callers use Import while Documents retains lazy load and document commit ownership', async () => {
  const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
  const [main, legacy, events] = await Promise.all([read('src/main.js'), read('public/app/export.js'), read('public/app/events.js')]);
  assert.match(main, /readNativeText: path => platform\.files\.readText\(path\)/);
  assert.match(legacy, /exportFileImportPort\.readBrowserFile\(file\)/);
  assert.match(legacy, /exportDocumentControllerPort\.openExternalDocument\(/);
  assert.doesNotMatch(legacy.slice(legacy.indexOf('    function loadFile')), /new FileReader|readAsText/);
  assert.match(events, /eventsFileImportPort\.readPath\(resolvedPath\)/);
  assert.equal(main.match(/fileImportController\.destroy\(\)/g).length, 2);
  assert.equal(main.match(/fileImportPort\.destroy\(\)/g).length, 2);
});
