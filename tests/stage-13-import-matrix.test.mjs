import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createBrowserFileReader } from '../src/platform/browser/browser-file-reader.js';
import { createImageImportController, createDropImportController, createDropOverlayView, mountClassicDropImportPort, createFileImportController, mountClassicFileImportPort } from '../src/features/import/index.js';
import { createImageDialogView } from '../src/features/editor/ui/image-dialog-view.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const eventsSource = await read('public/app/events.js');
const exportSource = await read('public/app/export.js');
const coreSource = await read('public/app/core.js');
const webSource = await read('public/app/web-clipper.js');
const MiB = 1024 * 1024;

// Execute remaining commands with the real Drop Import and File Import controllers; readers are injected.
function section(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, 'legacy section must still exist until its migration');
  return source.slice(first, last);
}
function dropHost({ desktop = false, failRead = false, opened = true } = {}) {
  const calls = [], handlers = new Map();
  const overlay = new Set();
  const document = {
    getElementById: () => ({ classList: { add: x => overlay.add(x), remove: x => overlay.delete(x) } }),
    addEventListener: (name, handler) => handlers.set(name, handler),
    removeEventListener: (name, handler) => { if (handlers.get(name) === handler) handlers.delete(name); }
  };
  const controller = createDropImportController({
    target: document, nativeDrop: desktop, nativeFiles: desktop,
    subscribeNative: handler => { handlers.set('native', handler); return () => handlers.delete('native'); }
  });
  const overlayView = createDropOverlayView({ element: document.getElementById('drop-overlay') });
  const imageController = createImageImportController({
    readBrowserImage: (file, options) => createBrowserFileReader({ FileReaderClass: context.FileReader }).readDataUrl(file, options),
    readNativeImage: path => context.eventsPlatformPort.call('files', 'readImage', path, '')
  });
  const context = vm.createContext({
    document,
    eventsDropImportPort: mountClassicDropImportPort({}, {
      start: callbacks => controller.start({ ...callbacks, setOverlayVisible: overlayView.setVisible }),
      openPath: controller.openPath
    }, imageController).api,
    eventsFileImportPort: mountClassicFileImportPort({}, createFileImportController({
      readBrowserText: async () => '',
      async readNativeText(path) {
        calls.push(['readText', path]);
        if (failRead) throw new Error('read denied');
        return '正文';
      }
    })).api,
    eventsPlatformPort: {
      supports: name => desktop && ['desktop.fileSystem', 'desktop.dragDrop'].includes(name),
      async call(group, operation, ...args) {
        if (group === 'dragDrop') { handlers.set('native', args[0]); return; }
        calls.push([operation, ...args]);
        if (failRead) throw new Error('read denied');
        return operation === 'readText' ? '正文' : 'data:image/png;base64,AA==';
      }
    },
    loadFile: file => calls.push(['text', file.name]),
    loadDocumentFromContentLoader: async (name, loader, path) => { await loader(); calls.push(['document', name, path]); return opened; },
    addRecentFile: (...args) => calls.push(['recent', ...args]),
    insertImageMarkdown: (...args) => calls.push(['image', ...args]),
    showToast: message => calls.push(['toast', message]), t: key => key, console,
    FileReader: class { readAsDataURL(file) { calls.push(['dataUrl', file.name]); this.result = 'data:image/png;base64,AA=='; this.onload(); } }
  });
  vm.runInContext(section(eventsSource, '    // R13.4 owns event routing;', '    // Settings menu trigger'), context);
  return { context, calls, handlers, overlay, controller, drop(files) { return handlers.get('drop')({ preventDefault() {}, dataTransfer: { files } }); } };
}

for (const extension of ['md', 'MARKDOWN', 'TxT']) {
  test('browser text extension takes precedence over MIME: ' + extension, async () => {
    const h = dropHost(); await h.drop([{ name: 'note.' + extension, type: 'image/png', size: 9 * MiB }]);
    assert.deepEqual(h.calls, [['text', 'note.' + extension]]);
  });
}
for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp']) {
  test('browser image MIME and inclusive 5 MiB boundary: ' + mime, async () => {
    const h = dropHost(); await h.drop([{ name: 'photo.unknown', type: mime, size: 5 * MiB }]);
    assert.equal(h.calls[0][0], 'dataUrl'); assert.equal(h.calls[1][0], 'image');
    assert.deepEqual(h.calls[2], ['toast', 'toastImageInserted']);
  });
}
test('browser over-limit, unsupported MIME, empty and multiple drops', async () => {
  const h = dropHost(); await h.drop([]); assert.deepEqual(h.calls, []);
  await h.drop([{ name: 'large.png', type: 'image/png', size: 5 * MiB + 1 }]);
  await h.drop([{ name: 'fake.png', type: '', size: 1 }]);
  await h.drop([{ name: 'a.pdf', type: 'application/pdf', size: 1 }, { name: 'b.md', type: '', size: 1 }]);
  assert.deepEqual(h.calls, [['toast', 'toastImageTooLarge'], ['toast', 'toastDropUnsupported'], ['toast', 'toastDropUnsupported']]);
});
test('native paths use extensions, preserve source path and add recents only after success', async () => {
  for (const extension of ['MD', 'markdown', 'txt']) {
    const h = dropHost({ desktop: true }); const path = 'C:\\notes\\正文.' + extension;
    assert.equal(await h.context.handleNativeDroppedPath(path), true);
    assert.deepEqual(h.calls.map(x => x[0]), ['readText', 'document', 'recent']);
    assert.equal(h.calls[0][1], path);
  }
  const h = dropHost({ desktop: true, opened: false });
  assert.equal(await h.context.handleNativeDroppedPath('C:\\a.md'), false);
  assert.equal(h.calls.some(x => x[0] === 'recent'), false);
});
test('native image extensions route through readImage, including SVG, but not BMP', async () => {
  for (const extension of ['png', 'JPG', 'jpeg', 'gif', 'webp', 'svg']) {
    const h = dropHost({ desktop: true });
    assert.equal(await h.context.handleNativeDroppedPath('C:\\photo.' + extension), true);
    assert.deepEqual(h.calls.map(x => x[0]), ['readImage', 'image', 'toast']);
    assert.equal(h.calls[0][2], '');
  }
  const h = dropHost({ desktop: true });
  assert.equal(await h.context.handleNativeDroppedPath('C:\\photo.bmp'), false);
  assert.deepEqual(h.calls, [['toast', 'toastDropUnsupported']]);
});
test('native read failure and empty path do not insert or add a recent file', async () => {
  const h = dropHost({ desktop: true, failRead: true });
  assert.equal(await h.context.handleNativeDroppedPath('  '), false);
  assert.equal(await h.context.handleNativeDroppedPath('C:\\a.png'), false);
  assert.deepEqual(h.calls.map(x => x[0]), ['readImage', 'toast']);
  assert.equal(h.calls[1][1], 'read denied');
});
test('native drag-drop suppresses DOM duplicate and takes only first native path', async () => {
  const h = dropHost({ desktop: true });
  await h.drop([{ name: 'a.md', type: '', size: 1 }]); assert.deepEqual(h.calls, []);
  await h.handlers.get('native')({ type: 'over' }); assert.ok(h.overlay.has('show'));
  await h.handlers.get('native')({ type: 'drop', paths: ['C:\\a.md', 'C:\\b.md'] });
  assert.equal(h.overlay.size, 0); assert.equal(h.calls.filter(x => x[0] === 'readText').length, 1);
  assert.equal(h.calls[0][1], 'C:\\a.md');
  await h.handlers.get('native')({ type: 'leave' }); assert.equal(h.overlay.size, 0);
});
test('browser text read preserves text and rejects read error or cancellation before document commit', async () => {
  for (const outcome of ['load', 'error', 'abort']) {
    const committed = [], messages = [];
    const reader = createBrowserFileReader({
      cancelErrorMessage: '文档读取已取消',
      FileReaderClass: class { readAsText() {
        this.result = '中文\r\ntext'; this.error = new Error('read denied'); this['on' + outcome]();
      } }
    });
    const fileImport = createFileImportController({
      readBrowserText: (file, options) => reader.readText(file, options), readNativeText: async () => ''
    });
    const context = vm.createContext({
      filenameInput: { value: 'existing' }, t: key => key, window: {},
      exportDocumentUiCommandPort: { invoke() {} },
      exportDocumentControllerPort: {
        async openExternalDocument({ loadContent }) { const content = await loadContent(); committed.push(content); return { generation: 1, record: { title: 'note.md' } }; },
        isCurrentGeneration: () => true, isStaleError: () => false
      },
      exportSidebarControllerPort: { select() {} }, applyDocumentLifecycleUi: async () => true,
      recordDocumentOperationError: (_, error) => error.message, showToast: x => messages.push(x),
      exportFileImportPort: mountClassicFileImportPort({}, fileImport).api
    });
    vm.runInContext(section(exportSource, '    function getEditorNormalizedLength', '    // 切换主题'), context);
    assert.equal(await context.loadFile(null), false);
    assert.equal(await context.loadFile({ name: 'note.md', size: 1 }), outcome === 'load');
    assert.deepEqual(committed, outcome === 'load' ? ['中文\r\ntext'] : []);
    if (outcome === 'abort') assert.deepEqual(messages, ['文档读取已取消']);
    if (outcome === 'error') assert.deepEqual(messages, ['read denied']);
    const emptyInput = { files: [], value: 'old' }; context.importFile(emptyInput); assert.equal(emptyInput.value, '');
  }
});
test('picker cancellation is inert; browser picker resets for selecting the same file again', async () => {
  for (const desktop of [true, false]) {
    const calls = [], input = { value: 'old', click() { calls.push('click'); } };
    const context = vm.createContext({
      corePlatformPort: { supports: () => desktop, async call(group, operation, options) { assert.deepEqual(Array.from(options.extensions), ['md', 'markdown', 'txt']); return null; } },
      handleNativeDroppedPath: () => calls.push('open'), document: { getElementById: () => input },
      recordDocumentOperationError: (_, e) => e.message, showToast: x => calls.push(x)
    });
    vm.runInContext(section(coreSource, '    async function triggerImportFile', '    function getCurrentTimestamp'), context);
    await context.triggerImportFile(); assert.deepEqual(calls, desktop ? [] : ['click']);
    if (!desktop) assert.equal(input.value, '');
  }
});

function imageHost(confirmLargeFile = () => true) {
  const nodes = new Map(), reads = [], inserted = [], messages = [];
  class Element extends EventTarget {
    value = ''; files = []; classList = { toggle() {} }; dataset = {};
    replaceChildren() {} querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); }
    querySelectorAll() { return []; }
  }
  class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail; } }
  const root = new Element(); root.ownerDocument = {
    defaultView: { CustomEvent, FileReader: class { readAsDataURL(file) { reads.push(file); this.result = 'data:image/png;base64,AA=='; this.onload(); } } },
    createElement: () => new Element()
  };
  const view = createImageDialogView({ root, imageController: createImageImportController({ readBrowserImage: (file, options) => createBrowserFileReader({ FileReaderClass: root.ownerDocument.defaultView.FileReader }).readDataUrl(file, options) }), selection: { snapshot: () => ({ start: 1, end: 1 }) }, insertImage: (...args) => inserted.push(args), notify: x => messages.push(x), confirmLargeFile });
  view.open();
  return { root, view, reads, inserted, messages, async choose(file) { const input = root.querySelector('#image-file-input'); input.files = file ? [file] : []; input.dispatchEvent(new Event('change')); await new Promise(resolve => setImmediate(resolve)); } };
}
test('image dialog preserves 2 MiB confirmation and inclusive 5 MiB hard limit', async () => {
  for (const [size, confirmations, reads] of [[2 * MiB, 0, 1], [2 * MiB + 1, 1, 1], [5 * MiB, 1, 1], [5 * MiB + 1, 0, 0]]) {
    let asks = 0; const h = imageHost(() => { asks++; return true; });
    await h.choose({ name: 'a.png', type: 'image/png', size }); assert.equal(asks, confirmations); assert.equal(h.reads.length, reads);
    h.view.destroy();
  }
});
test('image dialog refusal, empty selection, invalid MIME and destruction do not insert', async () => {
  const h = imageHost(() => false); await h.choose(null); await h.choose({ type: 'application/pdf', size: 1 });
  await h.choose({ type: 'image/png', size: 3 * MiB }); h.view.switchTab('upload');
  assert.equal(h.view.confirm(), false); assert.equal(h.reads.length, 0); assert.deepEqual(h.inserted, []);
  h.view.destroy(); await h.choose({ type: 'image/png', size: 1 }); assert.equal(h.reads.length, 0);
});
test('image dialog MIME-only routing differs from text-first drop classification', async () => {
  const h = imageHost();
  await h.choose({ name: 'note.md', type: '', size: 1 });
  assert.equal(h.reads.length, 0);
  await h.choose({ name: 'note.md', type: 'image/png', size: 1 });
  assert.equal(h.reads.length, 1);
  assert.equal(h.view.confirm(), true);
  assert.equal(h.inserted.length, 1);
  h.view.destroy();
});
test('image URL and upload send one insertion command with the selected data', async () => {
  const h = imageHost(); h.root.querySelector('#image-url-input').value = ' https://example.test/a.png ';
  assert.equal(h.view.confirm(), true); assert.equal(h.inserted[0][0], 'https://example.test/a.png');
  h.view.open(); await h.choose({ type: 'image/svg+xml', size: 1 }); assert.equal(h.view.confirm(), true);
  assert.equal(h.inserted[1][0], 'data:image/png;base64,AA=='); h.view.destroy();
});
test('desktop web fetch uses native only; failure exposes manual HTML without public fallback', async () => {
  for (const fail of [false, true]) {
    const nodes = new Map(); const node = id => { if (!nodes.has(id)) nodes.set(id, { value: '', checked: false, classList: { toggle() {}, remove() {}, add() {} } }); return nodes.get(id); };
    node('url-input').value = 'https://example.test/article'; const calls = [];
    const context = vm.createContext({ document: { getElementById: node }, fetchedHtml: '',
      webClipperPlatformPort: { supports: () => true, async call(...args) { calls.push(args); if (fail) throw new Error('denied'); return '<p>article</p>'; } },
      t: key => key, fetch: () => { throw new Error('unexpected public fallback'); }
    });
    vm.runInContext(section(webSource, '    function setClipperHidden', '    function openUrlModal') + section(webSource, '    async function fetchWithNativeBackend', '    // 提取网页元信息'), context);
    await context.fetchUrl(); assert.equal(calls.length, 1); assert.equal(context.fetchedHtml, fail ? '' : '<p>article</p>');
    assert.equal(node('url-status').textContent, fail ? 'urlStatusFetching' : 'urlStatusLocalSuccess');
    if (fail) assert.equal(node('url-status').innerHTML, 'urlStatusLocalFailed');
  }
});

test('R13.4 browser image callbacks ignore superseded/destroyed reads and handle failure/abort', async () => {
  for (const outcome of ['replace', 'destroy', 'error', 'abort']) {
    const h = dropHost(); let reader;
    h.context.FileReader = class { constructor() { reader = this; } readAsDataURL() {} };
    const pending = h.drop([{ name: 'slow.png', type: 'image/png', size: 1 }]);
    const lateLoad = reader.onload;
    if (outcome === 'replace') await h.drop([{ name: 'new.md', type: '', size: 1 }]);
    if (outcome === 'destroy') h.controller.destroy();
    if (outcome === 'error') { reader.error = new Error('image denied'); reader.onerror(); }
    else if (outcome === 'abort') reader.onabort();
    else { reader.result = 'data:image/png;base64,AA=='; lateLoad(); }
    assert.equal(await pending, false);
    assert.equal(h.calls.some(x => x[0] === 'image'), false);
    assert.deepEqual(h.calls.filter(x => x[0] === 'toast'), outcome === 'error' ? [['toast', 'image denied']] : []);
    assert.equal(reader.onload, null); h.controller.destroy();
  }
});

test('R13.4 browser text loader rejects a stale drop before Documents receives content', async () => {
  const committed = [], messages = []; let resolve;
  const context = vm.createContext({
    filenameInput: { value: 'existing' }, t: key => key, window: {},
    exportDocumentUiCommandPort: { invoke() {} },
    exportDocumentControllerPort: {
      async openExternalDocument({ loadContent }) { committed.push(await loadContent()); },
      isStaleError: () => false
    },
    exportFileImportPort: { readBrowserFile: () => new Promise(done => { resolve = done; }) },
    recordDocumentOperationError: (_, error) => error.message, showToast: value => messages.push(value)
  });
  vm.runInContext(section(exportSource, '    function getEditorNormalizedLength', '    // 切换主题'), context);
  let current = true; const reading = context.loadFile({ name: 'a.md' }, { isCurrent: () => current });
  current = false; resolve({ content: 'late' }); assert.equal(await reading, false);
  assert.deepEqual(committed, []); assert.deepEqual(messages, []);
});

test('R13.4 native image reads cannot insert or notify after another path wins or teardown', async () => {
  for (const mode of ['replace', 'destroy']) {
    const h = dropHost({ desktop: true }); let resolve;
    h.context.eventsPlatformPort.call = () => new Promise(done => { resolve = done; });
    const reading = h.context.handleNativeDroppedPath('C:\\slow.png');
    if (mode === 'replace') await h.context.handleNativeDroppedPath('C:\\new.md'); else h.controller.destroy();
    resolve('data:image/png;base64,AA=='); assert.equal(await reading, false);
    assert.equal(h.calls.some(x => x[0] === 'image' || x[0] === 'toast'), false); h.controller.destroy();
  }
});


test('R13.4 completed native open does not register recents after a newer request wins', async () => {
  const h = dropHost({ desktop: true }); let finishOpen;
  h.context.loadDocumentFromContentLoader = async (_name, loader) => {
    await loader();
    return new Promise(resolve => { finishOpen = resolve; });
  };
  const old = h.context.handleNativeDroppedPath('C:\\old.md');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof finishOpen, 'function');
  assert.equal(await h.context.handleNativeDroppedPath('C:\\new.png'), true);
  finishOpen(true);
  assert.equal(await old, false);
  assert.equal(h.calls.some(call => call[0] === 'recent'), false);
  h.controller.destroy();
});
