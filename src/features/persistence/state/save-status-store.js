/**
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
