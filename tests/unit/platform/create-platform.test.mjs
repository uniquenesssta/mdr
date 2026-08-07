import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  PLATFORM_PORT_NAMES,
  PlatformCapabilityUnavailableError,
  createPlatform
} from '../../../src/platform/index.js';

class FakeFileReader {
  constructor() {
    this.result = null;
    this.error = null;
    this.onload = null;
    this.onerror = null;
    this.onabort = null;
  }
  readAsText(file) {
    this.result = `text:${file.name}`;
    this.onload?.();
  }
  readAsDataURL(file) {
    this.result = `data:${file.name}`;
    this.onload?.();
  }
}

function createBrowserRuntime() {
  const values = new Map();
  const log = [];
  const listeners = new Map();
  class Element {}
  Element.prototype.requestFullscreen = async function () {
    runtime.document.fullscreenElement = this;
    log.push('fullscreen-enter');
  };
  const body = {
    appendChild(node) { node.parentNode = body; log.push(['append', node.download]); },
    removeChild(node) { node.parentNode = null; log.push(['remove', node.download]); }
  };
  const runtime = {
    Blob,
    Element,
    FileReader: FakeFileReader,
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); },
      clear() { values.clear(); }
    },
    URL: {
      createObjectURL() { log.push('object-url-create'); return 'blob:evidence'; },
      revokeObjectURL(url) { log.push(['object-url-revoke', url]); }
    },
    navigator: {
      clipboard: {
        async writeText(value) { log.push(['clipboard', value]); }
      }
    },
    document: {
      body,
      documentElement: null,
      fullscreenEnabled: true,
      fullscreenElement: null,
      createElement(tag) {
        if (tag === 'a') {
          return {
            href: '', download: '', parentNode: null,
            click() { log.push(['download-click', this.href, this.download]); },
            remove() { if (this.parentNode) body.removeChild(this); }
          };
        }
        return { value: '', style: {}, setAttribute() {}, select() {}, setSelectionRange() {}, remove() {} };
      },
      execCommand() { return true; },
      async exitFullscreen() { runtime.document.fullscreenElement = null; log.push('fullscreen-exit'); },
      addEventListener(type, handler) { listeners.set(type, handler); },
      removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); }
    },
    async fetch(url) {
      log.push(['fetch', url]);
      return { ok: true, async text() { return `fetched:${url}`; } };
    },
    open(url, target, features) { log.push(['open', url, target, features]); return {}; },
    print() { log.push('print'); return 'printed'; },
    confirm(message) { log.push(['confirm', message]); return true; }
  };
  runtime.document.documentElement = new Element();
  return { runtime, log, listeners };
}

function createDesktopPortImplementations(log) {
  const files = {
    readText: async path => { log.push(['desktop-files-read', path]); return 'desktop'; },
    writeText: async () => {}, writeBinary: async () => {}, listTextTree: async () => ({}),
    readImage: async () => 'data:desktop', getInitialPath: async () => 'desktop.md'
  };
  const dialogs = {
    openFile: async () => 'desktop.md', openDirectory: async () => '/desktop', saveFile: async () => 'save.md',
    confirm: async () => true
  };
  const window = {
    startDrag: async () => {}, minimize: async () => {}, toggleMaximize: async () => true,
    isMaximized: async () => true, subscribeResize: async () => () => {},
    subscribeCloseRequest: async () => () => {}, requestClose: async () => {}, forceClose: async () => {}
  };
  const dragDrop = { subscribe: async () => () => {} };
  const documentStore = {
    save: async request => request, beginSnapshotUpload: async () => {}, appendSnapshotChunk: async () => {},
    commitSnapshotUpload: async request => request, abortSnapshotUpload: async () => {}, load: async () => null,
    loadManifest: async () => null, readChunk: async () => null, search: async () => null, remove: async () => {}
  };
  const web = { fetchText: async url => { log.push(['desktop-web', url]); return 'desktop-web'; } };
  const links = { openExternal: async url => { log.push(['desktop-link', url]); } };
  const logs = { writePerformance: async entries => { log.push(['desktop-log', entries]); return 'log'; } };
  return Object.freeze({ files, dialogs, window, dragDrop, documentStore, web, links, logs });
}

function assertUnavailable(callback, port, method, capability) {
  assert.throws(callback, error => {
    assert.ok(error instanceof PlatformCapabilityUnavailableError);
    assert.equal(error.code, 'PLATFORM_CAPABILITY_UNAVAILABLE');
    assert.equal(error.port, port);
    assert.equal(error.method, method);
    assert.equal(error.capability, capability);
    return true;
  });
}

test('Atomic Task 3.11 creates one immutable browser Platform with real supported adapters', async () => {
  const { runtime, log, listeners } = createBrowserRuntime();
  const platform = createPlatform({ runtime });
  runtime.Blob = null;
  runtime.confirm = null;

  assert.equal(platform.capabilities.runtime, 'browser');
  assert.ok(Object.isFrozen(platform));
  assert.ok(Object.isFrozen(platform.capabilities));
  assert.deepEqual(Object.keys(platform), ['capabilities', ...PLATFORM_PORT_NAMES, 'destroy']);

  platform.storage.set('theme', 'dark');
  assert.equal(platform.storage.get('theme'), 'dark');
  assert.equal(await platform.files.readText({ name: 'note.md' }), 'text:note.md');
  assert.equal(await platform.files.readImage({ name: 'image.png' }), 'data:image.png');
  platform.files.writeText('folder/note.md', 'hello');
  platform.files.writeBinary('folder/a.bin', new Uint8Array([1, 2]));
  assert.equal(await platform.dialogs.confirm('Continue?'), true);
  assert.equal(await platform.web.fetchText('https://example.com'), 'fetched:https://example.com');
  await platform.links.openExternal('https://example.com');
  await platform.clipboard.writeText('copied');
  assert.equal(platform.fullscreen.isEnabled(), true);
  const states = [];
  const dispose = platform.fullscreen.subscribe(active => states.push(active));
  await platform.fullscreen.enter();
  listeners.get('fullscreenchange')();
  await platform.fullscreen.exit();
  listeners.get('webkitfullscreenchange')();
  await dispose();
  assert.equal(platform.print.print(), 'printed');

  assert.deepEqual(states, [true, false]);
  assert.ok(log.some(entry => Array.isArray(entry) && entry[0] === 'download-click' && entry[2] === 'note.md'));
  assert.ok(log.some(entry => Array.isArray(entry) && entry[0] === 'download-click' && entry[2] === 'a.bin'));
  assertUnavailable(() => platform.files.listTextTree(), 'files', 'listTextTree', 'desktop.fileSystem');
  assertUnavailable(() => platform.dialogs.openFile(), 'dialogs', 'openFile', 'desktop.dialogs');
  assertUnavailable(() => platform.window.minimize(), 'window', 'minimize', 'desktop.window');
  assertUnavailable(() => platform.logs.writePerformance([]), 'logs', 'writePerformance', 'desktop.performanceLogs');
});

test('missing browser capabilities expose controlled unsupported errors instead of no-op functions', () => {
  const platform = createPlatform({ runtime: {} });
  assert.equal(platform.capabilities.runtime, 'browser');
  assert.ok(Object.values(platform.capabilities.browser).every(value => value === false));

  assertUnavailable(() => platform.storage.get('x'), 'storage', 'get', 'browser.storage');
  assertUnavailable(() => platform.files.readText({}), 'files', 'readText', 'browser.fileRead');
  assertUnavailable(() => platform.files.writeText('x.md', 'x'), 'files', 'writeText', 'browser.fileDownload');
  assertUnavailable(() => platform.dialogs.confirm('x'), 'dialogs', 'confirm', 'browser.confirm');
  assertUnavailable(() => platform.web.fetchText('x'), 'web', 'fetchText', 'browser.webFetch');
  assertUnavailable(() => platform.links.openExternal('x'), 'links', 'openExternal', 'browser.externalLinks');
  assertUnavailable(() => platform.clipboard.writeText('x'), 'clipboard', 'writeText', 'browser.clipboard');
  assertUnavailable(() => platform.fullscreen.enter(), 'fullscreen', 'enter', 'browser.fullscreen');
  assertUnavailable(() => platform.print.print(), 'print', 'print', 'browser.print');
});

test('desktop capabilities select desktop implementations while retaining browser-native ports', async () => {
  const { runtime, log } = createBrowserRuntime();
  runtime.__TAURI_INTERNALS__ = {};
  const desktopPlatform = createDesktopPortImplementations(log);
  const platform = createPlatform({ runtime, desktopPlatform });

  assert.equal(platform.capabilities.runtime, 'desktop');
  assert.equal(await platform.files.readText('native.md'), 'desktop');
  assert.equal(await platform.web.fetchText('https://desktop.example'), 'desktop-web');
  await platform.links.openExternal('https://desktop.example');
  assert.equal(platform.storage.get('missing'), null);
  await platform.clipboard.writeText('still-browser-surface');
  assert.deepEqual(log.filter(entry => Array.isArray(entry) && entry[0] === 'desktop-files-read'), [['desktop-files-read', 'native.md']]);
  assert.deepEqual(log.filter(entry => Array.isArray(entry) && entry[0] === 'desktop-web'), [['desktop-web', 'https://desktop.example']]);
});

test('desktop composition requires every selected desktop responsibility instead of silently falling back', () => {
  const { runtime, log } = createBrowserRuntime();
  runtime.__TAURI_INTERNALS__ = {};
  const desktop = { ...createDesktopPortImplementations(log) };
  delete desktop.documentStore;
  assert.throws(() => createPlatform({ runtime, desktopPlatform: desktop }), /desktop platform must provide documentStore/);
});

test('WebKit-only fullscreen is detected and composed as a real capability', () => {
  const { runtime } = createBrowserRuntime();
  delete runtime.Element.prototype.requestFullscreen;
  runtime.Element.prototype.webkitRequestFullscreen = async function () {
    runtime.document.webkitFullscreenElement = this;
  };
  runtime.document.fullscreenEnabled = false;
  runtime.document.webkitFullscreenEnabled = true;
  runtime.document.webkitFullscreenElement = null;
  delete runtime.document.exitFullscreen;
  runtime.document.webkitExitFullscreen = async () => { runtime.document.webkitFullscreenElement = null; };

  const platform = createPlatform({ runtime });
  assert.equal(platform.capabilities.browser.fullscreen, true);
  assert.equal(platform.fullscreen.isEnabled(), true);
});

test('platform destroy remains idempotent and makes every port terminal', async () => {
  const { runtime } = createBrowserRuntime();
  const platform = createPlatform({ runtime });
  const first = platform.destroy();
  assert.equal(first, platform.destroy());
  await first;
  assert.throws(() => platform.storage.get('theme'), /Platform port "storage" is destroyed/);
  assert.equal(platform.capabilities.runtime, 'browser');
});

test('createPlatform remains a composition root and does not import business or legacy runtime modules', async () => {
  const source = await readFile(new URL('../../../src/platform/create-platform.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /public\/app|features\/|src\/runtime|markdownEditorNative|showToast/);
  assert.match(source, /createPlatformPortSet/);
  assert.match(source, /createDesktopPlatform/);
  assert.match(source, /PlatformCapabilityUnavailableError/);
});

test('createPlatform rejects invalid options and invalid injected desktop composition', () => {
  assert.throws(() => createPlatform(null), /options must be an object/);
  const { runtime } = createBrowserRuntime();
  runtime.__TAURI_INTERNALS__ = {};
  assert.throws(() => createPlatform({ runtime, desktopPlatform: null }), /desktopPlatform must be an object/);
});
