from pathlib import Path
import json


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one exact replacement, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_between(path, start_marker, end_marker, replacement):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{path}: start marker not found: {start_marker!r}')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'{path}: end marker not found: {end_marker!r}')
    p.write_text(text[:start] + replacement + text[end:], encoding='utf-8')


Path('src/features/persistence/state').mkdir(parents=True, exist_ok=True)
Path('src/features/persistence/compatibility').mkdir(parents=True, exist_ok=True)

Path('src/features/persistence/state/save-status-store.js').write_text(r'''/**
 * Responsibility: Own the authoritative DOM-free persistence status snapshot for save/load lifecycle presentation and stale-safe metadata projection.
 * Imports: None; feature/domain/platform/UI modules are forbidden.
 * Exports: SAVE_STATUS_STATES and createSaveStatusStore().
 * State/side effects: Owns immutable in-memory status snapshots, monotonic revision and synchronous subscribers only; no DOM, storage, timer, model or platform access.
 * Lifecycle: Explicit destroy() is idempotent and irreversible; subscribers are cleared and every later read/write/subscription is terminal.
 */
export const SAVE_STATUS_STATES = Object.freeze(['idle', 'queued', 'saving', 'saved', 'error', 'loading']);

const STATUS_SET = new Set(SAVE_STATUS_STATES);
const OPERATION_SET = new Set(['idle', 'save', 'load']);
const DETAIL_FIELDS = new Set([
  'operation', 'documentId', 'phase', 'message', 'progress', 'pending',
  'version', 'targetVersion', 'backendVersion', 'snapshotCreated'
]);

const DEFAULT_SNAPSHOT = Object.freeze({
  state: 'idle',
  operation: 'idle',
  documentId: '',
  phase: '',
  message: '',
  progress: null,
  pending: 0,
  version: null,
  targetVersion: null,
  backendVersion: null,
  snapshotCreated: false,
  revision: 0
});

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function rejectUnknownFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new RangeError(`Unknown ${label} field: ${key}.`);
  }
}

function normalizeState(value) {
  const state = String(value || '');
  if (!STATUS_SET.has(state)) throw new RangeError(`Unsupported save status: ${state || '<empty>'}.`);
  return state;
}

function normalizeOperation(value) {
  const operation = String(value || '');
  if (!OPERATION_SET.has(operation)) {
    throw new RangeError(`Unsupported persistence operation: ${operation || '<empty>'}.`);
  }
  return operation;
}

function normalizeProgress(value) {
  if (value === undefined || value === null) return null;
  const progress = Number(value);
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new TypeError('Save status progress must be null or a finite number from 0 through 1.');
  }
  return progress;
}

function normalizeNonNegativeInteger(value, label, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return number;
}

function normalizeOptionalVersion(value, label) {
  if (value === undefined || value === null) return null;
  return normalizeNonNegativeInteger(value, label, null);
}

function inferOperation(state, details, previous) {
  if (Object.hasOwn(details, 'operation')) return normalizeOperation(details.operation);
  if (state === 'loading') return 'load';
  if (state === 'queued' || state === 'saving' || state === 'saved') return 'save';
  if (state === 'error' && previous.operation !== 'idle') return previous.operation;
  return 'idle';
}

function createSnapshot(state, details, previous, revision) {
  const normalizedState = normalizeState(state);
  assertPlainObject(details, 'Save status details');
  rejectUnknownFields(details, DETAIL_FIELDS, 'save status details');
  return Object.freeze({
    state: normalizedState,
    operation: inferOperation(normalizedState, details, previous),
    documentId: String(details.documentId || ''),
    phase: String(details.phase || ''),
    message: String(details.message || ''),
    progress: normalizeProgress(details.progress),
    pending: normalizeNonNegativeInteger(details.pending, 'Save status pending'),
    version: normalizeOptionalVersion(details.version, 'Save status version'),
    targetVersion: normalizeOptionalVersion(details.targetVersion, 'Save status targetVersion'),
    backendVersion: normalizeOptionalVersion(details.backendVersion, 'Save status backendVersion'),
    snapshotCreated: Boolean(details.snapshotCreated),
    revision
  });
}

function copyKnownEventFields(event, extras = {}) {
  const details = { ...extras, documentId: String(event.documentId || '') };
  for (const field of ['progress', 'pending', 'version', 'targetVersion', 'backendVersion', 'snapshotCreated']) {
    if (event[field] !== undefined && event[field] !== null) details[field] = event[field];
  }
  return details;
}

export function createSaveStatusStore() {
  let snapshot = DEFAULT_SNAPSHOT;
  let destroyed = false;
  const listeners = new Set();

  const assertActive = () => {
    if (destroyed) throw new Error('Save Status Store is destroyed.');
  };

  function publish(previous, current, reason) {
    const event = Object.freeze({ previous, current, reason });
    const errors = [];
    for (const listener of [...listeners]) {
      try { listener(event); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Save Status Store listeners failed.');
    return current;
  }

  function setState(state, details = {}, reason = 'set-state') {
    assertActive();
    const previous = snapshot;
    snapshot = createSnapshot(state, details, previous, previous.revision + 1);
    return publish(previous, snapshot, String(reason || 'set-state'));
  }

  function consumePersistenceEvent(event) {
    assertActive();
    if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
    const state = String(event.state || '');
    if (state === 'loading-index') {
      setState('loading', copyKnownEventFields(event, { operation: 'load', phase: 'index', progress: 0 }), 'native-loading-index');
    } else if (state === 'manifest') {
      setState('loading', copyKnownEventFields(event, { operation: 'load', phase: 'manifest', progress: 0 }), 'native-manifest');
    } else if (state === 'loading') {
      setState('loading', copyKnownEventFields(event, { operation: 'load', phase: 'content' }), 'native-loading');
    } else if (state === 'loaded') {
      setState('idle', copyKnownEventFields(event, { operation: 'load', phase: 'complete', progress: 1 }), 'native-loaded');
    } else if (state === 'load-error') {
      setState('error', copyKnownEventFields(event, {
        operation: 'load',
        phase: 'load',
        message: event.message || 'Document load failed.'
      }), 'native-load-error');
    } else if (state === 'queued') {
      setState('queued', copyKnownEventFields(event, { operation: 'save' }), 'native-queued');
    } else if (state === 'saving') {
      setState('saving', copyKnownEventFields(event, { operation: 'save' }), 'native-saving');
    } else if (state === 'saved') {
      const pending = normalizeNonNegativeInteger(event.pending, 'Native save pending');
      setState(pending > 0 ? 'queued' : 'saved', copyKnownEventFields(event, { operation: 'save', pending }), 'native-saved');
    } else if (state === 'error') {
      setState('error', copyKnownEventFields(event, {
        operation: 'save',
        message: event.message || 'Document save failed.'
      }), 'native-save-error');
    } else {
      return false;
    }
    return true;
  }

  return Object.freeze({
    get snapshot() {
      assertActive();
      return snapshot;
    },
    setState,
    consumePersistenceEvent,
    reset(reason = 'reset') {
      return setState('idle', { operation: 'idle' }, reason);
    },
    subscribe(listener) {
      assertActive();
      if (typeof listener !== 'function') throw new TypeError('Save Status Store listener must be a function.');
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
    }
  });
}
''', encoding='utf-8')

Path('src/features/persistence/compatibility/classic-save-status-store-port.js').write_text(r'''/**
 * Responsibility: Temporary scoped bridge exposing the canonical SaveStatusStore snapshot/subscription plus legacy save-workflow status intents to remaining classic scripts.
 * Imports: None; the Store instance is injected and no persistence/UI implementation may be imported.
 * Exports: mountClassicSaveStatusStorePort().
 * State/side effects: Owns only one non-enumerable compatibility-host property; it never copies status state or subscribes on behalf of callers.
 * Lifecycle: Explicit idempotent destroy() removes the scoped property and makes the bridge terminal without destroying the injected Store.
 */
const PORT_PROPERTY = 'markdownEditorSaveStatusStorePort';

function assertMountTarget(target) {
  if (!target || typeof target !== 'object') throw new TypeError('Classic Save Status Store port target must be an object.');
}

function assertStore(store) {
  if (!store || typeof store !== 'object') throw new TypeError('Classic Save Status Store port requires a Save Status Store.');
  for (const method of ['setState', 'reset', 'subscribe']) {
    if (typeof store[method] !== 'function') throw new TypeError(`Classic Save Status Store port requires ${method}().`);
  }
  if (!('snapshot' in store)) throw new TypeError('Classic Save Status Store port requires snapshot access.');
}

function normalizeLegacyDetails(value) {
  if (value === undefined) return {};
  if (typeof value === 'string') return { message: value };
  return value;
}

export function mountClassicSaveStatusStorePort(target, store) {
  assertMountTarget(target);
  assertStore(store);
  if (Object.hasOwn(target, PORT_PROPERTY)) throw new Error('Classic Save Status Store port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Classic Save Status Store port is destroyed.');
  };

  const api = Object.freeze({
    get snapshot() {
      assertActive();
      return store.snapshot;
    },
    subscribe(listener) {
      assertActive();
      return store.subscribe(listener);
    },
    setState(state, details) {
      assertActive();
      return store.setState(state, normalizeLegacyDetails(details), 'classic-workflow');
    },
    reset(reason) {
      assertActive();
      return store.reset(reason || 'classic-reset');
    }
  });

  Object.defineProperty(target, PORT_PROPERTY, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api
  });

  return Object.freeze({
    api,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (target[PORT_PROPERTY] === api) delete target[PORT_PROPERTY];
      if (typeof target.removeAttribute === 'function') target.removeAttribute(PORT_PROPERTY);
    }
  });
}
''', encoding='utf-8')

Path('src/features/persistence/index.js').write_text(r'''/**
 * Responsibility: Public Stage 10 Persistence contract; R10-01 exposes only SaveStatusStore and its scoped classic migration bridge.
 * Imports: Persistence feature modules only; callers must not import feature internals across this boundary.
 * Exports: SAVE_STATUS_STATES, createSaveStatusStore(), mountClassicSaveStatusStorePort().
 * State/side effects: Import-only facade with no runtime state, DOM, storage, platform or persistence side effects.
 * Lifecycle: Pure import facade; lifecycle belongs to exported explicit instances.
 */
export { SAVE_STATUS_STATES, createSaveStatusStore } from './state/save-status-store.js';
export { mountClassicSaveStatusStorePort } from './compatibility/classic-save-status-store-port.js';
''', encoding='utf-8')

Path('tests/stage-10-save-status-store.test.mjs').write_text(r'''import assert from 'node:assert/strict';
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

  assert.match(exportSource, /markdownEditorSaveStatusStorePort/);
  assert.match(exportSource, /exportSaveStatusStorePort\.setState\(/);
  assert.doesNotMatch(exportSource, /\bsetSaveStatus\s*\(/);

  const fixture = JSON.parse(fixtureText);
  const paths = new Set(fixture.modules.map(record => record[0]));
  for (const path of [
    'src/features/persistence/index.js',
    'src/features/persistence/state/save-status-store.js',
    'src/features/persistence/compatibility/classic-save-status-store-port.js'
  ]) assert.ok(paths.has(path), `production inventory must classify ${path}`);
});
''', encoding='utf-8')

replace_once(
    'src/main.js',
    "import { createNativeDocumentStore } from './storage/native-document-store.js';",
    "import { createNativeDocumentStore } from './storage/native-document-store.js';\nimport { createSaveStatusStore, mountClassicSaveStatusStorePort } from './features/persistence/index.js';"
)

replace_once(
    'src/main.js',
    "  const featureViews = [];",
    "  const saveStatusStore = createSaveStatusStore();\n  const saveStatusStorePort = mountClassicSaveStatusStorePort(compatibilityPlatformHost, saveStatusStore);\n  const unsubscribeNativeSaveStatus = window.markdownEditorDocumentStore.subscribe(event => {\n    saveStatusStore.consumePersistenceEvent(event);\n  });\n  let saveStatusFeatureDestroyed = false;\n  const destroySaveStatusFeature = () => {\n    if (saveStatusFeatureDestroyed) return;\n    saveStatusFeatureDestroyed = true;\n    unsubscribeNativeSaveStatus();\n    saveStatusStorePort.destroy();\n    saveStatusStore.destroy();\n  };\n\n  const featureViews = [];"
)

replace_once(
    'src/main.js',
    "  const destroyDocumentFeatures = () => {\n    if (documentFeaturesDestroyed) return;\n    documentFeaturesDestroyed = true;\n    destroySelectionSync();",
    "  const destroyDocumentFeatures = () => {\n    if (documentFeaturesDestroyed) return;\n    documentFeaturesDestroyed = true;\n    destroySelectionSync();\n    destroySaveStatusFeature();"
)

replace_once(
    'public/app/core.js',
    "const coreTaskSchedulerPort = coreCompatibilityHost?.markdownEditorTaskSchedulerPort;",
    "const coreTaskSchedulerPort = coreCompatibilityHost?.markdownEditorTaskSchedulerPort;\nconst coreSaveStatusStorePort = coreCompatibilityHost?.markdownEditorSaveStatusStorePort;"
)
replace_once(
    'public/app/core.js',
    "if (!coreTaskSchedulerPort) throw new Error('Task Scheduler compatibility port is unavailable.');",
    "if (!coreTaskSchedulerPort) throw new Error('Task Scheduler compatibility port is unavailable.');\nif (!coreSaveStatusStorePort) throw new Error('Save Status Store compatibility port is unavailable.');"
)
replace_once('public/app/core.js', "    let saveStatusState = 'saved';\n", '')

new_status_block = r'''    function getSaveStatusSnapshot() {
      return coreSaveStatusStorePort.snapshot;
    }

    function resolveSaveStatusMessage(snapshot, state) {
      const explicit = String(snapshot?.message || '');
      if (state === 'error') {
        if (explicit.startsWith('保存失败')) return explicit;
        return '保存失败：' + (explicit || '未知错误');
      }
      if (explicit) return explicit;
      if (state === 'queued') return '等待保存…';
      if (state === 'saving') {
        const progress = Number(snapshot?.progress);
        if (Number.isFinite(progress)) {
          return `正在分段创建安全快照… ${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`;
        }
        return snapshot?.backendVersion === 0 ? '正在创建安全快照…' : '正在后台保存…';
      }
      if (state === 'saved') return snapshot?.snapshotCreated ? '✓ 已保存并生成快照' : '✓ ' + t('saved');
      return '✓ ' + t('saved');
    }

    function renderSaveHint(snapshot = getSaveStatusSnapshot()) {
      const hint = document.getElementById('save-hint');
      if (!hint) return;
      const state = snapshot?.state === 'idle' ? 'saved' : String(snapshot?.state || 'saved');
      if (state === 'loading') return;
      clearTimeout(saveStatusResetTimer);
      saveStatusResetTimer = 0;
      hint.dataset.state = state;
      hint.textContent = resolveSaveStatusMessage(snapshot, state);
      hint.classList.toggle('show', state !== 'saved');
      if (state === 'saved') {
        hint.classList.add('show');
        saveStatusResetTimer = setTimeout(() => hint.classList.remove('show'), 1500);
      }
    }

    function updateStatusBar() {
      const statusLeft = document.getElementById('status-left');
      if (statusLeft) statusLeft.textContent = autoSaveEnabled
        ? `自动保存已启用 · ${Math.round(autoSaveDelay) / 1000} 秒`
        : '自动保存已关闭';
      if (!autoSaveEnabled) {
        clearTimeout(saveStatusResetTimer);
        saveStatusResetTimer = 0;
        const hint = document.getElementById('save-hint');
        if (hint) {
          hint.dataset.state = 'disabled';
          hint.textContent = '自动保存关闭';
          hint.classList.remove('show');
        }
        return;
      }
      renderSaveHint(getSaveStatusSnapshot());
    }

    function renderPersistenceStatus(snapshot) {
      if (!snapshot || (snapshot.documentId && snapshot.documentId !== getActiveDocumentId())) return;
      if (snapshot.operation === 'load') {
        const statusLeft = document.getElementById('status-left');
        if (!statusLeft) return;
        if (snapshot.state === 'loading') {
          if (snapshot.phase === 'index') statusLeft.textContent = '正在读取文档索引…';
          else if (snapshot.phase === 'manifest') statusLeft.textContent = '索引已恢复，正在读取正文…';
          else {
            const progress = Math.max(0, Math.min(100, Math.round((Number(snapshot.progress) || 0) * 100)));
            statusLeft.textContent = `正在分段恢复文档… ${progress}%`;
          }
        } else if (snapshot.state === 'error') {
          statusLeft.textContent = '文档恢复失败';
        } else if (snapshot.state === 'idle') {
          updateStatusBar();
        }
        return;
      }
      renderSaveHint(snapshot);
    }

    coreSaveStatusStorePort.subscribe(event => renderPersistenceStatus(event.current));
    renderPersistenceStatus(getSaveStatusSnapshot());

    window.markdownEditorDocumentStore?.subscribe?.(event => {
      if (!event || event.documentId !== getActiveDocumentId() || event.state !== 'manifest') return;
      const manifest = event.manifest || {};
      if (Array.isArray(manifest.headings)) {
        coreOutlineControllerPort.replaceIndex(manifest.headings, {
          version: 0,
          documentKey: event.documentId,
          changedHint: true,
          reason: 'native-manifest'
        });
        updateDocumentStatistics({
          characters: Number(manifest.textLength) || 0,
          lines: Number(manifest.lineCount) || 1,
          blocks: 0,
          headings: manifest.headings.length,
          nonWhitespaceCount: Number(manifest.nonWhitespaceCount) || 0,
          nativeIndex: true
        });
      }
    });

'''
replace_between(
    'public/app/core.js',
    "    function setSaveStatus(state, message = '') {",
    "    function toggleLangMenu() {",
    new_status_block
)
replace_once(
    'public/app/core.js',
    "      return !autoSaveEnabled || saveStatusState === 'queued' || saveStatusState === 'error';",
    "      const saveState = coreSaveStatusStorePort.snapshot.state;\n      return !autoSaveEnabled || saveState === 'queued' || saveState === 'error';"
)

replace_once(
    'public/app/export.js',
    "    const exportPresentationPort = exportCompatibilityHost?.markdownEditorPresentationPort;",
    "    const exportPresentationPort = exportCompatibilityHost?.markdownEditorPresentationPort;\n    const exportSaveStatusStorePort = exportCompatibilityHost?.markdownEditorSaveStatusStorePort;"
)
replace_once(
    'public/app/export.js',
    "    if (!exportPresentationPort) throw new Error('Presentation compatibility port is unavailable.');",
    "    if (!exportPresentationPort) throw new Error('Presentation compatibility port is unavailable.');\n    if (!exportSaveStatusStorePort) throw new Error('Save Status Store compatibility port is unavailable.');"
)
export_path = Path('public/app/export.js')
export_text = export_path.read_text(encoding='utf-8')
status_calls = export_text.count('setSaveStatus(')
if status_calls < 6:
    raise SystemExit(f'public/app/export.js: expected legacy save status calls, found {status_calls}')
export_path.write_text(export_text.replace('setSaveStatus(', 'exportSaveStatusStorePort.setState('), encoding='utf-8')

fixture_path = Path('tests/architecture/fixtures/production-modules.json')
fixture = json.loads(fixture_path.read_text(encoding='utf-8'))
additions = [
    ["src/features/persistence/compatibility/classic-save-status-store-port.js","esm-module","persistence-compatibility","Scoped temporary SaveStatusStore bridge for remaining classic save/status callers without copying canonical persistence status state.","classic-save-status-store-port-mount","explicit-instance","remove-after-migration",False],
    ["src/features/persistence/index.js","esm-facade","persistence-contract","Public Stage 10 Persistence contract exposing Atomic 10.1 SaveStatusStore and its scoped classic migration bridge only.","none","import-only","retain",False],
    ["src/features/persistence/state/save-status-store.js","esm-module","persistence-state","Authoritative immutable save/load lifecycle status owner with native-event normalization, monotonic revision and irreversible terminal destruction.","save-status-store","explicit-instance","retain",False]
]
by_path = {record[0]: record for record in fixture['modules']}
for record in additions:
    existing = by_path.get(record[0])
    if existing is not None and existing != record:
        raise SystemExit(f'production fixture already contains conflicting record: {record[0]}')
    if existing is None:
        fixture['modules'].append(record)
fixture['modules'].sort(key=lambda record: record[0])
fixture_path.write_text(json.dumps(fixture, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

readme = '''# Markdown Editor

Markdown Editor 是基于 Tauri + Rust + 原生 HTML/CSS/JavaScript 的本地轻量 Markdown 编辑器，正在按阶段执行除冻结模型内核外的模块化重写。

项目架构与长期记录见 [docs/README.md](docs/README.md)；R9-12 与 R10-01 的实施边界、兼容性和验证详情分别见 [docs/R9-12-DETAILS.md](docs/R9-12-DETAILS.md) 与 [docs/R10-01-DETAILS.md](docs/R10-01-DETAILS.md)。
'''
if not 120 <= len(readme.strip()) <= 360:
    raise SystemExit(f'root README must remain 120-360 characters, got {len(readme.strip())}')
Path('README.md').write_text(readme, encoding='utf-8')

permanent_workflow = r'''name: R10-01 Save Status Store

on:
  push:
    branches:
      - agent/r10-stage
  workflow_dispatch:

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Guard R10-01 scope, frozen contracts and inventory
        shell: bash
        run: |
          set -euo pipefail
          base='1c90fe1ae9cdb315352585a2e04729f9f4b975ee'
          git merge-base --is-ancestor "$base" HEAD
          git diff --quiet "$base"...HEAD -- \
            src/model-kernel/index.js \
            src/document/document-model.js \
            src/sync/selection-mapping.js \
            src/preview/incremental-preview.js \
            src/preview/math-source.js \
            src/editor/hybrid/block-registry.js \
            src/editor/hybrid/math-ranges.js \
            src/editor/hybrid/ranges.js \
            src/editor/hybrid/table-model.js \
            src-tauri/src/document_store.rs \
            package.json package-lock.json
          test ! -e src/features/persistence/application/save-controller.js
          test ! -e src/features/persistence/application/autosave-controller.js
          test ! -e src/features/persistence/native-document-store/native-save-session.js
          node - <<'NODE'
          const fs = require('node:fs');
          const fixture = JSON.parse(fs.readFileSync('tests/architecture/fixtures/production-modules.json', 'utf8'));
          if (!Array.isArray(fixture.modules) || fixture.modules.length !== 384) {
            throw new Error(`R10-01 production module inventory drift: expected 384, got ${fixture.modules?.length}`);
          }
          for (const path of [
            'src/features/persistence/index.js',
            'src/features/persistence/state/save-status-store.js',
            'src/features/persistence/compatibility/classic-save-status-store-port.js'
          ]) {
            if (!fixture.modules.some(record => record[0] === path)) throw new Error(`Missing production inventory record: ${path}`);
          }
          NODE
          git diff --check

      - name: Audit production dependencies
        run: npm audit --audit-level=high

      - name: R10-01 targeted gate 5/5
        shell: bash
        run: |
          set -euo pipefail
          node --test tests/stage-10-save-status-store.test.mjs | tee /tmp/r10_01_targeted.log
          grep -q '# tests 5' /tmp/r10_01_targeted.log
          grep -q '# pass 5' /tmp/r10_01_targeted.log
          grep -q '# fail 0' /tmp/r10_01_targeted.log

      - name: Full Node regression
        run: npm test

      - name: Architecture and documentation gates
        shell: bash
        run: |
          set -euo pipefail
          npm run verify:architecture
          npm run verify:no-legacy-runtime
          npm run verify:generated-files
          npm run verify:readme-record

      - name: Browser preview contract 10/10
        shell: bash
        run: |
          set -euo pipefail
          npm run test:browser:contract | tee /tmp/r10_01_browser_contract.log
          grep -Fq 'Browser tests: 10, passed: 10, failed: 0' /tmp/r10_01_browser_contract.log

      - name: Production build
        run: npm run build

      - name: Built-app browser regression 29/29
        shell: bash
        run: |
          set -euo pipefail
          npm run test:browser | tee /tmp/r10_01_browser.log
          grep -Fq 'Browser tests: 29, passed: 29, failed: 0' /tmp/r10_01_browser.log

      - name: Validation must leave tracked tree clean
        shell: bash
        run: |
          set -euo pipefail
          git diff --check
          git diff --exit-code
'''
Path('.github/workflows/r10-01.yml').write_text(permanent_workflow, encoding='utf-8')
