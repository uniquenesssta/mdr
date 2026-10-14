const BUFFER_FIELDS = [['queueLength', 'queueLength'], ['aggregateCount', 'aggregateCount'],
  ['queueOverflowEntries', 'overflowEntries'], ['queueOverflowSamples', 'overflowSamples'],
  ['unconfirmedLogEntries', 'unconfirmedEntries'], ['acknowledgedLogEntries', 'acknowledgedEntries']];
const SCROLL_FIELDS = [['scrollSourceSwitches', 'sourceSwitches'], ['scrollTargetWrites', 'targetWrites'],
  ['scrollIgnoredTargetEvents', 'ignoredTargetEvents'], ['scrollGeometryResyncs', 'geometryResyncs']];
const SELECTION_FIELDS = [['selectionPreviewRevision', 'previewRevision'], ['selectionPreviewRefreshes', 'previewRefreshes'],
  ['selectionPendingRetries', 'pendingRetries'], ['selectionMappingFailures', 'mappingFailures'], ['selectionIgnoredFeedbackEvents', 'ignoredFeedbackEvents']];

/** Own fixed-schema, bounded synchronous sampling and one injected recurring timer. */
export function createRuntimeSnapshotRecorder({ getDocument, getMemory, getViewport, getBufferStats,
  getRuntimeStats, record, schedule, cancel, isEnabled = () => true, onError = () => {},
  maxDomNodes = 10000, intervalMs = 30000 } = {}) {
  for (const [name, value] of Object.entries({ getDocument, getMemory, getViewport, getBufferStats, getRuntimeStats, record, schedule, cancel, isEnabled, onError })) {
    if (typeof value !== 'function') throw new TypeError(`RuntimeSnapshotRecorder requires ${name}`);
  }
  if (!Number.isInteger(maxDomNodes) || maxDomNodes < 1 || maxDomNodes > 10000) throw new TypeError('Invalid DOM node limit');
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 300000) throw new TypeError('Invalid snapshot interval');
  let running = false, destroyed = false, sampling = false, stopping = false, timer = null, generation = 0, cleanupFailed = false;
  let samples = 0, failures = 0, lastFailure = '';
  const increment = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1);
  const current = token => !destroyed && token === generation;
  function report(phase) {
    failures = increment(failures); lastFailure = phase;
    try { onError(phase); } catch (_) { /* Diagnostic failures cannot interrupt application work. */ }
  }
  function read(port, phase, fallback, token) {
    if (!current(token)) return fallback;
    try { return port(); } catch (_) { report(phase); return fallback; }
  }
  function field(object, key, phase, fallback, token) {
    if (!current(token)) return fallback;
    try { return object?.[key]; } catch (_) { report(phase); return fallback; }
  }
  const counter = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)) : fallback;
  function counters(details, object, fields, phase, token) {
    for (const [output, input] of fields) details[output] = counter(field(object, input, phase, 0, token));
  }
  function domCount(token) {
    const document = read(getDocument, 'dom', null, token);
    if (!current(token) || !document) return { domNodes: null, domNodesCapped: false };
    try {
      const createWalker = document.createTreeWalker;
      if (!current(token) || typeof createWalker !== 'function') return { domNodes: null, domNodesCapped: false };
      // Document root includes every element; SHOW_ELEMENT = 0x1. Never allocate a whole NodeList.
      const walker = createWalker.call(document, document, 0x1);
      const advance = walker.nextNode;
      let count = 0;
      while (current(token) && count < maxDomNodes) {
        const node = advance.call(walker);
        if (!current(token)) return { domNodes: null, domNodesCapped: false };
        if (!node) return { domNodes: count, domNodesCapped: false };
        count++;
      }
      return { domNodes: count, domNodesCapped: count === maxDomNodes };
    } catch (_) { report('dom'); return { domNodes: null, domNodesCapped: false }; }
  }
  function sample() {
    if (destroyed || sampling) return false;
    const token = generation; sampling = true;
    try {
      const details = domCount(token);
      const memory = read(getMemory, 'memory', null, token);
      details.usedHeapBytes = counter(field(memory, 'usedJSHeapSize', 'memory', null, token), null);
      details.totalHeapBytes = counter(field(memory, 'totalJSHeapSize', 'memory', null, token), null);
      counters(details, read(getBufferStats, 'buffer', null, token), BUFFER_FIELDS, 'buffer', token);
      const viewport = read(getViewport, 'viewport', null, token);
      details.viewportWidth = counter(field(viewport, 'width', 'viewport', 0, token));
      details.viewportHeight = counter(field(viewport, 'height', 'viewport', 0, token));
      const runtime = read(getRuntimeStats, 'runtime', null, token);
      const scroll = field(runtime, 'scrollSync', 'scroll', null, token);
      const selection = field(runtime, 'selectionSync', 'selection', null, token);
      const side = field(scroll, 'sourceSide', 'scroll', '', token);
      details.scrollSourceSide = side === 'editor' || side === 'preview' ? side : '';
      counters(details, scroll, SCROLL_FIELDS, 'scroll', token);
      counters(details, selection, SELECTION_FIELDS, 'selection', token);
      if (!current(token)) return false;
      record('runtime.snapshot', { category: 'runtime.performance', details });
      if (!current(token)) return false;
      samples = increment(samples); return true;
    } catch (_) { report('record'); return false; }
    finally { sampling = false; }
  }
  function clear(handle) {
    if (handle === null) return;
    try { cancel(handle); } catch (_) { cleanupFailed = true; report('cancel'); }
  }
  function stop() {
    if (destroyed || stopping) return;
    generation++; running = false; stopping = true;
    const previous = timer; timer = null;
    try { clear(previous); } finally { stopping = false; }
  }
  function allowed() {
    try { return Boolean(isEnabled()); } catch (_) { report('enabled'); return false; }
  }
  function arm() {
    if (destroyed || !running || timer !== null) return;
    const token = generation;
    try {
      const handle = schedule(() => {
        if (!current(token) || !running) return;
        timer = null;
        if (!allowed()) { if (current(token)) stop(); return; }
        if (!current(token) || !running) return;
        sample();
        if (current(token) && running) arm();
      }, intervalMs);
      if (handle == null) throw new TypeError('Invalid timer handle');
      if (current(token) && running) timer = handle;
      else clear(handle);
    } catch (_) { if (current(token)) { generation++; running = false; timer = null; report('schedule'); } }
  }
  function start() {
    if (destroyed || stopping || cleanupFailed) return false;
    const token = generation;
    if (!allowed()) { if (current(token)) stop(); return false; }
    if (!current(token)) return false;
    if (running) return true;
    running = true; arm(); return running && !destroyed;
  }
  function destroy() {
    if (destroyed) return;
    stop(); destroyed = true; generation++;
  }
  return Object.freeze({ sample, start, stop, destroy, getState: () => Object.freeze({ running, destroyed,
    scheduled: timer !== null, sampling, samples, failures, lastFailure, cleanupFailed, maxDomNodes, intervalMs }) });
}
