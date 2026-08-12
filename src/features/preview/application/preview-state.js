/**
 * Responsibility: Own the authoritative DOM-free preview runtime state for resolved mode, render version, lifecycle status, last stable metadata, focus section and error.
 * Imports: None.
 * Exports: createPreviewState().
 * State/side effects: Immutable in-memory snapshots and synchronous subscriptions only; no DOM, storage, timers, Worker, platform or rendering access.
 * Lifecycle: Explicit destroy; destroy clears subscribers and makes all reads and writes terminal.
 */
const PREVIEW_MODES = new Set(['full', 'virtual', 'chapter', 'hybrid']);
const PREVIEW_STATUSES = new Set(['idle', 'rendering', 'stable', 'degraded', 'suspended', 'error']);
const FOCUS_SECTION_FIELDS = new Set(['headingId', 'startLine', 'endLine', 'startIndex', 'endIndex', 'focusIndex']);
const STABLE_RESULT_FIELDS = new Set([
  'scopeKey',
  'renderMode',
  'sourceLength',
  'blockCount',
  'mountedBlocks',
  'documentVersion'
]);
const ERROR_FIELDS = new Set(['name', 'message', 'source']);

const DEFAULT_SNAPSHOT = Object.freeze({
  mode: 'full',
  version: 0,
  status: 'idle',
  lastStableResult: null,
  focusSection: null,
  error: null
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

function normalizeMode(value) {
  const mode = String(value || '');
  if (!PREVIEW_MODES.has(mode)) throw new RangeError(`Unsupported Preview mode: ${mode || '<empty>'}.`);
  return mode;
}

function normalizeStatus(value) {
  const status = String(value || '');
  if (!PREVIEW_STATUSES.has(status)) throw new RangeError(`Unsupported Preview status: ${status || '<empty>'}.`);
  return status;
}

function normalizeVersion(value, label = 'Preview version') {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 0) throw new TypeError(`${label} must be a non-negative safe integer.`);
  return version;
}

function normalizeNonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${label} must be a non-negative finite number.`);
  return Math.trunc(number);
}

function normalizePositiveInteger(value, label) {
  const number = normalizeNonNegativeInteger(value, label);
  if (number < 1) throw new TypeError(`${label} must be at least 1.`);
  return number;
}

function normalizeFocusSection(value) {
  if (value === undefined || value === null) return null;
  const section = assertPlainObject(value, 'Preview focus section');
  rejectUnknownFields(section, FOCUS_SECTION_FIELDS, 'Preview focus section');
  const normalized = {};
  if (Object.hasOwn(section, 'headingId')) normalized.headingId = String(section.headingId || '');
  if (Object.hasOwn(section, 'startLine')) normalized.startLine = normalizePositiveInteger(section.startLine, 'Preview focus startLine');
  if (Object.hasOwn(section, 'endLine')) normalized.endLine = normalizePositiveInteger(section.endLine, 'Preview focus endLine');
  if (Object.hasOwn(section, 'startIndex')) normalized.startIndex = normalizeNonNegativeInteger(section.startIndex, 'Preview focus startIndex');
  if (Object.hasOwn(section, 'endIndex')) normalized.endIndex = normalizeNonNegativeInteger(section.endIndex, 'Preview focus endIndex');
  if (Object.hasOwn(section, 'focusIndex')) normalized.focusIndex = normalizeNonNegativeInteger(section.focusIndex, 'Preview focus focusIndex');
  if (normalized.startLine !== undefined && normalized.endLine !== undefined && normalized.endLine < normalized.startLine) {
    throw new RangeError('Preview focus endLine must not precede startLine.');
  }
  if (normalized.startIndex !== undefined && normalized.endIndex !== undefined && normalized.endIndex < normalized.startIndex) {
    throw new RangeError('Preview focus endIndex must not precede startIndex.');
  }
  return Object.freeze(normalized);
}

function normalizeStableResult(value) {
  const result = assertPlainObject(value, 'Preview stable result');
  rejectUnknownFields(result, STABLE_RESULT_FIELDS, 'Preview stable result');
  const scopeKey = String(result.scopeKey || '');
  const renderMode = String(result.renderMode || '');
  if (!scopeKey) throw new TypeError('Preview stable result scopeKey is required.');
  if (!renderMode) throw new TypeError('Preview stable result renderMode is required.');
  return Object.freeze({
    scopeKey,
    renderMode,
    sourceLength: normalizeNonNegativeInteger(result.sourceLength ?? 0, 'Preview stable sourceLength'),
    blockCount: normalizeNonNegativeInteger(result.blockCount ?? 0, 'Preview stable blockCount'),
    mountedBlocks: normalizeNonNegativeInteger(result.mountedBlocks ?? 0, 'Preview stable mountedBlocks'),
    documentVersion: normalizeNonNegativeInteger(result.documentVersion ?? 0, 'Preview stable documentVersion')
  });
}

function normalizeError(value) {
  if (value === undefined || value === null) return null;
  const error = assertPlainObject(value, 'Preview error');
  rejectUnknownFields(error, ERROR_FIELDS, 'Preview error');
  const name = String(error.name || 'Error');
  const message = String(error.message || 'Preview operation failed.');
  const source = String(error.source || 'preview');
  return Object.freeze({ name, message, source });
}

function freezeSnapshot(source) {
  return Object.freeze({
    mode: source.mode,
    version: source.version,
    status: source.status,
    lastStableResult: source.lastStableResult,
    focusSection: source.focusSection,
    error: source.error
  });
}

function sameFocusSection(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (left[key] !== right[key]) return false;
  return true;
}

export function createPreviewState() {
  let snapshot = DEFAULT_SNAPSHOT;
  let destroyed = false;
  const listeners = new Set();

  const assertActive = () => {
    if (destroyed) throw new Error('Preview State is destroyed.');
  };

  function publish(previous, current, reason) {
    if (previous === current) return current;
    const event = Object.freeze({ previous, current, reason });
    const errors = [];
    for (const listener of [...listeners]) {
      try { listener(event); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Preview State listeners failed.');
    return current;
  }

  function replace(next, reason) {
    const previous = snapshot;
    snapshot = freezeSnapshot(next);
    return publish(previous, snapshot, reason);
  }

  function isCurrentVersion(version) {
    assertActive();
    return normalizeVersion(version) === snapshot.version;
  }

  function beginRender() {
    assertActive();
    const version = snapshot.version + 1;
    replace({ ...snapshot, version, status: 'rendering' }, 'begin-render');
    return version;
  }

  function setFocusSection(version, focusSection) {
    assertActive();
    if (normalizeVersion(version) !== snapshot.version) return false;
    const normalized = normalizeFocusSection(focusSection);
    if (sameFocusSection(snapshot.focusSection, normalized)) return true;
    replace({ ...snapshot, focusSection: normalized }, 'focus-section');
    return true;
  }

  function commitStable(version, payload) {
    assertActive();
    if (normalizeVersion(version) !== snapshot.version) return false;
    const changes = assertPlainObject(payload, 'Preview stable commit');
    const allowed = new Set(['mode', 'focusSection', 'result', 'clearError']);
    rejectUnknownFields(changes, allowed, 'Preview stable commit');
    const mode = normalizeMode(changes.mode);
    const focusSection = Object.hasOwn(changes, 'focusSection')
      ? normalizeFocusSection(changes.focusSection)
      : snapshot.focusSection;
    const lastStableResult = normalizeStableResult(changes.result);
    const error = changes.clearError === false ? snapshot.error : null;
    replace({ ...snapshot, mode, status: 'stable', lastStableResult, focusSection, error }, 'stable');
    return true;
  }

  function commitDegraded(version, payload) {
    assertActive();
    if (normalizeVersion(version) !== snapshot.version) return false;
    const changes = assertPlainObject(payload, 'Preview degraded commit');
    const allowed = new Set(['mode', 'focusSection', 'result', 'error']);
    rejectUnknownFields(changes, allowed, 'Preview degraded commit');
    const mode = normalizeMode(changes.mode ?? snapshot.mode);
    const focusSection = Object.hasOwn(changes, 'focusSection')
      ? normalizeFocusSection(changes.focusSection)
      : snapshot.focusSection;
    const lastStableResult = Object.hasOwn(changes, 'result')
      ? normalizeStableResult(changes.result)
      : snapshot.lastStableResult;
    const error = normalizeError(changes.error);
    replace({ ...snapshot, mode, status: 'degraded', lastStableResult, focusSection, error }, 'degraded');
    return true;
  }

  function failRender(version, payload) {
    assertActive();
    if (normalizeVersion(version) !== snapshot.version) return false;
    const changes = assertPlainObject(payload, 'Preview failed render');
    const allowed = new Set(['mode', 'focusSection', 'error']);
    rejectUnknownFields(changes, allowed, 'Preview failed render');
    const mode = Object.hasOwn(changes, 'mode') ? normalizeMode(changes.mode) : snapshot.mode;
    const focusSection = Object.hasOwn(changes, 'focusSection')
      ? normalizeFocusSection(changes.focusSection)
      : snapshot.focusSection;
    const error = normalizeError(changes.error);
    replace({ ...snapshot, mode, status: 'error', focusSection, error }, 'error');
    return true;
  }

  function invalidate(options = {}) {
    assertActive();
    const changes = assertPlainObject(options, 'Preview invalidation');
    const allowed = new Set(['mode', 'status', 'clearStable', 'clearError', 'focusSection']);
    rejectUnknownFields(changes, allowed, 'Preview invalidation');
    const version = snapshot.version + 1;
    const mode = Object.hasOwn(changes, 'mode') ? normalizeMode(changes.mode) : snapshot.mode;
    const status = Object.hasOwn(changes, 'status') ? normalizeStatus(changes.status) : 'idle';
    const lastStableResult = changes.clearStable === true ? null : snapshot.lastStableResult;
    const error = changes.clearError === true ? null : snapshot.error;
    const focusSection = Object.hasOwn(changes, 'focusSection')
      ? normalizeFocusSection(changes.focusSection)
      : snapshot.focusSection;
    replace({ mode, version, status, lastStableResult, focusSection, error }, 'invalidate');
    return version;
  }

  return Object.freeze({
    get snapshot() {
      assertActive();
      return snapshot;
    },
    beginRender,
    isCurrentVersion,
    setFocusSection,
    commitStable,
    commitDegraded,
    failRender,
    invalidate,
    subscribe(listener) {
      assertActive();
      if (typeof listener !== 'function') throw new TypeError('Preview State listener must be a function.');
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
