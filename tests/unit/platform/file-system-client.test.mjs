import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createFileSystemClient } from '../../../src/platform/index.js';

function createInvokeRecorder(results = new Map()) {
  const calls = [];
  const invoke = async (operation, args, details) => {
    calls.push({ operation, args, details });
    if (results.has(operation)) {
      const value = results.get(operation);
      return typeof value === 'function' ? value(operation, args, details) : value;
    }
    return Object.freeze({ operation, args, details });
  };
  return { invoke, calls };
}

test('Atomic Task 3.7 maps the six Rust local-file commands with existing argument semantics', async () => {
  const { invoke, calls } = createInvokeRecorder();
  const client = createFileSystemClient({ invoke });

  await client.readDroppedFile('F:\\Notes\\Draft.MD');
  await client.listTextFileTree('  F:\\Notes\\Draft.MD  ');
  await client.readLocalImage('  images\\cover.png  ', '  F:\\Notes\\Draft.MD  ');
  await client.getInitialFilePath();
  await client.writeTextFile('F:\\Notes\\Draft.MD', 42, { extension: 'MD', reason: 'save-current-file' });
  await client.writeBinaryFile('F:\\Notes\\cover.PNG', new Uint8Array([0, 1, 2, 255]), {
    extension: 'png',
    reason: 'export'
  });

  assert.deepEqual(calls, [
    {
      operation: 'read_dropped_file',
      args: { path: 'F:\\Notes\\Draft.MD' },
      details: { extension: 'md' }
    },
    {
      operation: 'list_text_file_tree',
      args: { documentPath: 'F:\\Notes\\Draft.MD' },
      details: { hasDocumentPath: true, extension: 'md' }
    },
    {
      operation: 'read_local_image',
      args: { source: 'images\\cover.png', documentPath: 'F:\\Notes\\Draft.MD' },
      details: { sourceLength: 16, hasDocumentPath: true }
    },
    {
      operation: 'initial_file_path',
      args: {},
      details: {}
    },
    {
      operation: 'write_local_text_file',
      args: { path: 'F:\\Notes\\Draft.MD', content: '42' },
      details: {
        extension: 'MD',
        characters: 2,
        fileName: 'Draft.MD',
        reason: 'save-current-file'
      }
    },
    {
      operation: 'write_local_binary_file',
      args: { path: 'F:\\Notes\\cover.PNG', contentBase64: 'AAEC/w==' },
      details: {
        extension: 'png',
        bytes: 4,
        fileName: 'cover.PNG',
        reason: 'export'
      }
    }
  ]);
  assert.ok(Object.isFrozen(client));
});

test('path normalization matches the legacy facade at every file-system boundary', async () => {
  const { invoke, calls } = createInvokeRecorder();
  const client = createFileSystemClient({ invoke });

  await client.readDroppedFile(undefined);
  await client.listTextFileTree('   ');
  await client.readLocalImage('   ', '   ');
  await client.writeTextFile(null, null);
  await client.writeBinaryFile(undefined, null);

  assert.deepEqual(calls[0], {
    operation: 'read_dropped_file',
    args: { path: undefined },
    details: { extension: '' }
  });
  assert.deepEqual(calls[1], {
    operation: 'list_text_file_tree',
    args: { documentPath: '' },
    details: { hasDocumentPath: false, extension: '' }
  });
  assert.deepEqual(calls[2], {
    operation: 'read_local_image',
    args: { source: '', documentPath: null },
    details: { sourceLength: 0, hasDocumentPath: false }
  });
  assert.deepEqual(calls[3], {
    operation: 'write_local_text_file',
    args: { path: '', content: '' },
    details: { extension: 'md', characters: 0, fileName: '', reason: '' }
  });
  assert.deepEqual(calls[4], {
    operation: 'write_local_binary_file',
    args: { path: '', contentBase64: '' },
    details: { extension: '', bytes: 0, fileName: '', reason: '' }
  });
});

test('Rust file DTOs and MIME-bearing results pass through without client interpretation', async () => {
  const dropped = Object.freeze({
    name: 'photo.webp',
    path: 'F:\\Notes\\photo.webp',
    kind: 'image',
    content: null,
    dataUrl: 'data:image/webp;base64,AAAA'
  });
  const image = Object.freeze({
    path: 'F:\\Notes\\photo.svg',
    dataUrl: 'data:image/svg+xml;base64,BBBB',
    bytes: 4
  });
  const tree = Object.freeze({ rootPath: 'F:\\Notes', nodes: [] });
  const results = new Map([
    ['read_dropped_file', dropped],
    ['read_local_image', image],
    ['list_text_file_tree', tree],
    ['initial_file_path', 'F:\\Notes\\draft.md']
  ]);
  const client = createFileSystemClient(createInvokeRecorder(results));

  assert.equal(await client.readDroppedFile(dropped.path), dropped);
  assert.equal(await client.readLocalImage('photo.svg', 'F:\\Notes\\draft.md'), image);
  assert.equal(await client.listTextFileTree('F:\\Notes\\draft.md'), tree);
  assert.equal(await client.getInitialFilePath(), 'F:\\Notes\\draft.md');
});

test('native file command errors retain their original identity', async () => {
  const expected = new Error('native file failure');
  const client = createFileSystemClient({
    invoke: async () => { throw expected; }
  });
  await assert.rejects(client.readDroppedFile('F:\\bad.md'), error => error === expected);
  await assert.rejects(client.writeTextFile('F:\\bad.md', 'x'), error => error === expected);
});

test('invalid client options fail at the adapter boundary', () => {
  assert.throws(() => createFileSystemClient(null), /options must be an object/);
  assert.throws(() => createFileSystemClient(), /requires an invoke function/);
  assert.throws(() => createFileSystemClient({ invoke: null }), /requires an invoke function/);
});

test('the FileSystem client contains command mapping only and does not own document or Toast behavior', async () => {
  const clientSource = await readFile(new URL('../../../src/platform/desktop/file-system-client.js', import.meta.url), 'utf8');
  const eventSource = await readFile(new URL('../../../public/app/events.js', import.meta.url), 'utf8');
  const exportSource = await readFile(new URL('../../../public/app/export.js', import.meta.url), 'utf8');
  const rustSource = await readFile(new URL('../../../src-tauri/src/local_file.rs', import.meta.url), 'utf8');

  assert.doesNotMatch(clientSource, /showToast|loadTextContentAsDocument|insertImageMarkdown|newDocument|createDocument|dropped\.kind/);
  assert.doesNotMatch(clientSource, /image\/png|image\/jpeg|image\/gif|image\/webp|image\/svg\+xml/);
  assert.match(eventSource, /dropped\.kind === 'text'/);
  assert.match(eventSource, /dropped\.kind === 'image'/);
  assert.match(eventSource, /showToast/);
  assert.match(exportSource, /showToast/);
  assert.match(rustSource, /fn image_mime/);
  assert.match(rustSource, /"webp" => Some\("image\/webp"\)/);
  assert.match(rustSource, /"svg" => Some\("image\/svg\+xml"\)/);
});

test('legacy runtime delegates all six file commands through the public FileSystem client', async () => {
  const source = await readFile(new URL('../../../src/runtime/tauri.js', import.meta.url), 'utf8');
  assert.match(source, /createFileSystemClient\(\{ invoke: invokeClient\.invoke \}\)/);
  assert.match(source, /return fileSystemClient\.readDroppedFile\(path\)/);
  assert.match(source, /return fileSystemClient\.listTextFileTree\(documentPath\)/);
  assert.match(source, /return fileSystemClient\.readLocalImage\(source, documentPath\)/);
  assert.match(source, /return fileSystemClient\.getInitialFilePath\(\)/);
  assert.match(source, /return fileSystemClient\.writeTextFile\(path, content, details\)/);
  assert.match(source, /return fileSystemClient\.writeBinaryFile\(path, content, details\)/);
  assert.doesNotMatch(source, /function bytesToBase64/);
  for (const command of [
    'read_dropped_file',
    'list_text_file_tree',
    'read_local_image',
    'initial_file_path',
    'write_local_text_file',
    'write_local_binary_file'
  ]) {
    assert.doesNotMatch(source, new RegExp(`invokeClient\\.invoke\\('${command}'`));
  }
});

test('FileSystem client is exported through the platform public entry and registered in production ownership', async () => {
  const fixture = JSON.parse(await readFile(
    new URL('../../../tests/architecture/fixtures/production-modules.json', import.meta.url),
    'utf8'
  ));
  const paths = fixture.modules.map(record => record[0]);
  assert.ok(paths.includes('src/platform/desktop/file-system-client.js'));
  const publicEntry = await readFile(new URL('../../../src/platform/index.js', import.meta.url), 'utf8');
  assert.match(publicEntry, /desktop\/file-system-client\.js/);
});

test('Stage 3 verification runs Atomic Task 3.7 after drag-drop and before later adapters', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/stage-03-atomic.yml', import.meta.url),
    'utf8'
  );
  const dragDropIndex = workflow.indexOf('Verify Atomic Task 3.6 drag-drop client');
  const fileSystemIndex = workflow.indexOf('Verify Atomic Task 3.7 file-system client');
  const documentStoreIndex = workflow.indexOf('Verify Atomic Task 3.8 document-store client');
  const webLinkLogIndex = workflow.indexOf('Verify Atomic Task 3.9 web link log clients');
  const browserIndex = workflow.indexOf('Verify Atomic Task 3.10 browser adapters');
  const createPlatformIndex = workflow.indexOf('Verify Atomic Task 3.11 createPlatform');
  const architectureIndex = workflow.indexOf('Run architecture hard gate');
  assert.ok(dragDropIndex >= 0 && fileSystemIndex > dragDropIndex && documentStoreIndex > fileSystemIndex && webLinkLogIndex > documentStoreIndex && browserIndex > webLinkLogIndex && createPlatformIndex > browserIndex && architectureIndex > createPlatformIndex);
  assert.match(workflow, /node --test tests\/unit\/platform\/file-system-client\.test\.mjs/);
  assert.match(workflow, /node --test tests\/unit\/platform\/document-store-client\.test\.mjs/);
  assert.match(workflow, /03-11-architecture-scan\.json/);
  assert.doesNotMatch(workflow, /Atomic Task 3\.12/);
});
