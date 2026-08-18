import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCloseSaveController } from '../src/features/persistence/application/close-save-controller.js';
import { createCloseSavePort } from '../src/features/window/close-save-port.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness({ active = true, save, decide } = {}) {
  const calls = { cancel: [], save: [], decide: [] };
  const closeSavePort = createCloseSavePort();
  const saveController = {
    async save(options) {
      calls.save.push(options);
      if (save) return save(options);
      return Object.freeze({ saved: true, completed: true, cancelled: false, stale: false });
    }
  };
  const autosaveController = {
    cancelPending(reason) {
      calls.cancel.push(reason);
      return Object.freeze({ cancelled: true, reason });
    }
  };
  const documentController = {
    getActiveRecord() {
      return active ? Object.freeze({ id: 'doc-1', title: 'Session Title' }) : null;
    }
  };
  const controller = createCloseSaveController({
    saveController,
    autosaveController,
    documentController,
    closeSavePort,
    readSaveContext: () => ({ title: 'Model Title' }),
    async decideAfterFailure(error) {
      calls.decide.push(error);
      return decide ? decide(error) : false;
    }
  });
  return { controller, closeSavePort, calls };
}

test('Atomic 10.11 CloseSaveController owns only close-time persistence admission and terminal lifecycle', () => {
  const source = read('src/features/persistence/application/close-save-controller.js');
  assert.match(source, /cancelPending\('close-save'\)/);
  assert.match(source, /forceSnapshot: true/);
  assert.match(source, /snapshotReason: 'close-save'/);
  assert.doesNotMatch(source, /^import\s/m);
  assert.doesNotMatch(source, /\bwindow\s*[.\[]|\bdocument\s*[.\[]|\blocalStorage\b|\bsessionStorage\b|\bsetTimeout\s*\(|\bsetInterval\s*\(/);
  assert.doesNotMatch(source, /NativeSaveQueue|NativeSaveSession|DocumentModel|contentChunks|createSnapshot/);
});

test('Atomic 10.11 start registers exactly one CloseSavePort handler and is idempotent', async () => {
  const { controller, closeSavePort } = harness({ active: false });
  assert.equal(controller.start(), true);
  assert.equal(controller.start(), false);
  assert.equal(closeSavePort.registered, true);
  assert.equal(await closeSavePort.prepareClose(), true);
  controller.destroy();
  assert.equal(closeSavePort.registered, false);
  closeSavePort.destroy();
});

test('Atomic 10.11 no-active-document close cancels pending autosave and admits close without inventing a save', async () => {
  const { controller, calls } = harness({ active: false });
  assert.equal(await controller.prepareClose(), true);
  assert.deepEqual(calls.cancel, ['close-save']);
  assert.equal(calls.save.length, 0);
  assert.equal(calls.decide.length, 0);
  controller.destroy();
});

test('Atomic 10.11 active close cancels Autosave then delegates one forced final snapshot with current title', async () => {
  const order = [];
  const closeSavePort = createCloseSavePort();
  const controller = createCloseSaveController({
    saveController: { async save(options) { order.push(['save', options]); return { saved: true, completed: true }; } },
    autosaveController: { cancelPending(reason) { order.push(['cancel', reason]); } },
    documentController: { getActiveRecord() { return { id: 'doc-1', title: 'Session Title' }; } },
    closeSavePort,
    readSaveContext: () => ({ title: 'Live Title' })
  });
  assert.equal(await controller.prepareClose(), true);
  assert.deepEqual(order[0], ['cancel', 'close-save']);
  assert.deepEqual(order[1], ['save', {
    title: 'Live Title',
    fallbackTitle: '未命名文档',
    forceSnapshot: true,
    snapshotReason: 'close-save'
  }]);
  controller.destroy();
  closeSavePort.destroy();
});

test('Atomic 10.11 accepted final save admits close without consulting failure decision', async () => {
  const { controller, calls } = harness();
  assert.equal(await controller.prepareClose(), true);
  assert.equal(calls.save.length, 1);
  assert.equal(calls.decide.length, 0);
  controller.destroy();
});

test('Atomic 10.11 cancelled or stale SaveController results block close without force-close prompting', async () => {
  for (const result of [
    { saved: false, completed: false, cancelled: true, stale: false },
    { saved: false, completed: false, cancelled: true, stale: true },
    { saved: true, completed: false, cancelled: true, stale: false }
  ]) {
    const { controller, calls } = harness({ save: async () => result, decide: async () => true });
    assert.equal(await controller.prepareClose(), false);
    assert.equal(calls.decide.length, 0);
    controller.destroy();
  }
});

test('Atomic 10.11 persistence failure blocks close when the injected user decision declines', async () => {
  const failure = new Error('disk full');
  const { controller, calls } = harness({ save: async () => { throw failure; }, decide: async () => false });
  assert.equal(await controller.prepareClose(), false);
  assert.equal(calls.decide.length, 1);
  assert.equal(calls.decide[0], failure);
  controller.destroy();
});

test('Atomic 10.11 persistence failure permits explicit force-close decision with original error identity', async () => {
  const failure = new Error('write failed');
  const { controller, calls } = harness({ save: async () => { throw failure; }, decide: async error => error === failure });
  assert.equal(await controller.prepareClose(), true);
  assert.equal(calls.decide[0], failure);
  controller.destroy();
});

test('Atomic 10.11 concurrent requests coalesce and destroy suppresses late save approval', async () => {
  const pending = deferred();
  const { controller, calls } = harness({ save: () => pending.promise });
  const first = controller.prepareClose();
  const second = controller.prepareClose();
  assert.equal(first, second);
  assert.equal(calls.save.length, 1);
  controller.destroy();
  pending.resolve({ saved: true, completed: true, cancelled: false, stale: false });
  assert.equal(await first, false);
  assert.throws(() => controller.prepareClose(), /destroyed/);
});

test('Atomic 10.11 production integration gives Persistence one Close Save authority and leaves Window port-only', () => {
  const persistenceEntry = read('src/features/persistence/index.js');
  const main = read('src/main.js');
  const events = read('public/app/events.js');
  const windowClose = read('src/features/window/window-close-controller.js');
  const fixture = JSON.parse(read('tests/architecture/fixtures/production-modules.json'));

  assert.match(persistenceEntry, /createCloseSaveController/);
  assert.equal((main.match(/createCloseSaveController\(/g) || []).length, 1);
  assert.match(main, /closeSaveController\.start\(\)/);
  assert.match(main, /closeSaveController\?\.destroy\(\)/);
  assert.doesNotMatch(events, /eventsCloseSavePort|markdownEditorCloseSavePort/);
  assert.match(windowClose, /closeSave\.prepareClose\(\)/);
  assert.doesNotMatch(windowClose, /saveController|autosaveController|forceSnapshot|snapshotReason/);
  assert.equal(fixture.modules.length, 396);
  assert.ok(fixture.modules.some(([modulePath]) => modulePath === 'src/features/persistence/application/close-save-controller.js'));
});
