import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportTaskController, ExportCancelledError, isExportCancelledError, mountClassicExportTaskPort } from '../src/features/export/index.js';
import { createExportVmHost } from './support/export-vm-host.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('R14-03 owns immutable handles and snapshots, clamped progress and explicit work phases', () => {
  const c = createExportTaskController();
  const initial = c.getSnapshot();
  const task = c.begin('HTML');
  const before = c.getSnapshot();
  assert.deepEqual(initial, { activeTask: null, lastTaskId: 0, destroyed: false });
  assert.equal(task.id, 1); assert.equal(task.phase, 'preparing'); assert.equal(task.progress, 2);
  assert.ok(Object.isFrozen(task)); assert.ok(Object.isFrozen(before)); assert.ok(Object.isFrozen(before.activeTask));
  assert.throws(() => { task.cancelled = true; }, TypeError);
  assert.throws(() => { before.activeTask.progress = 99; }, TypeError);
  task.update(300, 'build', 'building'); assert.equal(task.progress, 100);
  task.update(-5, '', 'enhancing'); assert.equal(task.progress, 0); assert.equal(task.message, '正在处理…');
  task.update(NaN, 'serialize', 'serializing'); assert.equal(task.progress, 0);
  assert.throws(() => task.update(5, 'bad', 'unknown'), TypeError);
  assert.equal(before.activeTask.phase, 'preparing'); assert.equal(before.activeTask.progress, 2);
  assert.equal(c.finish(task), true); assert.equal(task.phase, 'completed');
  assert.equal(c.finish(task), false); assert.throws(() => task.token.throwIfCancelled(), ExportCancelledError);
  c.destroy();
});

test('R14-03 failed completion records a terminal failure without retaining authority', () => {
  const c = createExportTaskController(), task = c.begin('failed');
  assert.throws(() => c.finish(task, 'unknown'), TypeError);
  assert.equal(task.current, true); assert.equal(c.finish(task, 'failed'), true);
  assert.equal(task.phase, 'failed'); assert.equal(c.getSnapshot().activeTask, null); c.destroy();
});

test('R14-03 replacement invalidates every old mutation and cleanup without advancing blocked IDs', () => {
  const c = createExportTaskController(); const old = c.begin('old'), current = c.begin('current');
  assert.equal(old.cancelled, true); assert.equal(old.phase, 'replaced'); assert.equal(old.current, false);
  assert.equal(old.update(100, 'late'), false); assert.equal(old.lockCancellation('encoding'), false);
  assert.equal(c.finish(old), false); assert.equal(c.getSnapshot().activeTask.id, current.id);
  assert.throws(() => old.token.throwIfCancelled(), ExportCancelledError);
  current.lockCancellation('encoding');
  assert.equal(c.cancel(), false); assert.equal(c.begin('blocked'), null);
  assert.equal(c.getSnapshot().lastTaskId, 2); assert.equal(current.cancelled, false);
  // R14-04 removes arbitrary unlocking: finish the locked task, then cancel new preparatory work.
  c.finish(current);
  const cancellable = c.begin('cancellable'); assert.equal(c.cancel(), true); assert.equal(c.cancel(), false);
  assert.equal(cancellable.phase, 'cancelled'); assert.equal(cancellable.progress, 0);
  assert.equal(cancellable.update(100, 'late'), false); assert.equal(cancellable.lockCancellation('encoding'), false);
  c.finish(cancellable); c.destroy();
});

test('R14-03 cancellation is instance scoped and forged or foreign completion cannot release a task', () => {
  const a = createExportTaskController(), b = createExportTaskController();
  const first = a.begin('a'), second = b.begin('b'); a.cancel();
  assert.equal(second.cancelled, false); assert.equal(a.finish(second), false);
  assert.equal(b.finish({ id: second.id }), false); assert.equal(b.finish(null), false);
  assert.equal(b.getSnapshot().activeTask.id, second.id);
  assert.equal(isExportCancelledError(new ExportCancelledError()), true);
  assert.equal(isExportCancelledError(new Error('EXPORT_CANCELLED')), false);
  a.finish(first); a.destroy(); b.destroy();
});

test('R14-03 destroy invalidates locked tasks, publishes cleanup once and rejects new work/subscriptions', () => {
  const c = createExportTaskController(), snapshots = [];
  c.subscribe(s => snapshots.push(s)); const task = c.begin('png'); task.lockCancellation('encoding');
  c.destroy(); const count = snapshots.length; c.destroy();
  assert.equal(snapshots.length, count); assert.deepEqual(snapshots.at(-1), { activeTask: null, lastTaskId: 1, destroyed: true });
  assert.equal(task.phase, 'destroyed'); assert.equal(task.cancelled, true);
  assert.equal(task.update(100, 'late'), false); assert.equal(task.lockCancellation('encoding'), false); assert.equal(c.finish(task), false);
  assert.throws(() => task.token.throwIfCancelled(), ExportCancelledError);
  assert.throws(() => c.begin('late'), /destroyed/); assert.throws(() => c.subscribe(() => {}), /destroyed/);
});

test('R14-03 view opening failure rolls back authority and cleanup observers still receive null', () => {
  const c = createExportTaskController(), seen = [];
  c.subscribe(s => { if (s.activeTask) throw new Error('modal open failed'); });
  c.subscribe(s => seen.push(s));
  assert.throws(() => c.begin('failed'), /modal open failed/);
  assert.equal(c.getSnapshot().activeTask, null); assert.equal(seen.at(-1).activeTask, null);
  assert.equal(seen.some(s => s.activeTask?.id === 1), true);
  c.destroy();
});

test('R14-03 cleanup failures leave no owner and disposal releases listeners', () => {
  for (const action of ['finish', 'destroy']) {
    const c = createExportTaskController(); let shouldFail = false, received = 0;
    c.subscribe(s => { if (shouldFail && !s.activeTask) throw new Error('close failed'); });
    c.subscribe(() => received++); const task = c.begin('work'); shouldFail = true;
    assert.throws(() => action === 'finish' ? c.finish(task) : c.destroy(), /close failed/);
    assert.equal(c.getSnapshot().activeTask, null); assert.equal(task.current, false);
    if (action === 'finish') { shouldFail = false; c.destroy(); }
    const count = received; c.destroy(); assert.equal(received, count);
  }
});

test('R14-03 subscription disposal and reentrant replacement never publish an obsolete snapshot after the new one', () => {
  const c = createExportTaskController(), seen = [];
  c.subscribe(s => { if (s.activeTask?.title === 'old') c.begin('new'); });
  const unsubscribe = c.subscribe(s => seen.push(s.activeTask?.title || 'none'));
  const old = c.begin('old');
  assert.equal(old.cancelled, true); assert.deepEqual(seen, ['none', 'new']);
  unsubscribe(); unsubscribe(); c.cancel(); assert.deepEqual(seen, ['none', 'new']); c.destroy();
});

test('R14-03 scoped port owns its subscriptions only and refuses duplicate mounts and new calls after removal', () => {
  const c = createExportTaskController(), host = {}, mount = mountClassicExportTaskPort(host, c);
  assert.equal(host.markdownEditorExportTaskPort, mount.port); assert.ok(Object.isFrozen(mount.port));
  assert.throws(() => mountClassicExportTaskPort(host, c), /already mounted/);
  let seen = 0; mount.port.subscribe(() => seen++); const task = mount.port.begin('port');
  mount.destroy(); mount.destroy(); const count = seen;
  assert.equal(Object.hasOwn(host, 'markdownEditorExportTaskPort'), false);
  task.update(30, 'still owned'); assert.equal(seen, count);
  assert.throws(() => mount.port.begin('removed'), /destroyed/); assert.throws(() => mount.port.subscribe(() => {}), /destroyed/);
  assert.equal(mount.port.finish(task), false); assert.equal(c.getSnapshot().activeTask.id, task.id);
  c.destroy();
});

test('R14-03 classic modal opening errors abort before work and cleanup failures do not retain the task', async () => {
  for (const event of ['markdown-editor:modal-shell-open', 'markdown-editor:modal-shell-close']) {
    const h = createExportVmHost();
    h.context.document.getElementById('export-progress-modal').dispatchEvent = e => { if (e.type === event) e.detail.error = new Error(event); };
    await h.invoke('exportHTML');
    assert.equal(h.taskPort.getSnapshot().activeTask, null);
    if (event.endsWith('open')) assert.equal(h.calls.some(x => x[0] === 'snapshot'), false);
    assert.ok(h.calls.some(x => x[0] === 'toast' && x[1].includes(event))); h.destroy();
  }
});

test('R14-03 stale lock/progress/finish cannot change the current classic dialog', () => {
  const h = createExportVmHost(), old = h.invoke('beginExportTask', 'old'), current = h.invoke('beginExportTask', 'current');
  current.update(40, 'current', 'building'); old.lockCancellation('encoding'); old.update(99, 'stale'); h.invoke('finishExportTask', old);
  assert.equal(h.nodes.get('export-progress-cancel').disabled, false);
  assert.equal(h.nodes.get('export-progress-status').textContent, 'current');
  assert.equal(h.taskPort.getSnapshot().activeTask.id, current.id);
  h.destroy(); assert.equal(h.taskPort.getSnapshot().activeTask, null);
  assert.ok(h.calls.some(x => x[0] === 'modal' && x[2] === 'export-destroyed'));
  assert.equal(h.invoke('finishExportTask', current), false);
});

test('R14-03 image library arriving after replacement cannot clear DOM or capture an image', async () => {
  const h = createExportVmHost(), pending = deferred(), entered = deferred();
  h.context.document.getElementById('compatibility-business-ports').markdownEditorPresentationPort.loadDomToImage = () => { entered.resolve(); return pending.promise; };
  const work = h.invoke('renderExportImagePreview'); await entered.promise;
  const current = h.invoke('beginExportTask', 'new');
  h.context.document.getElementById('export-image-content').innerHTML = 'new content';
  let captures = 0; pending.resolve({ toPng: async () => { captures++; } }); await work;
  assert.equal(captures, 0); assert.equal(h.nodes.get('export-image-content').innerHTML, 'new content');
  assert.equal(h.taskPort.getSnapshot().activeTask.id, current.id); h.destroy();
});

test('R14-03 locked PNG encoding rejects replacement/cancel and a late result after destroy cannot publish', async () => {
  const h = createExportVmHost(), pending = deferred(), entered = deferred();
  h.context.document.getElementById('compatibility-business-ports').markdownEditorPresentationPort.loadDomToImage = async () => ({ toPng: () => { entered.resolve(); return pending.promise; } });
  const work = h.invoke('renderExportImagePreview'); await entered.promise;
  assert.equal(h.taskPort.getSnapshot().activeTask.phase, 'encoding');
  assert.equal(h.invoke('beginExportTask', 'blocked'), null); h.invoke('cancelActiveExport');
  assert.equal(h.taskPort.getSnapshot().activeTask.cancelled, false);
  h.destroy(); pending.resolve('data:image/png;base64,LATE'); await work;
  assert.equal(h.evaluate('currentImageDataUrl'), '');
  assert.equal(h.context.document.getElementById('export-image-preview').src, undefined);
  assert.equal(h.calls.some(x => x[0] === 'toast' && x[1] === 'toastPreviewGenerated'), false);
});

for (const operation of ['exportHTML', 'exportWord']) test(`R14-03 ${operation} late save dialog cannot write or finish a replacement task`, async () => {
  const h = createExportVmHost({ desktop: true }), pending = deferred(), entered = deferred();
  const platform = h.context.document.getElementById('compatibility-business-ports').markdownEditorPlatformPort;
  platform.call = (capability, op) => { if (op === 'saveFile') { entered.resolve(); return pending.promise; } throw new Error('Stale write must not occur'); };
  const work = h.invoke(operation); await entered.promise; const current = h.invoke('beginExportTask', 'new');
  pending.resolve('C:\\late.doc'); await work;
  assert.equal(h.downloads.length, 0); assert.equal(h.taskPort.getSnapshot().activeTask.id, current.id);
  assert.equal(h.calls.some(x => x[0] === 'toast' && /Exported/.test(x[1])), false); h.destroy();
});

test('R14-03 PDF view initialization error and failing cancellation restore both release the task', async () => {
  for (const failure of ['init', 'restore']) {
    const h = createExportVmHost(), preview = h.context.document.getElementById('compatibility-business-ports').markdownEditorPreviewCommandPort;
    if (failure === 'init') preview.setViewMode = () => { throw new Error('view failed'); };
    else { h.setFrameHook(() => h.invoke('cancelActiveExport')); preview.reset = () => { throw new Error('restore failed'); }; }
    if (failure === 'restore') await assert.rejects(h.invoke('exportPDF'), /restore failed/);
    else await h.invoke('exportPDF');
    assert.equal(h.taskPort.getSnapshot().activeTask, null); assert.equal(h.timers.length, 0); h.destroy();
  }
});
