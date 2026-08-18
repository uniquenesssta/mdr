import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  SAVE_STATUS_STATES,
  createSaveStatusStore,
  mountClassicSaveStatusStorePort
} from '../src/features/persistence/index.js';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('Atomic 10.1 SaveStatusStore owns the six canonical states as immutable snapshots', () => {
  assert.deepEqual(SAVE_STATUS_STATES, ['idle', 'queued', 'saving', 'saved', 'error', 'loading']);
  const store = createSaveStatusStore();
  assert.equal(store.snapshot.state, 'idle');
  assert.equal(store.snapshot.revision, 0);
  assert.ok(Object.isFrozen(store.snapshot));

  const events = [];
  const unsubscribe = store.subscribe(event => events.push(event));
  const queued = store.setState('queued', { documentId: 'doc-1', pending: 2, targetVersion: 3 });
  assert.equal(queued.state, 'queued');
  assert.equal(queued.operation, 'save');
  assert.equal(queued.documentId, 'doc-1');
  assert.equal(queued.pending, 2);
  assert.equal(queued.targetVersion, 3);
  assert.equal(queued.revision, 1);
  assert.ok(Object.isFrozen(events[0]));
  assert.equal(events[0].previous.state, 'idle');
  assert.equal(events[0].current, queued);

  const saving = store.setState('saving', { documentId: 'doc-1', progress: 0.25, backendVersion: 2 });
  assert.equal(saving.progress, 0.25);
  assert.equal(saving.backendVersion, 2);
  const saved = store.setState('saved', { documentId: 'doc-1', version: 3, snapshotCreated: true });
  assert.equal(saved.snapshotCreated, true);
  assert.equal(saved.version, 3);
  const error = store.setState('error', { operation: 'save', documentId: 'doc-1', message: 'disk full' });
  assert.equal(error.message, 'disk full');
  const loading = store.setState('loading', { documentId: 'doc-2', phase: 'content', progress: 0.5 });
  assert.equal(loading.operation, 'load');
  assert.equal(loading.phase, 'content');
  store.reset();
  assert.equal(store.snapshot.state, 'idle');
  assert.equal(store.snapshot.operation, 'idle');
  unsubscribe();
  store.destroy();
});

test('Atomic 10.1 maps native persistence events without copying document payload data', () => {
  const store = createSaveStatusStore();
  assert.equal(store.consumePersistenceEvent({ state: 'loading-index', documentId: 'doc-a' }), true);
  assert.deepEqual([store.snapshot.state, store.snapshot.operation, store.snapshot.phase], ['loading', 'load', 'index']);
  assert.equal(store.consumePersistenceEvent({ state: 'manifest', documentId: 'doc-a', manifest: { headings: ['must-not-copy'] } }), true);
  assert.equal(store.snapshot.phase, 'manifest');
  assert.equal(Object.hasOwn(store.snapshot, 'manifest'), false);
  store.consumePersistenceEvent({ state: 'loading', documentId: 'doc-a', progress: 0.75 });
  assert.equal(store.snapshot.progress, 0.75);
  store.consumePersistenceEvent({ state: 'loaded', documentId: 'doc-a' });
  assert.equal(store.snapshot.state, 'idle');
  assert.equal(store.snapshot.operation, 'load');
  assert.equal(store.snapshot.phase, 'complete');

  store.consumePersistenceEvent({ state: 'queued', documentId: 'doc-a', targetVersion: 8, pending: 1 });
  assert.equal(store.snapshot.state, 'queued');
  store.consumePersistenceEvent({ state: 'saving', documentId: 'doc-a', targetVersion: 8, backendVersion: 7, progress: 0.4 });
  assert.equal(store.snapshot.state, 'saving');
  store.consumePersistenceEvent({ state: 'saved', documentId: 'doc-a', version: 8, pending: 1 });
  assert.equal(store.snapshot.state, 'queued');
  store.consumePersistenceEvent({ state: 'saved', documentId: 'doc-a', version: 8, pending: 0, snapshotCreated: true });
  assert.equal(store.snapshot.state, 'saved');
  assert.equal(store.snapshot.snapshotCreated, true);
  store.consumePersistenceEvent({ state: 'error', documentId: 'doc-a', message: 'write failed' });
  assert.equal(store.snapshot.state, 'error');
  assert.equal(store.snapshot.operation, 'save');
  store.consumePersistenceEvent({ state: 'load-error', documentId: 'doc-b', message: 'read failed' });
  assert.equal(store.snapshot.operation, 'load');
  const revision = store.snapshot.revision;
  assert.equal(store.consumePersistenceEvent({ state: 'unrelated', documentId: 'doc-b' }), false);
  assert.equal(store.snapshot.revision, revision, 'unknown/stale-unowned event kinds must not publish a new status');
  store.destroy();
});

test('Atomic 10.1 rejects invalid status data and destroy is an irreversible terminal lifecycle', () => {
  const store = createSaveStatusStore();
  assert.throws(() => store.setState('unknown'), /Unsupported save status/);
  assert.throws(() => store.setState('saving', { progress: 2 }), /progress/);
  assert.throws(() => store.setState('saving', { hidden: true }), /Unknown save status details field/);
  assert.throws(() => store.subscribe(null), /listener/);
  const unsubscribe = store.subscribe(() => {});
  store.destroy();
  store.destroy();
  unsubscribe();
  assert.throws(() => store.snapshot, /destroyed/);
  assert.throws(() => store.setState('idle'), /destroyed/);
  assert.throws(() => store.consumePersistenceEvent({ state: 'saved' }), /destroyed/);
  assert.throws(() => store.subscribe(() => {}), /destroyed/);
});

test('Atomic 10.1 scoped classic port delegates to one Store and owns no duplicate status state', () => {
  const target = {};
  const store = createSaveStatusStore();
  const mount = mountClassicSaveStatusStorePort(target, store);
  const api = target.markdownEditorSaveStatusStorePort;
  assert.equal(api.snapshot, store.snapshot);
  assert.equal(Object.prototype.propertyIsEnumerable.call(target, 'markdownEditorSaveStatusStorePort'), false);
  const observed = [];
  const unsubscribe = api.subscribe(event => observed.push(event.current.state));
  api.setState('saving', '正在手动保存…');
  assert.equal(store.snapshot.state, 'saving');
  assert.equal(store.snapshot.message, '正在手动保存…');
  assert.deepEqual(observed, ['saving']);
  unsubscribe();
  mount.destroy();
  mount.destroy();
  assert.equal(Object.hasOwn(target, 'markdownEditorSaveStatusStorePort'), false);
  assert.throws(() => api.snapshot, /destroyed/);
  assert.equal(store.snapshot.state, 'saving', 'destroying the bridge must not destroy or copy Store state');
  store.destroy();
});

test('Atomic 10.1 composition gives status authority to Persistence and UI only subscribes it', async () => {
  const [storeSource, portSource, entry, main, core, exportSource, fixtureText] = await Promise.all([
    source('src/features/persistence/state/save-status-store.js'),
    source('src/features/persistence/compatibility/classic-save-status-store-port.js'),
    source('src/features/persistence/index.js'),
    source('src/main.js'),
    source('public/app/core.js'),
    source('public/app/export.js'),
    source('tests/architecture/fixtures/production-modules.json')
  ]);
  assert.doesNotMatch(storeSource, /\bwindow\b|\bdocument\b|localStorage|sessionStorage|setTimeout|setInterval|requestAnimationFrame|Worker\s*\(/);
  assert.match(entry, /createSaveStatusStore/);
  assert.match(entry, /mountClassicSaveStatusStorePort/);
  assert.match(portSource, /markdownEditorSaveStatusStorePort/);
  assert.doesNotMatch(portSource, /window\.markdownEditorSaveStatus/);
  assert.doesNotMatch(portSource, /let\s+snapshot\b|const\s+snapshot\s*=/);

  assert.match(main, /createSaveStatusStore\(\)/);
  assert.match(main, /mountClassicSaveStatusStorePort\(compatibilityPlatformHost, saveStatusStore\)/);
  assert.match(main, /saveStatusStore\.consumePersistenceEvent\(event\)/);
  assert.match(main, /saveStatusStorePort\.destroy\(\)/);
  assert.match(main, /saveStatusStore\.destroy\(\)/);

  assert.match(core, /markdownEditorSaveStatusStorePort/);
  assert.match(core, /coreSaveStatusStorePort\.subscribe\(/);
  assert.doesNotMatch(core, /let\s+saveStatusState\b|function\s+setSaveStatus\b/);
  assert.doesNotMatch(core, /event\.state === 'queued'|event\.state === 'saving'|event\.state === 'saved'|event\.state === 'error'|event\.state === 'loading-index'|event\.state === 'loading'/);
  assert.match(core, /event\.state !== 'manifest'/);

  assert.doesNotMatch(exportSource, /markdownEditorSaveStatusStorePort|exportSaveStatusStorePort\.setState\(/, 'later Persistence controllers must not return SaveStatusStore write authority to classic export code');
  assert.doesNotMatch(exportSource, /markdownEditorAutosaveControllerPort/, 'R10-12 removes the classic autosave bridge from export code');
  assert.doesNotMatch(exportSource, /\bsetSaveStatus\s*\(/);

  const fixture = JSON.parse(fixtureText);
  const paths = new Set(fixture.modules.map(record => record[0]));
  for (const path of [
    'src/features/persistence/index.js',
    'src/features/persistence/state/save-status-store.js',
    'src/features/persistence/compatibility/classic-save-status-store-port.js'
  ]) assert.ok(paths.has(path), `production inventory must classify ${path}`);
});
