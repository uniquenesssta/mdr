const sessionId = globalThis.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const queue = [];
const aggregates = new Map();
const diagnosticStates = new Map();
const wrappedFunctions = new Set();
const MAX_QUEUE = 1000;
const MAX_DIAGNOSTIC_KEYS = 200;
const FLUSH_INTERVAL_MS = 2000;
const AGGREGATE_INTERVAL_MS = 1500;
const DEFAULT_DIAGNOSTIC_INTERVAL_MS = 5000;
let flushInProgress = false;
let lastFlushError = '';
let logPath = '';
let platformLogs = null;
let platformLogsEnabled = false;
let runtimeStatsProvider = () => ({});

export function configurePerformanceRuntimeStats(provider) {
  if (typeof provider !== 'function') throw new TypeError('performance runtime stats provider must be a function');
  runtimeStatsProvider = provider;
}

export function configurePerformancePlatform({ logs, enabled = false } = {}) {
  if (!logs || typeof logs.writePerformance !== 'function') {
    throw new TypeError('performance runtime requires a logs port');
  }
  platformLogs = logs;
  platformLogsEnabled = Boolean(enabled);
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

function safeDetails(details) {
  if (!details || typeof details !== 'object') return {};
  const safe = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || typeof value === 'function') continue;
    if (typeof value === 'string') {
      safe[key] = cleanString(value);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safe[key] = value;
    } else if (Array.isArray(value)) {
      safe[key] = value.slice(0, 20).map(item =>
        typeof item === 'string' ? cleanString(item, 80) : item
      );
    } else {
      try {
        safe[key] = cleanString(JSON.stringify(value), 300);
      } catch (_) {
        safe[key] = '[unserializable]';
      }
    }
  }
  return safe;
}

function makeEntry(operation, options = {}) {
  const duration = Number(options.durationMs);
  return {
    timestampMs: timestampMs(),
    sessionId,
    source: 'frontend',
    category: options.category || 'ui.operation',
    operation,
    durationMs: Number.isFinite(duration) ? Math.max(0, Number(duration.toFixed(3))) : null,
    status: options.status || 'ok',
    details: safeDetails(options.details)
  };
}

function enqueue(entry) {
  if (queue.length >= MAX_QUEUE) queue.splice(0, Math.max(1, queue.length - MAX_QUEUE + 1));
  queue.push(entry);
  if (queue.length >= 50) void flush();
}

function record(operation, options = {}) {
  if (!operation) return;
  if (options.aggregate) {
    const key = `${options.category || 'ui.operation'}:${operation}:${options.status || 'ok'}`;
    const duration = Number(options.durationMs);
    const metric = aggregates.get(key) || {
      operation,
      category: options.category || 'ui.operation',
      status: options.status || 'ok',
      count: 0,
      total: 0,
      min: Number.POSITIVE_INFINITY,
      max: 0,
      firstTimestampMs: timestampMs(),
      lastTimestampMs: timestampMs(),
      details: {}
    };
    metric.count += 1;
    metric.lastTimestampMs = timestampMs();
    if (Number.isFinite(duration)) {
      metric.total += duration;
      metric.min = Math.min(metric.min, duration);
      metric.max = Math.max(metric.max, duration);
    }
    metric.details = safeDetails(options.details);
    aggregates.set(key, metric);
    return;
  }
  enqueue(makeEntry(operation, options));
}

function diagnostic(operation, options = {}) {
  if (!operation) return false;
  const now = timestampMs();
  const details = safeDetails(options.details);
  const key = cleanString(options.dedupeKey || `${options.category || 'runtime.diagnostic'}:${operation}`, 240);
  const fingerprint = cleanString(
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

  enqueue(makeEntry(operation, {
    ...options,
    category: options.category || 'runtime.diagnostic',
    details: {
      ...details,
      suppressedDuplicates
    }
  }));
  return true;
}

function drainAggregates() {
  for (const metric of aggregates.values()) {
    const hasDuration = Number.isFinite(metric.min);
    enqueue(makeEntry(metric.operation, {
      category: metric.category,
      status: metric.status,
      durationMs: hasDuration ? metric.total / metric.count : null,
      details: {
        ...metric.details,
        samples: metric.count,
        averageMs: hasDuration ? Number((metric.total / metric.count).toFixed(3)) : null,
        minMs: hasDuration ? Number(metric.min.toFixed(3)) : null,
        maxMs: hasDuration ? Number(metric.max.toFixed(3)) : null,
        periodMs: metric.lastTimestampMs - metric.firstTimestampMs
      }
    }));
  }
  aggregates.clear();
}

async function flush() {
  if (flushInProgress || !queue.length || !platformLogsEnabled || !platformLogs) return;
  flushInProgress = true;
  const batch = queue.splice(0, Math.min(queue.length, 250));
  try {
    logPath = await platformLogs.writePerformance(batch);
    lastFlushError = '';
  } catch (error) {
    queue.unshift(...batch);
    const message = cleanString(error?.message || error, 240);
    if (message !== lastFlushError) {
      lastFlushError = message;
      console.warn('Performance log flush failed:', error);
    }
  } finally {
    flushInProgress = false;
    if (queue.length >= 50) setTimeout(() => void flush(), 50);
  }
}

function resolveMeasuredDetails(details) {
  if (typeof details !== 'function') return details;
  try {
    return details();
  } catch (_) {
    return {};
  }
}

function measure(operation, callback, options = {}) {
  const started = performance.now();
  const finish = (status, error = null) => {
    const details = resolveMeasuredDetails(options.details);
    record(operation, {
      ...options,
      durationMs: performance.now() - started,
      status,
      details: error
        ? { ...(details && typeof details === 'object' ? details : {}), error: cleanString(error?.message || error) }
        : details
    });
  };

  try {
    const result = callback();
    if (result && typeof result.then === 'function') {
      return result.then(
        value => {
          finish('ok');
          return value;
        },
        error => {
          finish('error', error);
          throw error;
        }
      );
    }
    finish('ok');
    return result;
  } catch (error) {
    finish('error', error);
    throw error;
  }
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

function installInteractionTracking() {
  const paintTrackedEvents = ['click', 'change', 'contextmenu', 'drop'];
  for (const eventName of paintTrackedEvents) {
    document.addEventListener(eventName, event => {
      const started = performance.now();
      const target = event.target instanceof Element ? event.target.closest('button, a, input, select, textarea, [onclick], [role="menuitem"], .doc-item') || event.target : null;
      const clickCount = eventName === 'click' && event instanceof MouseEvent
        ? Number(event.detail) || 0
        : null;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
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

  document.addEventListener('keydown', event => {
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

  document.addEventListener('input', event => {
    const started = performance.now();
    requestAnimationFrame(() => {
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
  document.addEventListener('scroll', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // CodeMirror 的原生滚动会转发为编辑器宿主事件，忽略内部 scroller，
    // 避免同一次滚动在日志中出现两条完全相同的 burst。
    if (target.classList.contains('cm-scroller') && target.closest('.virtual-editor-host')) return;
    const scrollClassification = window.markdownEditorScrollController?.classifyScrollTarget?.(target) || null;
    // 目标侧联动滚动和虚拟高度补偿不是用户交互，不计入交互 burst。
    // 否则日志会把一次编辑器滚动误报为编辑器、预览两次滚动。
    if (scrollClassification && scrollClassification.origin !== 'user') return;
    const current = scrollStates.get(target) || {
      started: performance.now(),
      count: 0,
      timer: null
    };
    current.count += 1;
    clearTimeout(current.timer);
    current.timer = setTimeout(() => {
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

function installPerformanceObservers() {
  if (typeof PerformanceObserver === 'undefined') return;

  try {
    const longTaskObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        record('runtime.long-task', {
          category: 'runtime.performance',
          durationMs: entry.duration,
          details: { startTime: Number(entry.startTime.toFixed(3)) }
        });
      }
    });
    longTaskObserver.observe({ type: 'longtask', buffered: true });
  } catch (_) {}

  try {
    // Event Timing 会同时上报 pointerover / mouseover / pointerenter 等同源事件。
    // 只保留能代表用户实际操作的事件，避免一轮鼠标动作产生多份重复日志。
    const meaningfulEvents = new Set(['click', 'keydown', 'input', 'change', 'contextmenu', 'drop']);
    const eventObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!meaningfulEvents.has(entry.name)) continue;
        record(`browser.event.${entry.name}`, {
          category: 'runtime.event-timing',
          durationMs: entry.duration,
          aggregate: true,
          details: {
            interactionId: entry.interactionId || 0,
            processingMs: Number(Math.max(0, entry.processingEnd - entry.processingStart).toFixed(3))
          }
        });
      }
    });
    eventObserver.observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch (_) {}

  try {
    const navigationObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        record('runtime.navigation', {
          category: 'runtime.performance',
          durationMs: entry.duration,
          details: {
            domContentLoadedMs: Number(entry.domContentLoadedEventEnd.toFixed(3)),
            loadMs: Number(entry.loadEventEnd.toFixed(3)),
            transferBytes: entry.transferSize || 0
          }
        });
      }
    });
    navigationObserver.observe({ type: 'navigation', buffered: true });
  } catch (_) {}
}

function installErrorTracking() {
  window.addEventListener('error', event => {
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
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason?.message || event.reason;
    diagnostic('runtime.unhandled-rejection', {
      category: 'runtime.error',
      status: 'error',
      dedupeKey: `runtime.unhandled-rejection:${cleanString(reason, 180)}`,
      details: { reason }
    });
  });
}

function functionDetails(name) {
  const editor = document.getElementById('editor');
  const preview = document.getElementById('preview');
  if (name.includes('Scroll')) {
    const syncState = window.markdownEditorScrollController?.getState?.() || null;
    return {
      editorScrollTop: Math.round(editor?.scrollTop || 0),
      previewScrollTop: Math.round(preview?.scrollTop || 0),
      scrollSourceSide: syncState?.sourceSide || '',
      scrollSourceReason: syncState?.sourceReason || '',
      scrollTargetWrites: syncState?.targetWrites || 0,
      scrollIgnoredTargetEvents: syncState?.ignoredTargetEvents || 0,
      scrollGeometryResyncs: syncState?.geometryResyncs || 0,
      scrollLastTargetDelta: syncState?.lastTargetDelta || 0
    };
  }
  if (name.includes('Selection')) {
    const selectionState = window.markdownEditorSelectionController?.getState?.() || null;
    return {
      selectionLength: Math.max(0, (editor?.selectionEnd || 0) - (editor?.selectionStart || 0)),
      selectionApplyingSide: selectionState?.applyingSide || '',
      selectionPreviewRevision: selectionState?.previewRevision || 0,
      selectionPendingRetries: selectionState?.pendingRetries || 0,
      selectionMappingFailures: selectionState?.mappingFailures || 0,
      selectionPreviewRefreshes: selectionState?.previewRefreshes || 0
    };
  }
  const previewBody = preview?.querySelector?.('.markdown-body');
  const virtualEditor = editor?.virtualEditor;
  const viewport = virtualEditor?.getVisibleRange?.();
  const runtimeStats = runtimeStatsProvider() || {};
  const virtualPreview = runtimeStats.virtualPreview || null;
  const documentStatistics = window.markdownEditorDocumentStatistics || null;
  const documentModel = window.markdownEditorDocumentModel?.getState?.() || null;
  const presentationStats = virtualEditor?.getPresentationStats?.() || null;
  return {
    editorChars: documentModel?.length ?? editor?.textLength ?? editor?.value?.length ?? 0,
    documentId: documentModel?.documentId || '',
    documentGeneration: documentModel?.generation || 0,
    documentVersion: documentModel?.version || 0,
    documentDirty: Boolean(documentModel?.dirty),
    documentJournalEntries: documentModel?.journalEntries || 0,
    documentJournalChars: documentModel?.journalChars || 0,
    editorLines: virtualEditor?.getLineCount?.() || 0,
    editorRenderedLines: editor?.querySelectorAll?.('.cm-line')?.length || 0,
    editorPresentationMode: virtualEditor?.getPresentationMode?.() || 'source',
    editorDecoratedLines: presentationStats?.decoratedLines || 0,
    editorHeadingLines: presentationStats?.headingLines || 0,
    editorSourceActiveLines: presentationStats?.sourceActiveLines || 0,
    editorHiddenMarkers: presentationStats?.hiddenMarkers || 0,
    editorRenderedBlocks: presentationStats?.renderedBlocks || 0,
    editorCodeBlocks: presentationStats?.codeBlocks || 0,
    editorMermaidBlocks: presentationStats?.mermaidBlocks || 0,
    editorTableBlocks: presentationStats?.tableBlocks || 0,
    editorImageBlocks: presentationStats?.imageBlocks || 0,
    editorMathBlocks: presentationStats?.mathBlocks || 0,
    editorHtmlBlocks: presentationStats?.htmlBlocks || 0,
    editorHtmlFallbackBlocks: presentationStats?.htmlFallbackBlocks || 0,
    editorViewportFrom: viewport?.from || 0,
    editorViewportTo: viewport?.to || 0,
    previewBlocks: virtualPreview?.blocks ?? previewBody?.children?.length ?? 0,
    indexedBlocks: documentStatistics?.blocks || 0,
    indexedHeadings: documentStatistics?.headings || 0,
    previewMountedBlocks: virtualPreview?.mountedBlocks ?? previewBody?.children?.length ?? 0,
    previewVirtualized: Boolean(virtualPreview?.active),
    previewMeasuredHeights: virtualPreview?.measuredHeights || 0,
    previewCachedHeights: virtualPreview?.cachedHeights || 0,
    backgroundTasks: Number(runtimeStats.backgroundTasks) || 0,
    previewAnchors: preview?.querySelectorAll?.('[data-source-line]')?.length || 0
  };
}

function instrumentFunction(name, category, aggregate = false) {
  const original = window[name];
  if (typeof original !== 'function' || wrappedFunctions.has(name)) return false;
  const wrapped = function (...args) {
    return measure(name, () => original.apply(this, args), {
      category,
      aggregate,
      details: () => functionDetails(name)
    });
  };
  try {
    Object.defineProperty(wrapped, 'name', { value: original.name, configurable: true });
  } catch (_) {}
  window[name] = wrapped;
  wrappedFunctions.add(name);
  return true;
}

function installLegacyInstrumentation() {
  const groups = {
    'render.pipeline': [
      ['updatePreview', true],
      ['renderMermaidBlocks', true],
      ['renderOutline', true],
      ['annotatePreviewSourceLines', true],
      ['rebuildEditorLineMetrics', true],
      ['getPreviewAnchorMetrics', true]
    ],
    'sync.scroll': [
      ['syncFromEditorScroll', true],
      ['syncFromPreviewScroll', true],
      ['scheduleSyncedScroll', true],
      ['scheduleSourceScrollSync', true]
    ],
    'sync.selection': [
      ['highlightPreviewLines', true]
    ],
    'document.operation': [
      ['setupDocuments', false],
      ['openDocument', false],
      ['newDocument', false],
      ['duplicateDocument', false],
      ['renameDocument', false],
      ['closeDocument', false],
      ['saveCurrentDocumentState', true],
      ['saveToLocal', false],
      ['saveAsMarkdown', false],
      ['autoSave', true],
      ['loadFile', false],
      ['loadTextContentAsDocument', false]
    ],
    'export.operation': [
      ['exportFile', false],
      ['exportWord', false],
      ['exportHTML', false],
      ['exportPDF', false],
      ['downloadExportImage', false]
    ],
    'ui.layout': [
      ['applySplit', true],
      ['setLayoutMode', false],
      ['togglePane', false],
      ['toggleSidebar', false],
      ['applySettings', false],
      ['setLanguage', false],
      ['setAppTheme', false]
    ],
    'content.operation': [
      ['undo', false],
      ['redo', false],
      ['wrapSelection', false],
      ['prefixLines', false],
      ['insertHeading', false],
      ['insertTable', false],
      ['confirmImageInsert', false],
      ['confirmMermaidInsert', false],
      ['convertAndInsert', false],
      ['findNext', false],
      ['replaceOne', false],
      ['replaceAll', false]
    ]
  };

  let installed = 0;
  for (const [category, functions] of Object.entries(groups)) {
    for (const [name, aggregate] of functions) {
      if (instrumentFunction(name, category, aggregate)) installed += 1;
    }
  }

  record('instrumentation.ready', {
    category: 'app.lifecycle',
    details: { wrappedFunctions: installed }
  });
  setTimeout(() => void flush(), 0);
}

function recordRuntimeSnapshot() {
  const memory = performance.memory;
  const scrollState = window.markdownEditorScrollController?.getState?.() || null;
  const selectionState = window.markdownEditorSelectionController?.getState?.() || null;
  record('runtime.snapshot', {
    category: 'runtime.performance',
    details: {
      domNodes: document.querySelectorAll('*').length,
      usedHeapBytes: memory?.usedJSHeapSize || null,
      totalHeapBytes: memory?.totalJSHeapSize || null,
      queueLength: queue.length,
      aggregateCount: aggregates.size,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollSourceSide: scrollState?.sourceSide || '',
      scrollSourceSwitches: scrollState?.sourceSwitches || 0,
      scrollTargetWrites: scrollState?.targetWrites || 0,
      scrollIgnoredTargetEvents: scrollState?.ignoredTargetEvents || 0,
      scrollGeometryResyncs: scrollState?.geometryResyncs || 0,
      selectionPreviewRevision: selectionState?.previewRevision || 0,
      selectionPreviewRefreshes: selectionState?.previewRefreshes || 0,
      selectionPendingRetries: selectionState?.pendingRetries || 0,
      selectionMappingFailures: selectionState?.mappingFailures || 0,
      selectionIgnoredFeedbackEvents: selectionState?.ignoredFeedbackEvents || 0
    }
  });
}

if (import.meta.env.DEV) {
  window.markdownEditorPerf = {
    sessionId,
    record,
    diagnostic,
    measure,
    flush,
    installLegacyInstrumentation,
    getLogPath: () => logPath
  };

  record('frontend.bootstrap', {
    category: 'app.lifecycle',
    durationMs: performance.now(),
    details: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemoryGb: navigator.deviceMemory || null,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }
  });
  installInteractionTracking();
  installPerformanceObservers();
  installErrorTracking();

  setInterval(drainAggregates, AGGREGATE_INTERVAL_MS);
  setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  setInterval(recordRuntimeSnapshot, 30_000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      drainAggregates();
      void flush();
    }
  });
  window.addEventListener('pagehide', () => {
    drainAggregates();
    void flush();
  });
}
