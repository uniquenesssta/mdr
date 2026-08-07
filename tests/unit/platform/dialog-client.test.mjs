import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDialogClient } from '../../../src/platform/index.js';

function sequenceClock(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test('Atomic Task 3.4 normalizes open-file options and records successful completion', async () => {
  const calls = [];
  const records = [];
  const client = createDialogClient({
    open: async options => {
      calls.push(options);
      return '/tmp/notes.md';
    },
    save: async () => null,
    confirm: async () => false,
    now: sequenceClock([10, 15.5]),
    record: (operation, entry) => records.push({ operation, entry })
  });

  assert.equal(await client.openFile({
    title: '选择文件',
    filterName: '文本',
    extensions: ['.md', 'txt', '']
  }), '/tmp/notes.md');
  assert.deepEqual(calls, [{
    title: '选择文件',
    multiple: false,
    directory: false,
    filters: [{ name: '文本', extensions: ['md', 'txt'] }]
  }]);
  assert.deepEqual(records, [{
    operation: 'native.open-file-dialog',
    entry: {
      category: 'native.dialog',
      durationMs: 5.5,
      status: 'ok'
    }
  }]);
  assert.ok(Object.isFrozen(client));
});

test('file and directory cancellation resolve to explicit null values instead of errors', async () => {
  const calls = [];
  const records = [];
  const client = createDialogClient({
    open: async options => {
      calls.push(options);
      return null;
    },
    save: async () => null,
    confirm: async () => false,
    now: sequenceClock([1, 3, 5, 8]),
    record: (operation, entry) => records.push({ operation, entry })
  });

  assert.equal(await client.openFile(), null);
  assert.equal(await client.openDirectory({ title: '目录', defaultPath: '  C:\\work\\  ' }), null);
  assert.deepEqual(calls[0], {
    title: '打开 Markdown',
    multiple: false,
    directory: false,
    filters: [{ name: 'Markdown 和文本文件', extensions: ['md', 'markdown', 'txt'] }]
  });
  assert.deepEqual(calls[1], {
    title: '目录',
    multiple: false,
    directory: true,
    defaultPath: 'C:\\work\\'
  });
  assert.deepEqual(records.map(record => [record.operation, record.entry.status]), [
    ['native.open-file-dialog', 'cancelled'],
    ['native.open-directory-dialog', 'cancelled']
  ]);
});

test('save-file normalization preserves filename cleaning, native path joining and extension completion', async () => {
  const calls = [];
  const selectedPaths = ['C:\\docs\\report', '/tmp/already.markdown', null];
  const records = [];
  const client = createDialogClient({
    open: async () => null,
    save: async options => {
      calls.push(options);
      return selectedPaths.shift();
    },
    confirm: async () => false,
    now: sequenceClock([10, 12, 20, 23, 30, 34]),
    record: (operation, entry) => records.push({ operation, entry })
  });

  assert.equal(await client.saveFile('bad:name', {
    title: '保存',
    filterName: 'Markdown',
    extension: '.md',
    extensions: ['.md', '.markdown'],
    defaultDirectory: 'C:\\docs\\'
  }), 'C:\\docs\\report.md');
  assert.equal(await client.saveFile('already.markdown', {
    extension: 'md',
    extensions: ['md', 'markdown'],
    defaultDirectory: '/tmp/'
  }), '/tmp/already.markdown');
  assert.equal(await client.saveFile('', { extension: 'txt' }), null);

  assert.deepEqual(calls[0], {
    title: '保存',
    defaultPath: 'C:\\docs\\bad_name.md',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
  });
  assert.deepEqual(calls[1].defaultPath, '/tmp/already.markdown');
  assert.deepEqual(calls[2], {
    title: '另存为',
    defaultPath: '未命名文档.txt',
    filters: [{ name: 'Markdown 文档', extensions: ['txt', 'markdown'] }]
  });
  assert.deepEqual(records.map(record => record.entry), [
    { category: 'native.dialog', durationMs: 2, status: 'ok', details: { extension: 'md' } },
    { category: 'native.dialog', durationMs: 3, status: 'ok', details: { extension: 'md' } },
    { category: 'native.dialog', durationMs: 4, status: 'cancelled', details: { extension: 'txt' } }
  ]);
});

test('confirmation delegates exact defaults and false remains a normal cancellation value', async () => {
  const calls = [];
  const client = createDialogClient({
    open: async () => null,
    save: async () => null,
    confirm: async (message, options) => {
      calls.push({ message, options });
      return false;
    }
  });

  assert.equal(await client.confirm('删除？'), false);
  assert.deepEqual(calls, [{
    message: '删除？',
    options: {
      title: 'Markdown Editor',
      kind: 'warning',
      okLabel: '确定',
      cancelLabel: '取消'
    }
  }]);
});

test('native dialog errors retain identity and telemetry failures cannot replace native semantics', async () => {
  const expectedError = new Error('dialog failed');
  const records = [];
  const failureClient = createDialogClient({
    open: async () => { throw expectedError; },
    save: async () => null,
    confirm: async () => false,
    now: sequenceClock([4, 9]),
    record: (operation, entry) => records.push({ operation, entry })
  });
  await assert.rejects(failureClient.openDirectory(), error => error === expectedError);
  assert.deepEqual(records, [{
    operation: 'native.open-directory-dialog',
    entry: {
      category: 'native.dialog',
      durationMs: 5,
      status: 'error',
      details: { error: 'dialog failed' }
    }
  }]);

  const successClient = createDialogClient({
    open: async () => '/tmp/ok.md',
    save: async () => null,
    confirm: async () => true,
    now: sequenceClock([1, 2]),
    record: () => { throw new Error('telemetry failed'); }
  });
  assert.equal(await successClient.openFile(), '/tmp/ok.md');

  const secondError = new Error('native save failed');
  const secondFailureClient = createDialogClient({
    open: async () => null,
    save: async () => { throw secondError; },
    confirm: async () => false,
    now: sequenceClock([2, 4]),
    record: () => { throw new Error('telemetry failed'); }
  });
  await assert.rejects(secondFailureClient.saveFile('notes'), error => error === secondError);
});

test('invalid dialog client dependencies fail at the adapter boundary', () => {
  assert.throws(() => createDialogClient(null), /options must be an object/);
  assert.throws(() => createDialogClient({ open: null }), /requires an open function/);
  assert.throws(() => createDialogClient({ open() {}, save: null }), /requires a save function/);
  assert.throws(() => createDialogClient({ open() {}, save() {}, confirm: null }), /requires a confirm function/);
  assert.throws(() => createDialogClient({ open() {}, save() {}, confirm() {}, now: null }), /now must be a function/);
  assert.throws(() => createDialogClient({ open() {}, save() {}, confirm() {}, record: {} }), /record must be a function/);
});

test('the desktop dialog client is the sole production owner of the Tauri dialog plugin import', async () => {
  const fixture = JSON.parse(await readFile(
    new URL('../../../tests/architecture/fixtures/production-modules.json', import.meta.url),
    'utf8'
  ));
  const owners = [];
  for (const [path] of fixture.modules) {
    const source = await readFile(new URL('../../../' + path, import.meta.url), 'utf8');
    if (source.includes('@tauri-apps/plugin-dialog')) owners.push(path);
  }
  assert.deepEqual(owners, ['src/platform/desktop/dialog-client.js']);

  const publicEntry = await readFile(new URL('../../../src/platform/index.js', import.meta.url), 'utf8');
  assert.match(publicEntry, /desktop\/dialog-client\.js/);
});

test('desktop platform exposes the dedicated DialogsPort and classic callers consume it through the scoped bridge', async () => {
  const desktop = await readFile(new URL('../../../src/platform/desktop/desktop-platform.js', import.meta.url), 'utf8');
  const core = await readFile(new URL('../../../public/app/core.js', import.meta.url), 'utf8');
  const exportSource = await readFile(new URL('../../../public/app/export.js', import.meta.url), 'utf8');
  assert.match(desktop, /createDialogClient\(/);
  assert.match(desktop, /dialogs: dialogClient/);
  assert.match(core, /call\('dialogs', 'openFile'/);
  assert.match(core, /call\('dialogs', 'openDirectory'/);
  assert.match(core, /call\('dialogs', 'confirm'/);
  assert.match(exportSource, /call\('dialogs', 'saveFile'/);
  assert.doesNotMatch(core + exportSource, /markdownEditorNative/);
});

test('Stage 3 verification keeps Atomic Task 3.4 after invoke and before later adapters', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/stage-03-atomic.yml', import.meta.url),
    'utf8'
  );
  const invokeIndex = workflow.indexOf('Verify Atomic Task 3.3 invoke client');
  const dialogIndex = workflow.indexOf('Verify Atomic Task 3.4 dialog client');
  const windowIndex = workflow.indexOf('Verify Atomic Task 3.5 window client');
  const dragDropIndex = workflow.indexOf('Verify Atomic Task 3.6 drag-drop client');
  const fileSystemIndex = workflow.indexOf('Verify Atomic Task 3.7 file-system client');
  const documentStoreIndex = workflow.indexOf('Verify Atomic Task 3.8 document-store client');
  const webLinkLogIndex = workflow.indexOf('Verify Atomic Task 3.9 web link log clients');
  const browserIndex = workflow.indexOf('Verify Atomic Task 3.10 browser adapters');
  const createPlatformIndex = workflow.indexOf('Verify Atomic Task 3.11 createPlatform');
  const cutoverIndex = workflow.indexOf('Verify Atomic Task 3.12 final Platform cutover');
  const architectureIndex = workflow.indexOf('Run architecture hard gate');
  assert.ok(invokeIndex >= 0 && dialogIndex > invokeIndex && windowIndex > dialogIndex && dragDropIndex > windowIndex && fileSystemIndex > dragDropIndex && documentStoreIndex > fileSystemIndex && webLinkLogIndex > documentStoreIndex && browserIndex > webLinkLogIndex && createPlatformIndex > browserIndex && cutoverIndex > createPlatformIndex && architectureIndex > cutoverIndex);
  assert.match(workflow, /node --test tests\/unit\/platform\/dialog-client\.test\.mjs/);
  assert.match(workflow, /node --test tests\/unit\/platform\/window-client\.test\.mjs/);
  assert.match(workflow, /node --test tests\/unit\/platform\/drag-drop-client\.test\.mjs/);
  assert.match(workflow, /node --test tests\/unit\/platform\/file-system-client\.test\.mjs/);
  assert.match(workflow, /node --test tests\/unit\/platform\/document-store-client\.test\.mjs/);
  assert.match(workflow, /03-12-architecture-scan\.json/);
  assert.match(workflow, /Verify Atomic Task 3\.12 final Platform cutover/);
});
