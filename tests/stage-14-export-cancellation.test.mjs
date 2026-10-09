import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportTaskController, createExportCancellationToken, ExportCancelledError, EXPORT_NONCANCELABLE_PHASES } from '../src/features/export/index.js';
import { createExportVmHost } from './support/export-vm-host.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const cancellation = reason => error => error instanceof ExportCancelledError && error.message === 'EXPORT_CANCELLED' && error.reason === reason;

test('R14-04 token is a frozen read-only capability bound to one owner and task', () => {
  const a = createExportTaskController(), b = createExportTaskController();
  const first = a.begin('first'), other = b.begin('other');
  assert.ok(Object.isFrozen(first.token)); assert.equal(first.token.taskId, first.id);
  assert.equal(first.token.reason, null); assert.equal(first.token.cancelled, false);
  assert.equal(first.token.cancel, undefined); assert.equal(first.token.lockCancellation, undefined);
  assert.equal(first.setCancelable, undefined); assert.equal(first.throwIfCancelled, undefined);
  assert.throws(() => { first.token.cancelled = true; }, TypeError);
  a.cancel(); assert.throws(() => first.token.throwIfCancelled(), cancellation('cancelled'));
  assert.equal(other.token.cancelled, false); a.finish(first); a.destroy(); b.destroy();
});

for (const reason of ['cancelled', 'replaced', 'completed', 'failed', 'destroyed']) test(`R14-04 ${reason} invalidates token wait and notifies once`, async () => {
  const c = createExportTaskController(), task = c.begin('waiting'), pending = deferred(), reasons = [];
  task.token.onCancel(value => reasons.push(value));
  const wait = task.token.waitFor(pending.promise), rejection = assert.rejects(wait, cancellation(reason));
  if (reason === 'cancelled') c.cancel();
  else if (reason === 'replaced') c.begin('new');
  else if (reason === 'destroyed') c.destroy();
  else c.finish(task, reason);
  await rejection;
  assert.equal(task.token.cancelled, true); assert.equal(task.token.reason, reason);
  assert.deepEqual(reasons, [reason]);
  pending.reject(new Error('late failure')); await Promise.resolve();
  assert.deepEqual(reasons, [reason]); c.destroy();
});

test('R14-04 late token subscriptions work after destroy and explicit disposal prevents callbacks', () => {
  const c = createExportTaskController(), task = c.begin('task'), reasons = [];
  const dispose = task.token.onCancel(reason => reasons.push(reason)); dispose(); dispose();
  c.destroy(); assert.deepEqual(reasons, []);
  const late = task.token.onCancel(reason => reasons.push(reason)); late();
  assert.deepEqual(reasons, ['destroyed']);
});

test('R14-04 a failing cancellation observer does not stop other waits or retain subscriptions', async () => {
  const c = createExportTaskController(), task = c.begin('task'), pending = deferred();
  task.token.onCancel(() => { throw new Error('observer failed'); });
  const rejected = assert.rejects(task.token.waitFor(pending.promise), cancellation('cancelled'));
  assert.throws(() => c.cancel(), /observer failed/); await rejected;
  assert.equal(c.getSnapshot().activeTask.cancelled, true); c.finish(task); c.destroy();
  pending.resolve('late'); await Promise.resolve();
});

test('R14-04 resolved and failed operations preserve values/errors and release their owner subscriptions', async () => {
  let invalid = false; const listeners = new Set();
  const token = createExportCancellationToken({ taskId: 3, readState: () => ({ cancelled: invalid, reason: invalid ? 'cancelled' : null }),
    subscribe(listener) { listeners.add(listener); listener(); return () => listeners.delete(listener); } });
  const result = { value: 'same object' }; assert.equal(await token.waitFor(Promise.resolve(result)), result);
  assert.equal(listeners.size, 0);
  const failure = new Error('load failed'); await assert.rejects(token.waitFor(Promise.reject(failure)), error => error === failure);
  assert.equal(listeners.size, 0); invalid = true;
  await assert.rejects(token.waitFor(Promise.reject(new Error('already late'))), cancellation('cancelled'));
  assert.equal(listeners.size, 0);
});

test('R14-04 invalid identity/readers/listeners and unknown lock phases fail before mutation', () => {
  for (const options of [{}, { taskId: 0 }, { taskId: 1 }, { taskId: 1, readState() {} }]) assert.throws(() => createExportCancellationToken(options), TypeError);
  const c = createExportTaskController(), task = c.begin('task');
  assert.throws(() => task.token.onCancel(null), TypeError);
  assert.throws(() => task.lockCancellation('building'), TypeError);
  assert.equal(task.cancelable, true); assert.equal(task.phase, 'preparing'); c.destroy();
});

for (const phase of EXPORT_NONCANCELABLE_PHASES) test(`R14-04 ${phase} lock is explicit, irreversible and idempotent`, async () => {
  const c = createExportTaskController(), task = c.begin('task'), pending = deferred();
  assert.equal(task.lockCancellation(phase), true); assert.equal(task.lockCancellation(phase), true);
  const wait = task.token.waitFor(pending.promise);
  assert.equal(c.cancel(), false); assert.equal(c.begin('blocked'), null);
  assert.equal(c.getSnapshot().lastTaskId, 1); assert.equal(task.token.cancelled, false);
  assert.throws(() => task.update(30, 'unlock via phase', 'building'), /Locked/);
  assert.throws(() => task.lockCancellation(phase === 'writing' ? 'encoding' : 'writing'), /Locked/);
  pending.resolve('committed'); assert.equal(await wait, 'committed');
  c.finish(task); const next = c.begin('next'); assert.equal(next.cancelable, true); c.destroy();
});

test('R14-04 pending frame cancellation releases export without resolving the frame or taking a snapshot', async () => {
  const h = createExportVmHost(), frames = [];
  h.context.requestAnimationFrame = callback => { frames.push(callback); };
  const work = h.invoke('exportHTML'); assert.equal(frames.length, 1);
  h.cancel(); await work;
  assert.equal(h.taskPort.getSnapshot().activeTask, null);
  frames[0](); await Promise.resolve();
  assert.equal(h.calls.some(x => ['snapshot', 'parse', 'saveFile'].includes(x[0])), false);
  assert.equal(h.downloads.length, 0); h.destroy();
});

test('R14-04 image library cancellation releases progress and consumes a late module rejection', async () => {
  const h = createExportVmHost(), pending = deferred(), entered = deferred();
  h.context.document.getElementById('compatibility-business-ports').markdownEditorPresentationPort.loadDomToImage = () => { entered.resolve(); return pending.promise; };
  const work = h.invoke('renderExportImagePreview'); await entered.promise;
  h.cancel(); await work;
  assert.equal(h.taskPort.getSnapshot().activeTask, null);
  pending.reject(new Error('late module failure')); await Promise.resolve();
  assert.equal(h.calls.some(x => x[0] === 'png' || x[0] === 'error'), false); h.destroy();
});

test('R14-04 remote image cancellation detaches callbacks and late success cannot rewrite the image', async () => {
  const h = createExportVmHost(), task = h.invoke('beginExportTask', 'images'), loaders = [];
  h.context.Image = class { constructor() { loaders.push(this); } };
  const image = { src: 'https://image.test/a.png' }, root = { querySelectorAll: () => [image] };
  const work = h.invoke('prepareExportImages', root, task), loaded = loaders[0].onload;
  const rejected = assert.rejects(work, cancellation('cancelled')); h.cancel(); await rejected;
  assert.equal(loaders[0].onload, null); assert.equal(loaders[0].onerror, null);
  loaded(); await Promise.resolve();
  assert.equal(image.src, 'https://image.test/a.png'); assert.equal(image.crossOrigin, undefined);
  h.invoke('finishExportTask', task); h.destroy();
});

test('R14-04 remote image failure preserves placeholder fallback and releases event handlers', async () => {
  const h = createExportVmHost(), task = h.invoke('beginExportTask', 'images'), loaders = [];
  h.context.Image = class { constructor() { loaders.push(this); } };
  const image = { src: 'https://image.test/a.png' }, root = { querySelectorAll: () => [image] };
  const work = h.invoke('prepareExportImages', root, task); loaders[0].onerror(); await work;
  assert.equal(image.src, h.evaluate('IMAGE_PLACEHOLDER'));
  assert.equal(loaders[0].onload, null); assert.equal(loaders[0].onerror, null);
  h.invoke('finishExportTask', task); h.destroy();
});

test('R14-04 enhancement cancellation prevents later math nodes and releases a pending Mermaid wait', async () => {
  {
    const h = createExportVmHost(), task = h.invoke('beginExportTask', 'math'), math = h.context.document.getElementById('compatibility-business-ports').markdownEditorPresentationPort.math;
    let rendered = 0; math.containsMath = () => true;
    math.renderTree = () => { rendered++; h.cancel(); };
    await assert.rejects(h.invoke('enhanceFullPreviewForExport', { children: [{ textContent: '$x$' }, { textContent: '$y$' }] }, task), cancellation('cancelled'));
    assert.equal(rendered, 1); h.invoke('finishExportTask', task); h.destroy();
  }
  {
    const h = createExportVmHost(), task = h.invoke('beginExportTask', 'mermaid'), pending = deferred(); let predicate;
    h.context.renderMermaidBlocks = (nodes, isCancelled) => { predicate = isCancelled; return pending.promise; };
    const work = h.invoke('enhanceFullPreviewForExport', { children: [{ querySelector: () => ({}) }] }, task);
    const rejected = assert.rejects(work, cancellation('cancelled')); h.cancel(); await rejected;
    assert.equal(predicate(), true); pending.resolve(); h.invoke('finishExportTask', task); h.destroy();
  }
});

for (const operation of ['exportHTML', 'exportWord']) test(`R14-04 ${operation} cancels a pending dialog and locks actual write submission`, async () => {
  // Preparation can end immediately while the underlying dialog is still pending.
  {
    const h = createExportVmHost({ desktop: true }), pending = deferred(), entered = deferred(); let writes = 0;
    h.context.document.getElementById('compatibility-business-ports').markdownEditorPlatformPort.call = (capability, op) => {
      if (op === 'saveFile') { entered.resolve(); return pending.promise; } writes++;
    };
    const work = h.invoke(operation); await entered.promise; h.cancel(); await work;
    assert.equal(h.taskPort.getSnapshot().activeTask, null); pending.resolve('C:\\late.doc'); await Promise.resolve();
    assert.equal(writes, 0); assert.equal(h.downloads.length, 0); h.destroy();
  }
  // After the commit boundary, cancellation/replacement must not pretend the write was aborted.
  {
    const h = createExportVmHost({ desktop: true }), pending = deferred(), entered = deferred(); let writes = 0;
    h.context.document.getElementById('compatibility-business-ports').markdownEditorPlatformPort.call = (capability, op) => {
      if (op === 'saveFile') return 'C:\\committed.doc'; writes++; entered.resolve(); return pending.promise;
    };
    const work = h.invoke(operation); await entered.promise;
    const before = h.taskPort.getSnapshot(); assert.equal(before.activeTask.phase, 'writing'); assert.equal(before.activeTask.cancelable, false);
    assert.equal(h.nodes.get('export-progress-cancel').disabled, true);
    h.cancel(); assert.equal(h.invoke('beginExportTask', 'blocked'), null);
    assert.equal(h.taskPort.getSnapshot().activeTask.cancelled, false); assert.equal(h.taskPort.getSnapshot().lastTaskId, before.lastTaskId);
    pending.resolve(); await work; assert.equal(writes, 1); assert.equal(h.taskPort.getSnapshot().activeTask, null); h.destroy();
  }
});

test('R14-04 destruction during lock notification prevents native write submission', async () => {
  const h = createExportVmHost({ desktop: true });
  h.taskController.subscribe(s => { if (s.activeTask?.phase === 'writing') h.destroy(); });
  await h.invoke('exportHTML');
  assert.equal(h.calls.some(x => x[0] === 'writeText'), false); assert.equal(h.taskPort.getSnapshot().destroyed, true);
});

test('R14-04 PNG encoding rejection releases the lock and a subsequent task can start', async () => {
  const h = createExportVmHost();
  h.context.document.getElementById('compatibility-business-ports').markdownEditorPresentationPort.loadDomToImage = async () => ({ toPng: async () => { throw new Error('encoding failed'); } });
  await h.invoke('renderExportImagePreview'); assert.equal(h.taskPort.getSnapshot().activeTask, null);
  assert.equal(h.evaluate('currentImageDataUrl'), '');
  const next = h.invoke('beginExportTask', 'next'); assert.equal(next.cancelable, true); assert.equal(h.nodes.get('export-progress-cancel').disabled, false); h.destroy();
});
