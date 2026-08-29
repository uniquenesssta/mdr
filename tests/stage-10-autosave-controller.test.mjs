import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createAutosaveController,
  createSaveStatusStore
} from '../src/features/persistence/index.js';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

function createHarness(overrides = {}) {
  let version = 3;
  const record = { id: 'doc-1', title: 'Draft.md' };
  const model = {
    documentId: 'doc-1',
    title: 'Draft.md',
    getDocumentVersion: () => version,
    ...overrides.model
  };
  const documentController = {
    getActiveRecord: () => record,
    ...overrides.documentController
  };
  const saves = [];
  let saveImpl = overrides.save;
  const saveController = {
    async save(options) {
      saves.push(options);
      if (saveImpl) return saveImpl(options);
      return Object.freeze({
        saved: true,
        completed: true,
        cancelled: false,
        stale: false,
        documentId: model.documentId,
        title: model.title,
        targetVersion: version
      });
    }
  };
  const statusStore = createSaveStatusStore();
  let settingsSnapshot = { enabled: true, delay: 500 };
  const settingsListeners = new Set();
  const settings = {
    read: () => ({ ...settingsSnapshot }),
    subscribe(listener) {
      settingsListeners.add(listener);
      return () => settingsListeners.delete(listener);
    }
  };
  let nextTimerId = 1;
  const timers = new Map();
  const cleared = [];
  const errors = [];
  const controller = createAutosaveController({
    saveController,
    documentController,
    model,
    statusStore,
    settings,
    setTimer(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      cleared.push(id);
      timers.delete(id);
    },
    reportError(...args) { errors.push(args); }
  });

  return {
    controller,
    statusStore,
    model,
    record,
    saves,
    timers,
    cleared,
    errors,
    setVersion(value) { version = value; },
    emitSettings(next) {
      settingsSnapshot = { ...settingsSnapshot, ...next };
      for (const listener of [...settingsListeners]) listener({ ...settingsSnapshot });
    },
    async fireOnlyTimer() {
      assert.equal(timers.size, 1);
      const [id, timer] = [...timers.entries()][0];
      timers.delete(id);
      timer.callback();
      await new Promise(resolve => setImmediate(resolve));
      return timer;
    },
    get settingsListenerCount() { return settingsListeners.size; }
  };
}

test('Atomic 10.3 AutosaveController has an explicit DOM-free dependency and timer surface', async () => {
  assert.throws(() => createAutosaveController(), /save controller/);
  const controllerSource = await source('src/features/persistence/application/autosave-controller.js');
  assert.doesNotMatch(controllerSource, /\bwindow\s*\.|\bdocument\s*\.|localStorage|sessionStorage|requestAnimationFrame|Worker\s*\(/);
  assert.doesNotMatch(controllerSource, /from\s+['"]/);
  assert.doesNotMatch(controllerSource, /\bsetTimeout\s*\(|\bclearTimeout\s*\(/);
});

test('Atomic 10.3 debounce owns exactly one timer and delegates one autosave through SaveController', async () => {
  const harness = createHarness();
  const first = harness.controller.schedule({ reason: 'edit-1' });
  const second = harness.controller.schedule({ reason: 'edit-2' });
  assert.equal(first.scheduled, true);
  assert.equal(second.scheduled, true);
  assert.equal(harness.cleared.length, 1);
  assert.equal(harness.timers.size, 1);
  const timer = await harness.fireOnlyTimer();
  assert.equal(timer.delay, 500);
  assert.equal(harness.saves.length, 1);
  assert.deepEqual(harness.saves[0], {
    title: 'Draft.md',
    fallbackTitle: '未命名文档',
    forceSnapshot: false,
    snapshotReason: 'document-storage',
    statusMessage: '正在后台保存…'
  });
  harness.controller.destroy();
  harness.statusStore.destroy();
});

test('Atomic 10.3 same document version and unchanged title skips redundant autosave', async () => {
  const harness = createHarness();
  harness.controller.schedule();
  await harness.fireOnlyTimer();
  assert.equal(harness.saves.length, 1);
  const skipped = harness.controller.schedule();
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.reason, 'unchanged-version-and-title');
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.saves.length, 1);
  harness.controller.destroy();
  harness.statusStore.destroy();
});

test('Atomic 10.3 title-only change saves even when editor version is unchanged', async () => {
  const harness = createHarness();
  harness.controller.schedule();
  await harness.fireOnlyTimer();
  harness.model.title = 'Renamed.md';
  harness.controller.schedule({ reason: 'title-change' });
  await harness.fireOnlyTimer();
  assert.equal(harness.saves.length, 2);
  assert.equal(harness.saves[1].title, 'Renamed.md');
  harness.controller.destroy();
  harness.statusStore.destroy();
});

test('Atomic 10.3 Settings subscription cancels disabled work and re-arms with the committed delay', async () => {
  const harness = createHarness();
  harness.controller.schedule({ reason: 'pending' });
  assert.equal(harness.timers.size, 1);
  harness.emitSettings({ enabled: false });
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.cleared.length, 1);
  harness.setVersion(4);
  harness.emitSettings({ enabled: true, delay: 1750 });
  assert.equal(harness.timers.size, 1);
  const timer = await harness.fireOnlyTimer();
  assert.equal(timer.delay, 1750);
  assert.equal(harness.saves.length, 1);
  harness.controller.destroy();
  harness.statusStore.destroy();
});

test('Atomic 10.3 failed autosave never establishes a fake saved baseline and remains retryable', async () => {
  const failure = new Error('disk full');
  let attempts = 0;
  const harness = createHarness({
    async save() {
      attempts += 1;
      if (attempts === 1) throw failure;
      return Object.freeze({ saved: true, completed: true, cancelled: false, stale: false, documentId: 'doc-1', title: 'Draft.md', targetVersion: 3 });
    }
  });
  harness.controller.schedule();
  await harness.fireOnlyTimer();
  assert.equal(harness.errors.length, 1);
  assert.equal(harness.errors[0][1], failure);
  const retry = harness.controller.schedule();
  assert.equal(retry.scheduled, true);
  await harness.fireOnlyTimer();
  assert.equal(attempts, 2);
  harness.controller.destroy();
  harness.statusStore.destroy();
});

test('Atomic 10.3 stale or cancelled save completion does not suppress the next autosave', async () => {
  let attempts = 0;
  const harness = createHarness({
    async save() {
      attempts += 1;
      if (attempts === 1) return Object.freeze({ saved: false, completed: false, cancelled: true, stale: true, reason: 'document-operation-stale' });
      return Object.freeze({ saved: true, completed: true, cancelled: false, stale: false, documentId: 'doc-1', title: 'Draft.md', targetVersion: 3 });
    }
  });
  harness.controller.schedule();
  await harness.fireOnlyTimer();
  assert.equal(harness.controller.schedule().scheduled, true);
  await harness.fireOnlyTimer();
  assert.equal(attempts, 2);
  harness.controller.destroy();
  harness.statusStore.destroy();
});

test('Atomic 10.3 destroy is terminal, cancels debounce work and unsubscribes Settings', async () => {
  const harness = createHarness();
  harness.controller.schedule();
  assert.equal(harness.settingsListenerCount, 1);
  harness.controller.destroy();
  harness.controller.destroy();
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.settingsListenerCount, 0);
  assert.throws(() => harness.controller.schedule(), /destroyed/);
  assert.throws(() => harness.controller.cancelPending(), /destroyed/);
  harness.statusStore.destroy();
});

test('Atomic 10.3 AutosaveController remains the single autosave authority after R10-12 classic caller removal', async () => {
  const [entry, main, core, bootstrap, exportSource, eventsSource, fixtureText] = await Promise.all([
    source('src/features/persistence/index.js'),
    source('src/main.js'),
    source('public/app/core.js'),
    source('public/app/bootstrap.js'),
    source('public/app/export.js'),
    source('public/app/events.js'),
    source('tests/architecture/fixtures/production-modules.json')
  ]);
  assert.match(entry, /createAutosaveController/);
  assert.doesNotMatch(entry, /mountClassicAutosaveControllerPort|classic-autosave-controller-port/);
  assert.match(main, /createAutosaveController\(\{/);
  assert.match(main, /requestDocumentPersistence/);
  assert.doesNotMatch(main, /mountClassicAutosaveControllerPort|markdownEditorAutosaveControllerPort/);
  assert.doesNotMatch(exportSource, /markdownEditorAutosaveControllerPort|exportAutosaveControllerPort|requestAutoSave/);
  assert.doesNotMatch(core, /markdownEditorAutosaveControllerPort|coreAutosaveControllerPort|\bautoSave\s*\(/);
  assert.doesNotMatch(bootstrap, /autoSaveEnabled\s*=|autoSaveDelay\s*=/);
  assert.doesNotMatch(eventsSource, /markdownEditorAutosaveControllerPort|eventsAutosaveControllerPort/);
  assert.match(eventsSource, /requestDocumentPersistence/);
  const fixture = JSON.parse(fixtureText);
  assert.ok(fixture.modules.some(record => record[0] === 'src/features/persistence/application/autosave-controller.js'));
  assert.equal(fixture.modules.some(record => record[0] === 'src/features/persistence/compatibility/classic-autosave-controller-port.js'), false);
});
