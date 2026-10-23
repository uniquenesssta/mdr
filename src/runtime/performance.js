import { createTelemetryRecorder, redactTelemetryIdentity, createAggregationBuffer, createLongTaskObserver, createRuntimeSnapshotRecorder, createNativeLogSink, createTelemetryLifecycle, connectTelemetryRecorder } from '../features/telemetry/index.js';

const sessionId = globalThis.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const diagnosticStates = new Map();
let telemetryLifecycle = null;
let telemetryDestroyed = false, destructionReport = null, pendingHandoff = null;
let disconnectRecorder = null;
let eventTimingSeen = false, navigationSeen = false;
const MAX_DIAGNOSTIC_KEYS = 200;
const FLUSH_INTERVAL_MS = 2000;
const AGGREGATE_INTERVAL_MS = 1500;
const DEFAULT_DIAGNOSTIC_INTERVAL_MS = 5000;
let platformLogs = null;
let platformLogsEnabled = false;
let runtimeStatsProvider = () => ({});

let buffer, recorder, nativeLogSink, longTaskObserver;
function initializeTelemetry() {
  if (recorder || telemetryDestroyed) return;
  recorder = createTelemetryRecorder({
    sessionId, now: timestampMs, monotonicNow: () => performance.now(),
    emit: entry => buffer.enqueue(entry), aggregate: (operation, options) => buffer.aggregate(operation, options)
  });
  nativeLogSink = createNativeLogSink({ write: (entries, meta) => platformLogs.writePerformance(entries, meta),
    schedule: (callback, delay) => setTimeout(callback, delay), cancel: timer => clearTimeout(timer),
    isEnabled: () => platformLogsEnabled });
  buffer = createAggregationBuffer({ now: timestampMs, createEntry: recorder.createEntry, batchPrefix: sessionId,
    schedule: (callback, delay) => setTimeout(callback, delay), cancel: timer => clearTimeout(timer),
    onError: marker => console.warn('Performance log flush failed:', marker),
    writeBatch: (entries, meta) => nativeLogSink.writeBatch(entries, meta)
  });
  longTaskObserver = createLongTaskObserver({
    getObserver: () => typeof PerformanceObserver === 'undefined' ? null : PerformanceObserver,
    isEnabled: () => import.meta.env.DEV && platformLogsEnabled, record,
    onError: phase => console.warn('Performance long-task observer failed:', phase)
  });
  buffer.setEnabled(platformLogsEnabled);
}
const record = (...args) => { if (telemetryDestroyed) return; initializeTelemetry(); return recorder.record(...args); };
const measure = (operation, callback, options) => { if (telemetryDestroyed) return callback(); initializeTelemetry(); return recorder.measure(operation, callback, options); };
const makeEntry = (...args) => { initializeTelemetry(); return recorder.createEntry(...args); };
const safeDetails = (...args) => { initializeTelemetry(); return recorder.normalizeDetails(...args); };
const drainAggregates = () => { if (telemetryDestroyed) return; initializeTelemetry(); return buffer.drainAggregates(); };
const flush = () => { if (telemetryDestroyed) return Promise.resolve(buffer?.getStats()); initializeTelemetry(); return buffer.flush(); };
export function getPerformanceBufferStats() { initializeTelemetry(); return buffer?.getStats() || Object.freeze({ destroyed: telemetryDestroyed, queueLength: 0, aggregateCount: 0 }); }

let runtimeSnapshotRecorder = null;
function getRuntimeSnapshotRecorder() {
  if (!runtimeSnapshotRecorder) runtimeSnapshotRecorder = createRuntimeSnapshotRecorder({
    getDocument: () => typeof document === 'undefined' ? null : document,
    getMemory: () => performance.memory,
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    getBufferStats: getPerformanceBufferStats,
    getRuntimeStats: () => runtimeStatsProvider(), record,
    schedule: (callback, delay) => setTimeout(callback, delay), cancel: timer => clearTimeout(timer),
    isEnabled: () => import.meta.env.DEV && platformLogsEnabled,
    onError: phase => console.warn('Performance runtime snapshot failed:', phase)
  });
  return runtimeSnapshotRecorder;
}
const recordRuntimeSnapshot = () => { if (!telemetryDestroyed) return getRuntimeSnapshotRecorder().sample(); };


export function configurePerformanceRuntimeStats(provider) {
  if (typeof provider !== 'function') throw new TypeError('performance runtime stats provider must be a function');
  if (!telemetryDestroyed) runtimeStatsProvider = provider;
}

export function configurePerformancePlatform({ logs, enabled = false } = {}) {
  if (!logs || typeof logs.writePerformance !== 'function') {
    throw new TypeError('performance runtime requires a logs port');
  }
  if (telemetryDestroyed) return;
  platformLogs = logs;
  platformLogsEnabled = Boolean(enabled);
  if (!import.meta.env.DEV) { buffer?.setEnabled(platformLogsEnabled); return; }
  if (platformLogsEnabled) getTelemetryLifecycle().start();
  else telemetryLifecycle?.stop();
}

function cleanupOwners(destroy = false) {
  let failed = false;
  const actions = destroy ? [() => nativeLogSink?.destroy(), () => runtimeSnapshotRecorder?.destroy(),
    () => longTaskObserver?.destroy(), () => { try { pendingHandoff = buffer?.destroy() ?? null; } catch (error) { pendingHandoff = buffer?.snapshot() ?? null; throw error; } }, () => recorder?.destroy()]
    : [() => buffer?.setEnabled(false), () => longTaskObserver?.stop(), () => runtimeSnapshotRecorder?.stop()];
  for (const action of actions) try { action(); } catch (_) { failed = true; }
  if (longTaskObserver?.getState().cleanupFailed || runtimeSnapshotRecorder?.getState().cleanupFailed || nativeLogSink?.getState().cleanupFailed) failed = true;
  if (failed) throw new Error('Telemetry owner cleanup failed');
  return pendingHandoff;
}
function getTelemetryLifecycle() {
  if (!telemetryLifecycle && !telemetryDestroyed) {
    initializeTelemetry();
    telemetryLifecycle = createTelemetryLifecycle({ getWindow: () => window, getDocument: () => document,
      isEnabled: () => import.meta.env.DEV && platformLogsEnabled,
      schedule: (callback, delay) => setTimeout(callback, delay), cancel: timer => clearTimeout(timer),
      requestFrame: callback => requestAnimationFrame(callback), cancelFrame: frame => cancelAnimationFrame(frame),
      install(scope) {
        installInteractionTracking(scope); installPerformanceObservers(scope); installErrorTracking(scope);
      },
      startOwners() {
        buffer.setEnabled(platformLogsEnabled); longTaskObserver.start();
        if (import.meta.env.DEV) getRuntimeSnapshotRecorder().start();
      },
      stopOwners: () => cleanupOwners(), destroyOwners: () => cleanupOwners(true),
      drain: drainAggregates, flush, aggregateMs: AGGREGATE_INTERVAL_MS, flushMs: FLUSH_INTERVAL_MS,
      onError: phase => console.warn('Performance lifecycle failed:', phase)
    });
  }
  return telemetryLifecycle;
}
export function destroyPerformanceTelemetry() {
  if (telemetryDestroyed) return destructionReport;
  telemetryDestroyed = true;
  let lifecycleReport;
  try {
    if (telemetryLifecycle) lifecycleReport = telemetryLifecycle.destroy();
    else cleanupOwners(true);
  } catch (_) { lifecycleReport = { cleanupFailed: true }; }
  let cleanupFailed = Boolean(lifecycleReport?.cleanupFailed);
  disconnectRecorder?.(); disconnectRecorder = null;
  diagnosticStates.clear(); platformLogsEnabled = false; platformLogs = null;
  runtimeStatsProvider = () => ({});
  destructionReport = Object.freeze({ state: 'destroyed', cleanupFailed, handoff: pendingHandoff });
  return destructionReport;
}

function timestampMs() {
  return Date.now();
}

function cleanString(value, maxLength = 160) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function diagnostic(operation, options = {}) {
  if (telemetryDestroyed || typeof operation !== 'string' || !operation.trim()) return false;
  const now = timestampMs();
  const details = safeDetails(options.details);
  const key = redactTelemetryIdentity(options.dedupeKey || `${options.category || 'runtime.diagnostic'}:${operation}`, 240);
  const fingerprint = redactTelemetryIdentity(
    options.fingerprint || JSON.stringify(details),
    500
  );
  const minIntervalMs = Math.max(250, Number(options.minIntervalMs) || DEFAULT_DIAGNOSTIC_INTERVAL_MS);
  const previous = diagnosticStates.get(key);

  if (previous && previous.fingerprint === fingerprint && now - previous.lastEmittedAt < minIntervalMs) {
    previous.suppressed += 1;
    previous.lastSeenAt = now;
    diagnosticStates.set(key, previous);
    return false;
  }

  const suppressedDuplicates = previous?.suppressed || 0;
  diagnosticStates.set(key, {
    fingerprint,
    lastEmittedAt: now,
    lastSeenAt: now,
    suppressed: 0
  });
  if (diagnosticStates.size > MAX_DIAGNOSTIC_KEYS) {
    const oldestKey = [...diagnosticStates.entries()]
      .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)[0]?.[0];
    if (oldestKey) diagnosticStates.delete(oldestKey);
  }

  buffer.enqueue(makeEntry(operation, {
    ...options,
    category: options.category || 'runtime.diagnostic',
    details: {
      ...details,
      suppressedDuplicates
    }
  }));
  return true;
}

function describeElement(element) {
  if (!(element instanceof Element)) return 'unknown';
  const tableCell = element.closest('[data-hybrid-table-cell-key]');
  if (tableCell) {
    const table = tableCell.closest('[data-hybrid-table-from]');
    return cleanString(`hybrid-table-cell:${table?.dataset?.hybridTableFrom || 'unknown'}:${tableCell.dataset.hybridTableCellKey || 'unknown'}`, 140);
  }
  const hybridBlock = element.closest('[data-hybrid-block-type]');
  if (hybridBlock) {
    const type = hybridBlock.dataset.hybridBlockType || 'unknown';
    const position = hybridBlock.dataset.hybridCodeFrom
      || hybridBlock.dataset.hybridTableFrom
      || hybridBlock.dataset.hybridMathFrom
      || '';
    const zone = element.closest('[data-hybrid-double-zone]')?.dataset?.hybridDoubleZone || '';
    return cleanString(`hybrid-${type}${position ? `:${position}` : ''}${zone ? `:${zone}` : ''}`, 140);
  }
  if (element.closest('[data-hybrid-inline-math]')) return 'hybrid-inline-math';
  const editorRoot = element.closest('#editor, #preview');
  if (editorRoot) return `${editorRoot.tagName.toLowerCase()}#${editorRoot.id}`;
  const id = element.id ? `#${element.id}` : '';
  const role = element.getAttribute('role');
  const action = element.getAttribute('onclick') || element.dataset?.action || '';
  const canUseText = element.matches('button, a, [role="menuitem"], .menu-item, .doc-item');
  const label = element.getAttribute('aria-label') || element.title || (canUseText ? element.textContent : '') || '';
  return cleanString(`${element.tagName.toLowerCase()}${id}${role ? `[${role}]` : ''} ${action || label}`, 140);
}

function installInteractionTracking(scope) {
  const paintTrackedEvents = ['click', 'change', 'contextmenu', 'drop'];
  for (const eventName of paintTrackedEvents) {
    scope.listen(document, eventName, event => {
      const started = performance.now();
      const target = event.target instanceof Element ? event.target.closest('button, a, input, select, textarea, [onclick], [role="menuitem"], .doc-item') || event.target : null;
      const clickCount = eventName === 'click' && event instanceof MouseEvent
        ? Number(event.detail) || 0
        : null;
      scope.frame(() => {
        scope.frame(() => {
          record(`interaction.${eventName}`, {
            category: 'ui.interaction',
            durationMs: performance.now() - started,
            details: {
              target: describeElement(target),
              ...(clickCount === null ? {} : { clickCount })
            }
          });
        });
      });
    }, true);
  }

  scope.listen(document, 'keydown', event => {
    if (!(event.ctrlKey || event.metaKey || event.altKey || /^F\d+$/.test(event.key))) return;
    record('interaction.shortcut', {
      category: 'ui.interaction',
      details: {
        key: [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.shiftKey ? 'Shift' : '', event.altKey ? 'Alt' : '', event.key]
          .filter(Boolean)
          .join('+'),
        target: describeElement(event.target)
      }
    });
  }, true);

  scope.listen(document, 'input', event => {
    const started = performance.now();
    scope.frame(() => {
      const target = event.target;
      record('interaction.input.frame', {
        category: 'ui.interaction',
        durationMs: performance.now() - started,
        aggregate: true,
        details: {
          target: describeElement(target),
          valueLength: typeof target?.value === 'string' ? target.value.length : null
        }
      });
    });
  }, true);

  const scrollStates = new WeakMap();
  scope.listen(document, 'scroll', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // CodeMirror 的原生滚动会转发为编辑器宿主事件，忽略内部 scroller，
    // 避免同一次滚动在日志中出现两条完全相同的 burst。
    if (target.classList.contains('cm-scroller') && target.closest('.virtual-editor-host')) return;
    const scrollClassification = runtimeStatsProvider()?.classifyScrollTarget?.(target) || null;
    // 目标侧联动滚动和虚拟高度补偿不是用户交互，不计入交互 burst。
    // 否则日志会把一次编辑器滚动误报为编辑器、预览两次滚动。
    if (scrollClassification && scrollClassification.origin !== 'user') return;
    const current = scrollStates.get(target) || {
      started: performance.now(),
      count: 0,
      timer: null
    };
    current.count += 1;
    current.timer?.();
    current.timer = scope.timeout(() => {
      record('interaction.scroll.burst', {
        category: 'ui.interaction',
        durationMs: performance.now() - current.started,
        details: {
          target: describeElement(target),
          events: current.count,
          scrollTop: Math.round(target.scrollTop),
          side: scrollClassification?.side || '',
          origin: scrollClassification?.origin || 'user'
        }
      });
      scrollStates.delete(target);
    }, 140);
    scrollStates.set(target, current);
  }, true);
}

function installPerformanceObservers(scope) {
  if (typeof PerformanceObserver === 'undefined') return;
  const meaningfulEvents = new Set(['click', 'keydown', 'input', 'change', 'contextmenu', 'drop']);
  if (scope.observe(PerformanceObserver, list => {
    for (const entry of list.getEntries()) {
      if (!scope.active() || !meaningfulEvents.has(entry.name)) continue;
      record(`browser.event.${entry.name}`, { category: 'runtime.event-timing', durationMs: entry.duration, aggregate: true,
        details: { interactionId: entry.interactionId || 0,
          processingMs: Number(Math.max(0, entry.processingEnd - entry.processingStart).toFixed(3)) } });
    }
  }, { type: 'event', buffered: !eventTimingSeen, durationThreshold: 16 })) eventTimingSeen = true;
  if (scope.observe(PerformanceObserver, list => {
    for (const entry of list.getEntries()) {
      if (!scope.active()) break;
      record('runtime.navigation', { category: 'runtime.performance', durationMs: entry.duration,
        details: { domContentLoadedMs: Number(entry.domContentLoadedEventEnd.toFixed(3)),
          loadMs: Number(entry.loadEventEnd.toFixed(3)), transferBytes: entry.transferSize || 0 } });
    }
  }, { type: 'navigation', buffered: !navigationSeen })) navigationSeen = true;
}

function installErrorTracking(scope) {
  scope.listen(window, 'error', event => {
    diagnostic('runtime.error', {
      category: 'runtime.error',
      status: 'error',
      dedupeKey: `runtime.error:${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}:${event.message || ''}`,
      details: {
        message: event.message,
        file: event.filename?.split(/[\\/]/).pop() || '',
        line: event.lineno,
        column: event.colno
      }
    });
  });
  scope.listen(window, 'unhandledrejection', event => {
    const reason = event.reason?.message || event.reason;
    diagnostic('runtime.unhandled-rejection', {
      category: 'runtime.error',
      status: 'error',
      dedupeKey: `runtime.unhandled-rejection:${cleanString(reason, 180)}`,
      details: { reason }
    });
  });
}

export function startPerformanceTelemetry() { return !telemetryDestroyed && getTelemetryLifecycle().start(); }
export function stopPerformanceTelemetry() { return telemetryLifecycle?.stop(); }
export function getPerformanceTelemetryState() { return telemetryLifecycle?.getState() || { state: telemetryDestroyed ? 'destroyed' : 'idle' }; }

if (import.meta.env.DEV) {
  disconnectRecorder = connectTelemetryRecorder({ record, diagnostic });
  record('frontend.bootstrap', { category: 'app.lifecycle', durationMs: performance.now(), details: {
    userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGb: navigator.deviceMemory || null, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight
  } });
  getTelemetryLifecycle().mount();
  getTelemetryLifecycle().start();
}
