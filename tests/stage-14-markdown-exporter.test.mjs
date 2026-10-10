import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createExportRequest, createExportTaskController, createMarkdownExporter, mountClassicMarkdownExportPort, isExportCancelledError } from '../src/features/export/index.js';
import { createBrowserFileDownload } from '../src/platform/index.js';
import { createExportVmHost } from './support/export-vm-host.mjs';

const requests = JSON.parse(readFileSync(new URL('./fixtures/stage-14-export/requests.json', import.meta.url), 'utf8'));
const source = '\uFEFF# 中文 😀\r\n\r\n$x^2$  \n```mermaid\nflowchart TD\n A-->B\n```\n<script>raw</script>\n';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const cancelled = reason => error => isExportCancelledError(error) && error.reason === reason;

function setup({ desktop = true, content = source, savePath = 'C:\\exports\\chosen.md' } = {}) {
  const calls = [], tasks = createExportTaskController();
  const state = { generation: 1, activeId: 'active', version: 7, content, removed: false };
  const documents = {
    get generation() { return state.generation; }, get activeId() { return state.activeId; },
    getRecord: id => !state.removed && ['active', 'other'].includes(id) ? { id, title: id+'.txt' } : null,
    isCurrentGeneration: generation => state.generation === generation,
    async readDocumentContent(id) { calls.push(['read', id]); return { generation: state.generation, content: 'inactive\r\n😀\n' }; }
  };
  const model = {
    getDocumentVersion: () => state.version,
    createSnapshot(reason) { calls.push(['snapshot', reason]); return state.content; }
  };
  const platform = {
    capabilities: { desktop: { dialogs: desktop, fileSystem: desktop }, browser: { fileDownload: !desktop } },
    dialogs: { async saveFile(name, options) { calls.push(['save', name, options]); return savePath; } },
    files: { async writeText(path, body, options) { calls.push(['write', path, body, options]); } }
  };
  const owner = createMarkdownExporter({ documentModel: model, documents, taskController: tasks, platform });
  const request = input => createExportRequest({ format: 'markdown', documentId: 'active', name: 'report.txt', directory: 'C:\\custom', ...input });
  return { owner, tasks, state, calls, documents, model, platform, request };
}

for (const desktop of [true, false]) {
  for (const body of ['', source, 'line 😀\r\n'.repeat(50000)]) {
    test(`R14-09 ${desktop ? 'native' : 'browser'} preserves empty/BOM/CRLF/large raw content (${body.length})`, async () => {
      const h = setup({ desktop, content: body });
      const result = await h.owner.export({ request: h.request() });
      const write = h.calls.find(x => x[0] === 'write');
      assert.equal(write[2], body); assert.equal(result.status, desktop ? 'written' : 'downloaded');
      assert.deepEqual(h.calls.filter(x => x[0] === 'snapshot'), [['snapshot', 'export-markdown']]);
      assert.deepEqual(write[3], desktop ? { extension: 'md', reason: 'export' }
        : { extension: 'md', reason: 'export', mimeType: 'text/markdown;charset=utf-8' });
      assert.equal(h.tasks.getSnapshot().activeTask, null);
      h.owner.destroy(); h.tasks.destroy();
    });
  }
}

test('R14-09 all original normalized filenames retain filters and the detached custom directory', async () => {
  const h = setup();
  for (const row of requests.names) {
    const input = { format: 'markdown', documentId: 'active', name: row.input, directory: 'C:\\custom' };
    const operation = h.owner.export({ request: input }); input.name = 'late.md'; input.directory = 'C:\\late';
    await operation;
    assert.deepEqual(h.calls.findLast(x => x[0] === 'save').slice(1), [row.markdown,
      { title: '导出 Markdown', extension: 'md', extensions: ['md', 'markdown'], filterName: 'Markdown 文档', defaultDirectory: 'C:\\custom' }]);
  }
  h.owner.destroy(); h.tasks.destroy();
});

test('R14-09 invalid metadata, format, identity and reason reject before task or content effects', async () => {
  const h = setup();
  for (const request of [null, {}, h.request({ format: 'html' }), { ...h.request(), name: 'bad\0.md' }, h.request({ documentId: 'missing' })]) {
    await assert.rejects(h.owner.export({ request }));
    assert.equal(h.tasks.getSnapshot().lastTaskId, 0); assert.deepEqual(h.calls, []);
  }
  await assert.rejects(h.owner.export({ request: h.request(), snapshotReason: 'render' }), /reason/);
  assert.equal(h.tasks.getSnapshot().lastTaskId, 0);
});

test('R14-09 selected inactive document uses public Documents without snapshotting or activating the editor', async () => {
  const h = setup();
  await h.owner.export({ request: h.request({ documentId: 'other', name: 'selected.txt' }), snapshotReason: 'context-export' });
  assert.deepEqual(h.calls.filter(x => x[0] === 'snapshot'), []);
  assert.deepEqual(h.calls[0], ['read', 'other']); assert.equal(h.calls.find(x => x[0] === 'write')[2], 'inactive\r\n😀\n');
  assert.equal(h.state.activeId, 'active');
});

test('R14-09 active context exports preserve the established context snapshot reason', async () => {
  const h = setup(); await h.owner.export({ request: h.request(), snapshotReason: 'context-export' });
  assert.deepEqual(h.calls[0], ['snapshot', 'context-export']);
});

for (const phase of ['read', 'save']) {
  for (const action of ['cancel', 'replace', 'destroy']) {
    test(`R14-09 ${action} during ${phase} rejects promptly and consumes a late failure without writing`, async () => {
      const h = setup(), gate = deferred(), reached = deferred();
      if (phase === 'read') h.documents.readDocumentContent = () => { reached.resolve(); return gate.promise; };
      else h.platform.dialogs.saveFile = () => { reached.resolve(); return gate.promise; };
      const operation = h.owner.export({ request: h.request({ documentId: phase === 'read' ? 'other' : 'active' }) });
      await reached.promise;
      let replacement;
      if (action === 'cancel') h.tasks.cancel();
      if (action === 'replace') replacement = h.tasks.begin('new task');
      if (action === 'destroy') h.owner.destroy();
      await assert.rejects(operation, cancelled(action === 'cancel' ? 'cancelled' : action === 'replace' ? 'replaced' : 'destroyed'));
      assert.equal(h.calls.some(x => x[0] === 'write'), false);
      assert.equal(h.tasks.getSnapshot().activeTask?.id ?? null, replacement?.id ?? null);
      gate.reject(new Error('late failure')); await Promise.resolve();
      if (replacement) h.tasks.finish(replacement);
      h.owner.destroy(); h.tasks.destroy();
    });
  }
}

for (const mutation of ['generation', 'activeId', 'version', 'removed']) {
  test(`R14-09 ${mutation} change while save dialog waits blocks the irreversible write`, async () => {
    const h = setup(), gate = deferred(), reached = deferred();
    h.platform.dialogs.saveFile = () => { reached.resolve(); return gate.promise; };
    const operation = h.owner.export({ request: h.request() }); await reached.promise;
    h.state[mutation] = mutation === 'removed' ? true : mutation === 'activeId' ? 'other' : 99;
    gate.resolve('C:\\chosen.md');
    await assert.rejects(operation, cancelled('document-changed'));
    assert.equal(h.calls.some(x => x[0] === 'write'), false); assert.equal(h.tasks.getSnapshot().activeTask, null);
  });
}

test('R14-09 inactive read rejects a mismatched returned generation before opening a dialog', async () => {
  const h = setup(); h.documents.readDocumentContent = async () => ({ generation: 9, content: 'late' });
  await assert.rejects(h.owner.export({ request: h.request({ documentId: 'other' }) }), cancelled('document-changed'));
  assert.equal(h.calls.some(x => x[0] === 'save' || x[0] === 'write'), false);
});

test('R14-09 cancelled picker never writes and rejects invalid picker values without a download fallback', async () => {
  for (const path of [null, '', false, 17]) {
    const h = setup({ savePath: path });
    if (path === null || path === '') assert.equal((await h.owner.export({ request: h.request() })).status, 'cancelled');
    else await assert.rejects(h.owner.export({ request: h.request() }), /保存路径/);
    assert.equal(h.calls.some(x => x[0] === 'write'), false); assert.equal(h.tasks.getSnapshot().activeTask, null);
  }
});

test('R14-09 native write locks cancellation and competing tasks until the accepted writer completes', async () => {
  const h = setup(), gate = deferred(), reached = deferred();
  h.platform.files.writeText = (...args) => { h.calls.push(['write', ...args]); reached.resolve(); return gate.promise; };
  const operation = h.owner.export({ request: h.request() }); await reached.promise;
  assert.equal(h.tasks.cancel(), false); assert.equal(h.tasks.begin('competing'), null);
  assert.equal((await h.owner.export({ request: h.request() })).status, 'busy');
  assert.equal(h.calls.filter(x => x[0] === 'write').length, 1);
  gate.resolve(); assert.equal((await operation).status, 'written'); assert.equal(h.tasks.getSnapshot().activeTask, null);
});

test('R14-09 destroying an in-flight write suppresses late completion without issuing another write', async () => {
  const h = setup(), gate = deferred(), reached = deferred();
  h.platform.files.writeText = () => { reached.resolve(); return gate.promise; };
  const operation = h.owner.export({ request: h.request() }); await reached.promise;
  h.owner.destroy(); h.owner.destroy(); await assert.rejects(operation, cancelled('destroyed'));
  assert.equal(h.tasks.getSnapshot().activeTask, null);
  gate.resolve(); await Promise.resolve();
  await assert.rejects(h.owner.export({ request: h.request() }), cancelled('destroyed'));
});

test('R14-09 source/read/dialog/write errors preserve identity and always release their task', async () => {
  for (const phase of ['snapshot', 'read', 'dialog', 'write']) {
    const h = setup(), error = new Error(phase+' failed');
    if (phase === 'snapshot') h.model.createSnapshot = () => { throw error; };
    if (phase === 'read') h.documents.readDocumentContent = async () => { throw error; };
    if (phase === 'dialog') h.platform.dialogs.saveFile = async () => { throw error; };
    if (phase === 'write') h.platform.files.writeText = async () => { throw error; };
    await assert.rejects(h.owner.export({ request: h.request({ documentId: phase === 'read' ? 'other' : 'active' }) }), e => e === error);
    assert.equal(h.tasks.getSnapshot().activeTask, null);
  }
});

test('R14-09 rejects non-text snapshots and partial native capabilities without writing', async () => {
  for (const mode of ['content', 'dialogs', 'files', 'browser']) {
    const h = setup({ desktop: mode !== 'browser', content: mode === 'content' ? null : source });
    if (mode === 'dialogs') h.platform.capabilities.desktop.dialogs = false;
    if (mode === 'files') h.platform.capabilities.desktop.fileSystem = false;
    if (mode === 'browser') h.platform.capabilities.browser.fileDownload = false;
    await assert.rejects(h.owner.export({ request: h.request() }));
    assert.equal(h.calls.some(x => x[0] === 'write'), false); assert.equal(h.tasks.getSnapshot().activeTask, null);
  }
});

test('R14-09 snapshot and irreversible-lock reentrancy cannot publish stale content', async () => {
  for (const phase of ['snapshot', 'lock']) {
    const h = setup();
    if (phase === 'snapshot') h.model.createSnapshot = () => { h.state.version++; return source; };
    const dispose = h.tasks.subscribe(s => { if (phase === 'lock' && s.activeTask?.phase === 'writing') h.state.generation++; });
    await assert.rejects(h.owner.export({ request: h.request() }), cancelled('document-changed'));
    assert.equal(h.calls.some(x => x[0] === 'write'), false); assert.equal(h.tasks.getSnapshot().activeTask, null); dispose();
  }
});

test('R14-09 browser click failures use the existing adapter to remove the anchor and revoke the URL', async () => {
  const h = setup({ desktop: false }), calls = [], body = { appendChild(a) { a.parentNode = this; }, removeChild(a) { a.parentNode = null; calls.push('remove'); } };
  const browser = createBrowserFileDownload({ documentObject: { body, createElement: () => ({ click() { throw new Error('click denied'); } }) },
    urlApi: { createObjectURL: () => 'blob:raw', revokeObjectURL: url => calls.push(url) } });
  h.platform.files.writeText = (name, text, options) => browser.downloadBlob(new Blob([text], { type: options.mimeType }), name);
  await assert.rejects(h.owner.export({ request: h.request() }), /click denied/);
  assert.deepEqual(calls, ['remove', 'blob:raw']); assert.equal(h.tasks.getSnapshot().activeTask, null);
});

test('R14-09 bridge owns only its scoped mount and rejects late calls without destroying the exporter', async () => {
  const h = setup(), host = {}, mount = mountClassicMarkdownExportPort(host, h.owner);
  assert.equal(Object.isFrozen(mount.port), true); assert.deepEqual(Object.keys(host), []);
  assert.throws(() => mountClassicMarkdownExportPort(host, h.owner), /already/);
  const replacement = {}; Object.defineProperty(host, 'markdownEditorMarkdownExportPort', { value: replacement, configurable: true });
  mount.destroy(); mount.destroy(); assert.equal(host.markdownEditorMarkdownExportPort, replacement);
  assert.throws(() => mount.port.export({ request: h.request() }), /destroyed/);
  assert.equal((await h.owner.export({ request: h.request() })).status, 'written');
});

test('R14-09 actual classic active/context calls use one raw owner without parser, builder or editor fallback', async () => {
  const h = createExportVmHost({ sourceText: source });
  try {
    h.context.editor.value = 'stale visual text';
    await h.invoke('exportFile'); await h.invoke('exportContextDocument');
    assert.equal(h.downloads.length, 2);
    for (const item of h.downloads) assert.deepEqual(new Uint8Array(await item.blob.arrayBuffer()), new TextEncoder().encode(source));
    assert.deepEqual(h.calls.filter(x => x[0] === 'snapshot'), [['snapshot', 'export-markdown'], ['snapshot', 'context-export']]);
    assert.equal(h.calls.some(x => ['parse', 'math', 'mermaid', 'block', 'png'].includes(x[0])), false);
    assert.equal(h.frameCount, 0); assert.equal(h.taskController.getSnapshot().activeTask, null);
  } finally { h.destroy(); }
});
