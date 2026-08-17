
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createSaveController,
  createSaveStatusStore,
  mountClassicSaveControllerPort
} from '../src/features/persistence/index.js';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

function createHarness(overrides = {}) {
  let generation = 7;
  const calls = [];
  const snapshots = [];
  const record = {
    id: 'doc-1',
    title: 'Draft.md',
    filePath: 'C:/docs/Draft.md',
    nativeBacked: true,
    nativeVersion: 4
  };
  const model = {
    getDocumentVersion: () => 12,
    createSnapshot(reason) {
      snapshots.push(reason);
      return '# latest body';
    },
    ...overrides.model
  };
  const documentController = {
    get generation() { return generation; },
    getActiveRecord: () => record,
    isCurrentGeneration: value => Number(value) === generation,
    isStaleError: error => error?.code === 'DOCUMENT_OPERATION_STALE',
    async saveActive(options) {
      calls.push(options);
      return {
        generation,
        saved: true,
        native: true,
        record,
        result: { native: true, version: 5, snapshotCreated: true }
      };
    },
    ...overrides.documentController
  };
  const statusStore = createSaveStatusStore();
  return {
    calls,
    snapshots,
    record,
    model,
    documentController,
    statusStore,
    setGeneration(value) { generation = value; }
  };
}

test('Atomic 10.2 SaveController has an explicit DOM-free dependency surface', async () => {
  assert.throws(() => createSaveController(), /document controller/);
  const controllerSource = await source('src/features/persistence/application/save-controller.js');
  assert.doesNotMatch(controllerSource, /\bwindow\s*\.|\bdocument\s*\.|localStorage|sessionStorage|setTimeout|setInterval|requestAnimationFrame|Worker\s*\(/);
  assert.doesNotMatch(controllerSource, /from\s+['"]/);
});

test('Atomic 10.2 manual save delegates once and publishes frozen title/path/version/native result context', async () => {
  const harness = createHarness();
  const states = [];
  harness.statusStore.subscribe(event => states.push(event.current));
  const controller = createSaveController(harness);
  let continuationContext = null;
  const result = await controller.save({
    title: 'Renamed.md',
    fallbackTitle: '未命名文档',
    forceSnapshot: true,
    snapshotReason: 'manual-test',
    statusMessage: '正在手动保存…',
    contentReason: 'manual-content',
    afterPersist(context) {
      continuationContext = context;
      return { path: context.path };
    }
  });

  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0], {
    title: 'Renamed.md',
    fallbackTitle: '未命名文档',
    forceSnapshot: true,
    snapshotReason: 'manual-test'
  });
  assert.deepEqual(states.map(item => item.state), ['saving', 'saved']);
  assert.equal(states[0].message, '正在手动保存…');
  assert.equal(states[0].targetVersion, 12);
  assert.equal(states[1].backendVersion, 5);
  assert.deepEqual(harness.snapshots, ['manual-content']);
  assert.ok(Object.isFrozen(continuationContext));
  assert.equal(continuationContext.content, '# latest body');
  assert.equal(continuationContext.path, 'C:/docs/Draft.md');
  assert.equal(continuationContext.editorVersion, 12);
  assert.equal(continuationContext.backendVersion, 5);
  assert.equal(continuationContext.native, true);
  assert.ok(Object.isFrozen(result));
  assert.equal(result.saved, true);
  assert.equal(result.completed, true);
  assert.equal(result.cancelled, false);
  assert.equal(result.path, 'C:/docs/Draft.md');
  assert.equal(Object.hasOwn(result, 'content'), false, 'SaveController must not retain a second document body');
  controller.destroy();
  harness.statusStore.destroy();
});

test('Atomic 10.2 stale document cancellation is not reported as a save failure', async () => {
  const stale = Object.assign(new Error('stale'), { code: 'DOCUMENT_OPERATION_STALE' });
  const harness = createHarness({
    documentController: { async saveActive() { throw stale; } }
  });
  const states = [];
  harness.statusStore.subscribe(event => states.push(event.current.state));
  const controller = createSaveController(harness);
  const result = await controller.save({ statusMessage: '正在保存…' });
  assert.equal(result.cancelled, true);
  assert.equal(result.stale, true);
  assert.equal(result.reason, 'document-operation-stale');
  assert.deepEqual(states, ['saving']);
  controller.destroy();
  harness.statusStore.destroy();
});

test('Atomic 10.2 post-persist user cancellation remains saved internally and distinct from failure', async () => {
  const harness = createHarness();
  const controller = createSaveController(harness);
  const result = await controller.save({
    afterPersist() { return { cancelled: true, reason: 'file-picker-cancelled' }; }
  });
  assert.equal(result.saved, true);
  assert.equal(result.completed, false);
  assert.equal(result.cancelled, true);
  assert.equal(result.stale, false);
  assert.equal(result.reason, 'file-picker-cancelled');
  assert.equal(harness.statusStore.snapshot.state, 'saved');
  controller.destroy();
  harness.statusStore.destroy();
});

test('Atomic 10.2 persistence failure publishes error and never executes the manual continuation', async () => {
  const failure = new Error('disk full');
  let continued = false;
  const harness = createHarness({
    documentController: { async saveActive() { throw failure; } }
  });
  const controller = createSaveController(harness);
  await assert.rejects(
    controller.save({ afterPersist() { continued = true; } }),
    error => error === failure
  );
  assert.equal(continued, false);
  assert.equal(harness.statusStore.snapshot.state, 'error');
  assert.equal(harness.statusStore.snapshot.message, '保存失败：disk full');
  controller.destroy();
  harness.statusStore.destroy();
});

test('Atomic 10.2 continuation failure is one save failure and never publishes fake success', async () => {
  const failure = new Error('write failed');
  const harness = createHarness();
  const controller = createSaveController(harness);
  await assert.rejects(
    controller.save({ async afterPersist() { throw failure; } }),
    error => error === failure
  );
  assert.equal(harness.statusStore.snapshot.state, 'error');
  assert.equal(harness.statusStore.snapshot.message, '保存失败：write failed');
  controller.destroy();
  harness.statusStore.destroy();
});

test('Atomic 10.2 destroy is terminal and rejects late in-flight success publication', async () => {
  let resolveSave;
  let continued = false;
  const harness = createHarness({
    documentController: {
      saveActive() {
        return new Promise(resolve => { resolveSave = resolve; });
      }
    }
  });
  const controller = createSaveController(harness);
  const pending = controller.save({ afterPersist() { continued = true; } });
  assert.equal(harness.statusStore.snapshot.state, 'saving');
  controller.destroy();
  controller.destroy();
  resolveSave({
    generation: 7,
    saved: true,
    native: false,
    record: harness.record,
    result: { native: false }
  });
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.equal(result.reason, 'controller-destroyed');
  assert.equal(continued, false);
  assert.equal(harness.statusStore.snapshot.state, 'saving');
  await assert.rejects(controller.save(), /destroyed/);
  harness.statusStore.destroy();
});

test('Atomic 10.2 classic port is command-only and manual classic callers no longer bypass SaveController', async () => {
  const harness = createHarness();
  const controller = createSaveController(harness);
  const host = {};
  const mount = mountClassicSaveControllerPort(host, controller);
  const api = host.markdownEditorSaveControllerPort;
  assert.equal(Object.prototype.propertyIsEnumerable.call(host, 'markdownEditorSaveControllerPort'), false);
  await api.save({ title: 'Port.md' });
  assert.equal(harness.calls.length, 1);
  mount.destroy();
  mount.destroy();
  assert.equal(Object.hasOwn(host, 'markdownEditorSaveControllerPort'), false);
  assert.throws(() => api.save(), /destroyed/);

  const [entry, main, exportSource, core, eventsSource, fixtureText] = await Promise.all([
    source('src/features/persistence/index.js'),
    source('src/main.js'),
    source('public/app/export.js'),
    source('public/app/core.js'),
    source('public/app/events.js'),
    source('tests/architecture/fixtures/production-modules.json')
  ]);
  assert.match(entry, /createSaveController/);
  assert.match(entry, /mountClassicSaveControllerPort/);
  assert.match(main, /createSaveController\(\{/);
  assert.match(main, /mountClassicSaveControllerPort\(compatibilityPlatformHost, saveController\)/);
  assert.match(main, /saveControllerPort\.destroy\(\)/);
  assert.match(main, /saveController\.destroy\(\)/);
  assert.match(exportSource, /markdownEditorSaveControllerPort/);

  const manualLocal = exportSource.match(/async function saveToLocal\(\)[\s\S]*?async function saveMarkdownWithPicker/)[0];
  const manualFile = exportSource.match(/async function saveCurrentFile\(\)[\s\S]*?async function saveAsMarkdown/)[0];
  for (const block of [manualLocal, manualFile]) {
    assert.match(block, /exportSaveControllerPort\.save\(/);
    assert.doesNotMatch(block, /saveCurrentDocumentState\s*\(/);
    assert.doesNotMatch(block, /exportSaveStatusStorePort\.setState\(/);
  }

  assert.match(exportSource, /function autoSave\(\)[\s\S]*?saveCurrentDocumentState\(false\)/, 'R10-03 autosave migration must not be pulled into R10-02');
  assert.match(eventsSource, /eventsCloseSavePort\.register[\s\S]*?saveCurrentDocumentState\(false/, 'R10-11 close-save migration must remain future work');
  assert.match(core, /async function saveCurrentDocumentState[\s\S]*?coreDocumentControllerPort\.saveActive\(/, 'legacy helper remains only for later autosave/close-save atomics');
  await assert.rejects(access(new URL('../src/features/persistence/application/autosave-controller.js', import.meta.url)));

  const fixture = JSON.parse(fixtureText);
  assert.equal(fixture.modules.length, 386);
  for (const path of [
    'src/features/persistence/application/save-controller.js',
    'src/features/persistence/compatibility/classic-save-controller-port.js'
  ]) assert.ok(fixture.modules.some(record => record[0] === path), `production inventory must classify ${path}`);

  controller.destroy();
  harness.statusStore.destroy();
});
