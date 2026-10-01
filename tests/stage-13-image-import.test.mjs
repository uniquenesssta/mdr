import assert from 'node:assert/strict';
import test from 'node:test';
import { createImageImportController, isImageImportCancelled } from '../src/features/import/index.js';
import { createBrowserFileReader } from '../src/platform/browser/browser-file-reader.js';
import { createImageDialogView } from '../src/features/editor/ui/image-dialog-view.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const file = { name: 'image.png', type: 'image/png', size: 1 };
function readerHarness() {
  const readers = [];
  class Reader {
    readyState = 0;
    aborts = 0;
    constructor() { readers.push(this); }
    readAsDataURL() { this.readyState = 1; }
    abort() { this.aborts++; this.readyState = 2; this.onabort?.(); }
    load(url = 'data:image/png;base64,AA==') { this.result = url; this.readyState = 2; this.onload?.(); }
  }
  const adapter = createBrowserFileReader({ FileReaderClass: Reader });
  return { readers, readBrowserImage: adapter.readDataUrl };
}

test('image controller reads File/native, forms insertion requests and has terminal lifecycle', async () => {
  const h = readerHarness();
  const c = createImageImportController({ ...h, readNativeImage: async path => { assert.equal(path, 'C:/a.png'); return 'data:native'; } });
  const pending = c.readFile(file); h.readers[0].load();
  assert.deepEqual(await pending, { name: 'image.png', url: 'data:image/png;base64,AA==' });
  assert.deepEqual(await c.readPath('C:/a.png'), { name: 'a.png', url: 'data:native' });
  const request = c.createInsertion(' https://example.test/a.png ', { alt: '图片', selection: { start: 1, end: 2 } });
  assert.equal(request.url, 'https://example.test/a.png');
  assert.equal(Object.isFrozen(request), true); assert.equal(Object.isFrozen(request.options), true);
  assert.equal(c.createInsertion(' '), null);
  c.destroy(); c.destroy();
  await assert.rejects(c.readFile(file), /destroyed/);
  assert.throws(() => c.createInsertion('x'), /destroyed/);
});

test('replacement, parent abort and destroy settle pending reads, abort once and ignore saved callbacks', async () => {
  for (const mode of ['replace', 'parent', 'destroy']) {
    const h = readerHarness(), c = createImageImportController(h), parent = new AbortController();
    const pending = c.readFile(file, { signal: parent.signal });
    const rejected = assert.rejects(pending, isImageImportCancelled);
    const old = h.readers[0], late = old.onload;
    let replacement;
    if (mode === 'replace') replacement = c.readFile(file);
    if (mode === 'parent') parent.abort();
    if (mode === 'destroy') c.destroy();
    await rejected;
    assert.equal(old.aborts, 1);
    assert.equal(old.onload, null); assert.equal(old.onerror, null); assert.equal(old.onabort, null);
    old.result = 'late'; late();
    if (replacement) { h.readers[1].load('new'); assert.equal((await replacement).url, 'new'); }
    c.destroy();
  }
});

test('policy rejection, refusal and pre-abort do not read; native cancellation does not await IPC', async () => {
  const h = readerHarness(); let resolveNative;
  const c = createImageImportController({ ...h, readNativeImage: () => new Promise(resolve => { resolveNative = resolve; }) });
  await assert.rejects(c.readFile({ ...file, size: 5 * 1024 * 1024 + 1 }), { code: 'IMAGE_IMPORT_TOO_LARGE' });
  await assert.rejects(c.readFile({ ...file, type: '' }), { code: 'IMAGE_IMPORT_UNSUPPORTED' });
  await assert.rejects(c.readFile({ ...file, size: 3 * 1024 * 1024 }, { source: 'dialog', confirmLargeFile: () => false }), isImageImportCancelled);
  const parent = new AbortController(); parent.abort();
  await assert.rejects(c.readFile(file, { signal: parent.signal }), isImageImportCancelled);
  assert.equal(h.readers.length, 0);
  const native = c.readPath('C:/slow.png'), rejected = assert.rejects(native, isImageImportCancelled);
  c.cancel(); await rejected; resolveNative('late'); await tick(); c.destroy();
});

test('reader errors and spontaneous abort retain distinct failure/cancellation results', async () => {
  for (const mode of ['error', 'abort', 'throw']) {
    const h = readerHarness();
    const error = new Error('read failed');
    const c = createImageImportController(mode === 'throw' ? { readBrowserImage() { throw error; } } : h);
    const pending = c.readFile(file);
    const rejected = assert.rejects(pending, mode === 'abort' ? isImageImportCancelled : value => value === error);
    if (mode === 'error') { h.readers[0].error = error; h.readers[0].onerror(); }
    if (mode === 'abort') h.readers[0].onabort();
    await rejected; c.destroy();
  }
});

function dialogHarness(confirmLargeFile = () => true) {
  const h = readerHarness(), nodes = new Map(), inserted = [], messages = [];
  class Element extends EventTarget {
    value = ''; files = []; dataset = {}; children = [];
    classList = { toggle() {} };
    replaceChildren(...children) { this.children = children; }
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); }
    querySelectorAll() { return []; }
  }
  class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail; } }
  const root = new Element(); root.ownerDocument = { defaultView: { CustomEvent }, createElement: () => new Element() };
  let onClose;
  root.addEventListener('markdown-editor:modal-shell-open', event => { onClose = event.detail.options.onClose; });
  const view = createImageDialogView({ root, confirmLargeFile, imageController: createImageImportController(h),
    selection: { snapshot: () => ({ start: 2, end: 2 }) }, insertImage: (...args) => inserted.push(args), notify: x => messages.push(x) });
  view.open();
  return { ...h, root, view, inserted, messages, shellClose: () => onClose(),
    choose(value = file) { const input = root.querySelector('#image-file-input'); input.files = value ? [value] : []; input.dispatchEvent(new Event('change')); } };
}

test('dialog pending reads cannot revive preview or insert after replacement/close/tab/destroy', async () => {
  for (const mode of ['replace', 'close', 'shell', 'tab', 'destroy', 'empty', 'invalid']) {
    const h = dialogHarness(); h.choose(); const old = h.readers[0], late = old.onload;
    if (mode === 'replace') h.choose({ ...file, name: 'new.png' });
    if (mode === 'close') h.view.close();
    if (mode === 'shell') h.shellClose();
    if (mode === 'tab') h.view.switchTab('url');
    if (mode === 'destroy') h.view.destroy();
    if (mode === 'empty') h.choose(null);
    if (mode === 'invalid') h.choose({ ...file, type: '' });
    old.result = 'late'; late(); await tick();
    assert.equal(old.aborts, 1);
    assert.equal(h.root.querySelector('#image-upload-preview').children.length, 0);
    assert.deepEqual(h.inserted, []);
    if (mode === 'replace') {
      h.readers[1].load('data:new'); await tick();
      assert.equal(h.view.confirm(), true); assert.equal(h.inserted[0][0], 'data:new');
    } else { h.view.switchTab('upload'); assert.equal(h.view.confirm(), false); }
    h.view.destroy();
  }
});

test('dialog failed or refused replacement clears earlier successful upload and cannot insert it', async () => {
  for (const mode of ['error', 'abort', 'oversize', 'invalid', 'refuse']) {
    const h = dialogHarness(() => false); h.choose(); h.readers[0].load('data:old'); await tick();
    h.choose(mode === 'oversize' ? { ...file, size: 6 * 1024 * 1024 } : mode === 'invalid' ? { ...file, type: '' } : mode === 'refuse' ? { ...file, size: 3 * 1024 * 1024 } : file);
    if (mode === 'error') { h.readers[1].error = new Error('failed'); h.readers[1].onerror(); }
    if (mode === 'abort') h.readers[1].onabort();
    await tick(); h.view.switchTab('upload');
    assert.equal(h.view.confirm(), false); assert.deepEqual(h.inserted, []);
    assert.equal(h.root.querySelector('#image-upload-preview').children.length, 0);
    h.view.destroy();
  }
});
