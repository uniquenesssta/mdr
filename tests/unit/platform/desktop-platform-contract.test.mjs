import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDesktopPlatform } from '../../../src/platform/index.js';

function createClients(overrides = {}) {
  const calls = [];
  const clients = {
    invokeClient: { invoke: async () => {} },
    dialogClient: {
      openFile: async options => { calls.push(['openFile', options]); return '/tmp/open.md'; },
      openDirectory: async options => { calls.push(['openDirectory', options]); return '/tmp'; },
      saveFile: async (name, options) => { calls.push(['saveFile', name, options]); return '/tmp/save.md'; },
      confirm: async (message, options) => { calls.push(['confirm', message, options]); return true; }
    },
    documentStoreClient: {
      save: async request => request,
      beginSnapshotUpload: async () => {},
      appendSnapshotChunk: async () => {},
      commitSnapshotUpload: async request => request,
      abortSnapshotUpload: async () => {},
      load: async () => null,
      loadManifest: async () => null,
      readChunk: async () => null,
      search: async () => null,
      remove: async () => {}
    },
    dragDropClient: { subscribe: async handler => { calls.push(['dragDrop', handler]); return () => {}; } },
    fileSystemClient: {
      readDroppedFile: async path => { calls.push(['readDroppedFile', path]); return { kind: 'text', content: 'desktop text' }; },
      writeTextFile: async (path, content, options) => { calls.push(['writeTextFile', path, content, options]); return 'text-written'; },
      writeBinaryFile: async (path, content, options) => { calls.push(['writeBinaryFile', path, content, options]); return 'binary-written'; },
      listTextFileTree: async path => { calls.push(['listTextFileTree', path]); return { rootPath: path, nodes: [] }; },
      readLocalImage: async (source, documentPath) => { calls.push(['readLocalImage', source, documentPath]); return { dataUrl: 'data:image/png;base64,AAAA' }; },
      getInitialFilePath: async () => '/tmp/initial.md'
    },
    linkClient: { openExternal: async url => { calls.push(['openExternal', url]); return 'opened'; } },
    performanceLogClient: { writePerformance: async entries => { calls.push(['writePerformance', entries]); return 'log-path'; } },
    webFetchClient: { fetchUrl: async url => { calls.push(['fetchUrl', url]); return { html: '<p>desktop</p>' }; } },
    windowClient: {
      startDrag: async () => {}, minimize: async () => {}, toggleMaximize: async () => true,
      isMaximized: async () => true, subscribeResize: async () => () => {},
      subscribeCloseRequest: async () => () => {}, requestClose: async () => {}, forceClose: async () => {}
    }
  };
  return { clients: { ...clients, ...overrides }, calls };
}

test('Atomic Task 3.11 desktop platform adapts low-level clients to the frozen port names', async () => {
  const { clients, calls } = createClients();
  const desktop = createDesktopPlatform(clients);

  assert.equal(await desktop.files.readText('/tmp/note.md'), 'desktop text');
  assert.equal(await desktop.files.writeText('/tmp/note.md', 'hello', { extension: 'md' }), 'text-written');
  assert.equal(await desktop.files.writeBinary('/tmp/a.bin', new Uint8Array([1]), { extension: 'bin' }), 'binary-written');
  assert.deepEqual(await desktop.files.listTextTree('/tmp/note.md'), { rootPath: '/tmp/note.md', nodes: [] });
  assert.equal(await desktop.files.readImage('image.png', '/tmp/note.md'), 'data:image/png;base64,AAAA');
  assert.equal(await desktop.files.getInitialPath(), '/tmp/initial.md');
  assert.equal(await desktop.web.fetchText('https://example.com'), '<p>desktop</p>');
  assert.equal(await desktop.links.openExternal('https://example.com'), 'opened');
  assert.equal(await desktop.logs.writePerformance([{ operation: 'x' }]), 'log-path');

  assert.ok(Object.isFrozen(desktop));
  assert.ok(Object.isFrozen(desktop.files));
  assert.ok(Object.isFrozen(desktop.web));
  assert.deepEqual(calls.filter(call => call[0] === 'readDroppedFile'), [['readDroppedFile', '/tmp/note.md']]);
  assert.deepEqual(calls.filter(call => call[0] === 'readLocalImage'), [['readLocalImage', 'image.png', '/tmp/note.md']]);
});

test('desktop text and image normalization rejects malformed native DTOs instead of inventing data', async () => {
  const { clients } = createClients({
    fileSystemClient: {
      readDroppedFile: async () => ({ kind: 'image', content: null }),
      writeTextFile: async () => {},
      writeBinaryFile: async () => {},
      listTextFileTree: async () => ({}),
      readLocalImage: async () => ({ dataUrl: null }),
      getInitialFilePath: async () => null
    }
  });
  const desktop = createDesktopPlatform(clients);
  await assert.rejects(desktop.files.readText('image.png'), /did not return text content/);
  await assert.rejects(desktop.files.readImage('image.png'), /did not return a data URL/);
});

test('desktop web normalization accepts legacy string/html/content results and preserves native errors', async () => {
  const expected = new Error('native web failed');
  for (const [result, text] of [
    ['plain', 'plain'],
    [{ html: '<p>html</p>' }, '<p>html</p>'],
    [{ content: 'content' }, 'content']
  ]) {
    const { clients } = createClients({ webFetchClient: { fetchUrl: async () => result } });
    assert.equal(await createDesktopPlatform(clients).web.fetchText('x'), text);
  }
  const { clients } = createClients({ webFetchClient: { fetchUrl: async () => { throw expected; } } });
  await assert.rejects(createDesktopPlatform(clients).web.fetchText('x'), error => error === expected);
});

test('desktop platform rejects invalid injection surfaces at composition time', () => {
  assert.throws(() => createDesktopPlatform(null), /options must be an object/);
  assert.throws(() => createDesktopPlatform({ invokeClient: null }), /invokeClient must be an object/);
});

test('desktop platform remains transport composition only and imports no business or legacy runtime modules', async () => {
  const source = await readFile(new URL('../../../src/platform/desktop/desktop-platform.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /public\/app|features\/|markdownEditorNative|showToast|localStorage|document\.|window\./);
  assert.match(source, /createInvokeClient/);
  assert.match(source, /createFileSystemClient/);
  assert.match(source, /createDocumentStoreClient/);
  assert.match(source, /createWebFetchClient/);
});
