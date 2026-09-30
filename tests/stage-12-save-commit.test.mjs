import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentModel } from '../src/document/document-model.js';
import { NativeDocumentStore } from '../src/storage/native-document-store.js';
import {
  createDocumentRecord, updateDocumentRecord, createDocumentSessionStore,
  createDocumentSessionController, createSessionDocumentRepository
} from '../src/features/documents/index.js';
import {
  createBrowserDocumentRepository, createLoadController, createSaveController,
  createSaveStatusStore, createCloseSaveController
} from '../src/features/persistence/index.js';

// Faults here are injected JS storage/IPC failures, not OS disk-failure evidence.
function harness({ native = false, nativeSave = null } = {}) {
  const values = new Map();
  let fault = () => false;
  let writes = 0;
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (fault(key, ++writes)) throw new Error('QUOTA_OR_DENIED'); values.set(key, value); },
    removeItem(key) { if (fault(key, ++writes)) throw new Error('QUOTA_OR_DENIED'); values.delete(key); }
  };
  const editor = { value: '原正文', virtualEditor: { getTextLength: () => editor.value.length } };
  const model = new DocumentModel(editor);
  const a = createDocumentRecord({ id: 'a', title: 'a.md', nativeBacked: native, nativeVersion: native ? 1 : 0 });
  const b = createDocumentRecord({ id: 'b', title: 'b.md' });
  const session = createDocumentSessionStore({ initialRecords: [a, b], activeId: 'a' });
  const requests = [];
  let disk = { content: editor.value, version: 1, title: 'a.md' };
  const nativeStore = new NativeDocumentStore({ available: native, documentStore: {
    async save(request) {
      requests.push(request);
      if (nativeSave) await nativeSave(request);
      let content = request.fullContent;
      if (content === null) {
        content = disk.content;
        for (const transaction of request.transactions) {
          for (const change of [...transaction.changes].reverse()) {
            content = content.slice(0, change.from) + change.insert + content.slice(change.to);
          }
        }
      }
      disk = { content, version: Math.max(disk.version + 1, request.nextVersion), title: request.title };
      return { version: disk.version };
    },
    async load() { return { ...disk }; },
    async remove() {}
  } });
  const events = [];
  nativeStore.subscribe(event => events.push(event));
  const browser = createBrowserDocumentRepository({ storage, reportError() {} });
  const repository = createSessionDocumentRepository({ browserRepository: browser, nativeStore });
  browser.rememberContent('a', editor.value);
  browser.rememberContent('b', '邻居正文');
  browser.persistSession(session.records, 'a');
  model.activate(a, { content: editor.value });
  repository.activate(model, a, native ? disk : null);
  let controller;
  const loadController = createLoadController({
    documents: session, model, editor: { getTextLength: () => model.getTextLength() }, repository,
    resolveRecord: updateDocumentRecord,
    assertGeneration(operation) { if (!controller.isCurrentGeneration(operation)) throw new Error('stale'); }
  });
  controller = createDocumentSessionController({ session, model, repository, loadController });
  const statusStore = createSaveStatusStore();
  const saver = createSaveController({ documentController: controller, model, statusStore });
  return {
    model, controller, browser, repository, session, requests, events, saver, statusStore, values,
    fail(fn) { writes = 0; fault = fn; },
    edit(content) {
      const previousLength = editor.value.length;
      editor.value = content;
      model.handleEditorChange({ changes: [{ from: 0, to: previousLength, insert: content }] });
    },
    get disk() { return disk; }
  };
}

for (const native of [false, true]) {
  for (const phase of ['quota', 'late-index', 'late-active', 'filename']) {
    test(`R12-19 ${native ? 'native' : 'browser'} ${phase} failure retains dirty body and retries`, async () => {
      const h = harness({ native });
      h.edit('不能丢失😀');
      let docWrites = 0;
      let activeWrites = 0;
      h.fail(key => {
        if (key === 'md_editor_documents') docWrites++;
        if (key === 'md_editor_current_document') activeWrites++;
        return phase === 'quota' ? key === 'md_editor_documents'
          : phase === 'late-index' ? key === 'md_editor_documents' && docWrites === 2
          : phase === 'late-active' ? key === 'md_editor_current_document' && activeWrites === 2
          : key === 'md_editor_filename';
      });
      await assert.rejects(h.saver.save(), /QUOTA_OR_DENIED/);
      assert.equal(h.model.dirty, true);
      assert.equal(h.model.createSnapshot(), '不能丢失😀');
      assert.equal(h.session.activeId, 'a');
      assert.equal(h.statusStore.snapshot.state, 'error');
      assert.equal(h.events.some(event => event.state === 'saved'), false);
      const nativeCommits = h.requests.length;
      h.fail(() => false);
      assert.equal((await h.saver.save()).saved, true);
      assert.equal(h.model.dirty, false);
      assert.equal(h.statusStore.snapshot.state, 'saved');
      if (native && nativeCommits) assert.equal(h.requests.length, nativeCommits, 'metadata retry reuses durable body version');
      if (native) assert.equal(h.disk.content, '不能丢失😀');
      else assert.equal(JSON.parse(h.values.get('md_editor_documents'))[0].content, '不能丢失😀');
    });
  }
}

for (const action of ['open', 'close', 'new']) {
  test(`R12-19 ${action} refuses save failure and retains current body`, async () => {
    const h = harness();
    h.edit('未保存');
    h.fail(key => key === 'md_editor_documents');
    const run = () => action === 'open' ? h.controller.openDocument('b')
      : action === 'close' ? h.controller.closeDocument('a') : h.controller.newDocument({ title: '新建' });
    await assert.rejects(run(), /QUOTA_OR_DENIED/);
    assert.equal(h.session.activeId, 'a');
    assert.equal(h.model.documentId, 'a');
    assert.equal(h.model.createSnapshot(), '未保存');
    assert.equal(h.model.dirty, true);
  });
}

for (const action of ['open', 'close']) {
  test(`R12-19 ${action} late selection-index failure retains active document`, async () => {
    const h = harness();
    h.edit('已经写入但不能关闭');
    let count = 0;
    h.fail(key => key === 'md_editor_documents' && ++count === 3);
    await assert.rejects(action === 'open' ? h.controller.openDocument('b') : h.controller.closeDocument('a'), /QUOTA_OR_DENIED/);
    assert.equal(h.session.activeId, 'a');
    assert.equal(h.model.documentId, 'a');
    assert.equal(h.model.createSnapshot(), '已经写入但不能关闭');
    assert.ok(h.session.getRecord('a'));
  });
}

for (const native of [false, true]) {
  test(`R12-19 ${native ? 'native' : 'browser'} edits during save cannot be acknowledged or switched away`, async () => {
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    const h = harness({ native, nativeSave: () => wait });
    h.edit('第一版');
    const saving = h.controller.openDocument('b');
    h.edit('等待时的第二版');
    release();
    await assert.rejects(saving, /DOCUMENT_CHANGED_DURING_SAVE/);
    assert.equal(h.model.dirty, true);
    assert.equal(h.model.createSnapshot(), '等待时的第二版');
    assert.equal(h.session.activeId, 'a');
    assert.equal((await h.controller.saveActive()).saved, true);
    if (native) assert.equal(h.disk.content, '等待时的第二版');
    assert.equal(h.model.dirty, false);
  });
}

test('R12-19 close-window failure is denied and retry succeeds without body loss', async () => {
  const h = harness({ native: true });
  h.edit('关闭重试正文');
  const close = createCloseSaveController({ saveController: h.saver, documentController: h.controller,
    autosaveController: { cancelPending() {} }, closeSavePort: { register() { return () => {}; } } });
  h.fail(key => key === 'md_editor_documents');
  assert.equal(await close.prepareClose(), false);
  assert.equal(h.model.dirty, true);
  assert.equal(h.model.createSnapshot(), '关闭重试正文');
  h.fail(() => false);
  assert.equal(await close.prepareClose(), true);
  close.destroy();
});

test('R12-19 ambiguous native failure forces a full snapshot on retry', async () => {
  let fail = true;
  const h = harness({ native: true, nativeSave() { if (fail) { fail = false; throw new Error('sync failure after write'); } } });
  h.edit('幂等重试');
  await assert.rejects(h.controller.saveActive(), /sync failure/);
  assert.equal(h.model.dirty, true);
  await h.controller.saveActive();
  assert.equal(h.requests[0].fullContent, null);
  assert.equal(h.requests[1].fullContent, '幂等重试');
  assert.equal(h.disk.content, '幂等重试');
});
