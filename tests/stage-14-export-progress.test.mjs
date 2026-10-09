import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createExportTaskController, createExportProgressStore, createExportProgressDialogView } from '../src/features/export/index.js';
import { ModalShell } from '../src/ui/components/modal-shell.js';
import { ExportProgressDocument } from './support/export-progress-dom.mjs';
import { createExportVmHost } from './support/export-vm-host.mjs';

function host(options = {}) {
  const controller = createExportTaskController(), store = createExportProgressStore(controller);
  const document = new ExportProgressDocument();
  const source = document.createElement('button'); document.body.append(source); source.focus();
  const view = createExportProgressDialogView({ overlayRoot: document.body, store, onCancel: () => controller.cancel(), ...options });
  return { controller, store, document, source, view, node: id => document.getElementById('export-progress-' + id),
    destroy() { try { controller.destroy(); } finally { view.destroy(); store.destroy(); } } };
}

test('R14-05 progress projection is frozen, readonly and cleared when no task exists', () => {
  const c = createExportTaskController(), store = createExportProgressStore(c);
  assert.deepEqual(store.getSnapshot(), { visible:false,taskId:null,title:'正在准备导出',progress:0,message:'',cancelEnabled:false,cancelLabel:'取消导出',closeReason:'export-finished',destroyed:false });
  const task = c.begin('<b>标题</b>'); task.update(175, '<script>消息</script>', 'building');
  const state = store.getSnapshot(); assert.equal(Object.isFrozen(state), true);
  assert.equal(state.progress, 100); assert.equal(state.taskId, task.id); assert.equal(state.message, '<script>消息</script>');
  for (const command of ['begin','cancel','finish','update']) assert.equal(command in store, false);
  c.finish(task); assert.equal(store.getSnapshot().progress, 0); assert.equal(store.getSnapshot().message, '');
  store.destroy(); c.destroy();
});

test('R14-05 read model derives cancel and irreversible lock buttons from the same authority', () => {
  const c = createExportTaskController(), store = createExportProgressStore(c);
  const cancelled = c.begin('cancel'); c.cancel();
  assert.equal(store.getSnapshot().visible, true); assert.equal(store.getSnapshot().cancelEnabled, false);
  assert.equal(store.getSnapshot().cancelLabel, '正在取消…'); c.finish(cancelled);
  for (const phase of ['writing','encoding','printing']) {
    const task = c.begin(phase); task.lockCancellation(phase);
    assert.equal(store.getSnapshot().cancelEnabled, false); assert.equal(store.getSnapshot().cancelLabel, '正在生成文件…');
    assert.equal(c.cancel(), false); c.finish(task);
  }
  store.destroy(); c.destroy();
});

test('R14-05 replacement and reentrant finish cannot publish an obsolete progress snapshot', () => {
  const c = createExportTaskController(), store = createExportProgressStore(c), seen = [];
  c.subscribe(s => { if (s.activeTask?.title === 'finish now') c.cancel(); });
  store.subscribe(s => seen.push(s));
  const old = c.begin('old'), current = c.begin('finish now');
  assert.equal(seen.at(-1).cancelLabel, '正在取消…');
  assert.equal(seen.some(s => s.taskId === current.id && s.cancelEnabled), false);
  assert.equal(old.update(99, 'stale'), false); assert.equal(c.finish(old), false);
  assert.equal(store.getSnapshot().taskId, current.id); c.finish(current); store.destroy(); c.destroy();
});

test('R14-05 subscriptions immediately project, release idempotently and reject bad listeners', () => {
  const c = createExportTaskController(), store = createExportProgressStore(c), seen = [];
  assert.throws(() => createExportProgressStore({}), /snapshot/);
  assert.throws(() => store.subscribe(null), /listener/);
  const off = store.subscribe(s => seen.push(s)); assert.equal(seen.length, 1);
  off(); off(); c.begin('unobserved'); assert.equal(seen.length, 1);
  store.destroy(); assert.throws(() => store.subscribe(() => {}), /destroyed/); c.destroy();
});

test('R14-05 store disposal during initial subscription releases the returned upstream listener', () => {
  let subscribed = 0, released = 0;
  const source = { getSnapshot: () => ({ activeTask:null,destroyed:false }), subscribe(listener) { subscribed++; listener(this.getSnapshot()); return () => released++; } };
  const store = createExportProgressStore(source);
  store.subscribe(snapshot => { if (!snapshot.destroyed) store.destroy(); });
  store.destroy(); assert.equal(subscribed, 1); assert.equal(released, 1);
});

test('R14-05 disposing only the read model leaves the task owner intact and clears every observer', () => {
  const c = createExportTaskController(), store = createExportProgressStore(c), seen = [];
  const task = c.begin('still owned'); store.subscribe(s => seen.push(s));
  store.destroy(); store.destroy(); assert.equal(c.getSnapshot().activeTask.id, task.id);
  assert.equal(seen.at(-1).destroyed, true); assert.equal(seen.at(-1).visible, false);
  const count = seen.length; task.update(40, 'no view'); assert.equal(seen.length, count); c.destroy();
});

test('R14-05 observer errors do not stop disposal of other subscriptions', () => {
  const c = createExportTaskController(), store = createExportProgressStore(c), seen = [];
  store.subscribe(s => { if (s.destroyed) throw new Error('observer'); });
  store.subscribe(s => seen.push(s)); assert.throws(() => store.destroy(), /cleanly/);
  assert.equal(seen.at(-1).destroyed, true); const count = seen.length; c.begin('later'); assert.equal(seen.length, count); c.destroy();
});

test('R14-05 real ModalShell opens once, renders literal text and restores the original focus', () => {
  const h = host(); const task = h.controller.begin('<img src=x onerror=bad()>'); h.document.flushFrames();
  assert.equal(h.view.isOpen(), true); assert.equal(h.document.activeElement, h.node('cancel'));
  assert.equal(h.node('title').textContent, '<img src=x onerror=bad()>'); assert.equal(h.node('title').children.length, 0);
  task.update(46, '<script>status</script>', 'building'); h.document.flushFrames();
  assert.equal(h.node('value').style.width, '46%'); assert.equal(h.node('status').children.length, 0);
  assert.equal(h.view.root.firstElementChild.getAttribute('aria-labelledby'), 'export-progress-title');
  assert.equal(h.view.root.firstElementChild.getAttribute('aria-describedby'), 'export-progress-status');
  h.controller.finish(task); h.document.flushFrames();
  assert.equal(h.document.activeElement, h.source); assert.equal(h.view.isOpen(), false); h.destroy();
});

test('R14-05 Escape and backdrop cannot close an active task, and one button cancels once', () => {
  const h = host(), task = h.controller.begin('cancel');
  h.view.root.dispatch('keydown', { key:'Escape',preventDefault(){},stopPropagation(){} });
  h.view.root.dispatch('mousedown', { target:h.view.root,preventDefault(){},stopPropagation(){} });
  assert.equal(h.view.isOpen(), true); h.node('cancel').click();
  assert.equal(task.cancelled, true); assert.equal(h.node('cancel').disabled, true);
  h.node('cancel').dispatchEvent({ type:'click' }); assert.equal(h.node('status').textContent, '正在取消导出…');
  assert.equal(h.node('cancel').textContent, '正在取消…'); h.controller.finish(task); h.destroy();
});

test('R14-05 all terminal outcomes reset title, progress, message and disabled button before close', () => {
  const h = host();
  for (const outcome of ['completed','failed','cancelled']) {
    const task = h.controller.begin(outcome); task.update(70, 'old message', 'building');
    if (outcome === 'cancelled') h.controller.cancel(); h.controller.finish(task, outcome === 'failed' ? 'failed' : 'completed');
    assert.equal(h.node('title').textContent, '正在准备导出'); assert.equal(h.node('value').style.width, '0%');
    assert.equal(h.node('status').textContent, ''); assert.equal(h.node('cancel').disabled, true); assert.equal(h.view.isOpen(), false);
  }
  h.destroy();
});

test('R14-05 replacing tasks keeps current DOM and stale handles cannot close it', () => {
  const h = host(), old = h.controller.begin('old'), current = h.controller.begin('current');
  current.update(35, 'current status', 'building'); old.update(90, 'stale'); h.controller.finish(old);
  assert.equal(h.node('title').textContent, 'current'); assert.equal(h.node('value').style.width, '35%');
  assert.equal(h.view.isOpen(), true); h.controller.finish(current); h.destroy();
});

test('R14-05 finishing then immediately beginning prevents a stale close animation from hiding the new dialog', async () => {
  const h = host(), old = h.controller.begin('old'); h.document.flushFrames(); h.controller.finish(old);
  const task = h.controller.begin('new'); h.document.flushFrames();
  h.view.root.dispatch('transitionend', { target:h.view.root }); await Promise.resolve();
  assert.equal(h.view.isOpen(), true); assert.equal(h.view.root.style.display, 'flex');
  assert.equal(h.node('title').textContent, 'new'); assert.equal(h.document.activeElement, h.node('cancel'));
  h.controller.finish(task); h.destroy();
});

test('R14-05 disabled locked button rejects even synthetic clicks and the next task is cancellable', () => {
  const h = host(), locked = h.controller.begin('locked'); locked.lockCancellation('encoding');
  h.node('cancel').dispatchEvent({ type:'click' }); assert.equal(locked.cancelled, false); assert.equal(h.node('cancel').disabled, true);
  h.controller.finish(locked); const next = h.controller.begin('next'); assert.equal(h.node('cancel').disabled, false);
  h.node('cancel').click(); assert.equal(next.cancelled, true); h.destroy();
});

test('R14-05 controller destruction closes the view; view disposal removes DOM and late button listeners', () => {
  const h = host(), task = h.controller.begin('locked'); task.lockCancellation('writing'); const button = h.node('cancel');
  h.controller.destroy(); assert.equal(h.view.isOpen(), false); assert.equal(h.node('status').textContent, '');
  h.view.destroy(); h.view.destroy(); assert.equal(h.document.getElementById('export-progress-modal'), null);
  button.dispatchEvent({ type:'click' }); assert.equal(button.listeners.get('click').length, 0); h.store.destroy();
});

test('R14-05 view disposal alone does not cancel the task, and a new view can mount cleanly', () => {
  const h = host(), task = h.controller.begin('owned'); h.view.destroy(); assert.equal(task.cancelled, false);
  const next = createExportProgressDialogView({ overlayRoot:h.document.body,store:h.store,onCancel:()=>h.controller.cancel() });
  assert.equal(next.isOpen(), true); h.controller.finish(task); assert.equal(next.isOpen(), false); next.destroy(); h.destroy();
});

test('R14-05 duplicate mounting and failed construction leave no extra DOM or listeners', () => {
  const h = host(); assert.throws(() => createExportProgressDialogView({ overlayRoot:h.document.body,store:h.store,onCancel(){} }), /already mounted/);
  h.view.destroy();
  assert.throws(() => createExportProgressDialogView({ overlayRoot:h.document.body,store:h.store,onCancel(){},createModalShell(){throw new Error('construct');} }), /construct/);
  assert.equal(h.document.getElementById('export-progress-modal'), null);
  const next = createExportProgressDialogView({ overlayRoot:h.document.body,store:h.store,onCancel(){} }); next.destroy(); h.destroy();
});

test('R14-05 opening failure rolls back the task and a later task opens normally', () => {
  let fail = true;
  const h = host({ createModalShell(root, options) { const shell = new ModalShell(root, options); const open = shell.open.bind(shell); shell.open = (...args) => { if (fail) throw new Error('open failed'); return open(...args); }; return shell; } });
  assert.throws(() => h.controller.begin('fails'), /open failed/); assert.equal(h.controller.getSnapshot().activeTask, null);
  assert.equal(h.view.isOpen(), false); assert.equal(h.node('status').textContent, '');
  fail = false; const task = h.controller.begin('retry'); assert.equal(h.view.isOpen(), true); h.controller.finish(task); h.destroy();
});

test('R14-05 view cleanup continues after shell disposal errors', () => {
  const h = host({ createModalShell(root, options) { const shell = new ModalShell(root, options); const destroy = shell.destroy.bind(shell); shell.destroy = () => { destroy(); throw new Error('shell cleanup'); }; return shell; } });
  const button = h.node('cancel'); assert.throws(() => h.view.destroy(), /cleanly/);
  assert.equal(h.document.getElementById('export-progress-modal'), null); assert.equal(button.listeners.get('click').length, 0);
  h.controller.begin('no view'); h.controller.destroy(); h.store.destroy();
});

test('R14-05 actual classic caller consumes the new progress view without a legacy UI global', async () => {
  const h = createExportVmHost({ parseError:true }); assert.equal(h.evaluate('typeof cancelActiveExport'), 'undefined');
  await h.invoke('exportHTML'); assert.equal(h.taskPort.getSnapshot().activeTask, null);
  assert.equal(h.nodes.get('export-progress-status').textContent, ''); assert.equal(h.nodes.get('export-progress-value').style.width, '0%'); h.destroy();
});

test('R14-05 production composition owns disposal and compatibility markup/registry no longer own progress', async () => {
  const read = path => readFile(path, 'utf8');
  const [main, classic, markup, bridge] = await Promise.all(['src/main.js','public/app/export.js','public/compatibility/business-content.html','src/ui/compatibility/mount-modal-shells.js'].map(read));
  assert.match(main, /createExportProgressStore\(exportTaskController\)/);
  assert.match(main, /createExportProgressDialogView/); assert.match(main, /exportProgressView\.destroy\(\)/); assert.match(main, /exportProgressStore\.destroy\(\)/);
  assert.doesNotMatch(classic, /export-progress-|exportProgressModalOpened|cancelActiveExport|exportTaskPort\.subscribe/);
  assert.doesNotMatch(markup, /id="export-progress-|cancelActiveExport/); assert.doesNotMatch(bridge, /id: 'export-progress-modal'/);
});
