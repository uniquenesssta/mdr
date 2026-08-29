function assertFunction(value, message) {
  if (typeof value !== 'function') throw new TypeError(message);
}

/**
 * Creates the desktop performance-log command adapter.
 * Queueing, aggregation, retry and diagnostic policy remain owned by the
 * frontend performance runtime; this adapter only persists one supplied batch.
 */
export function createPerformanceLogClient(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('performance-log client options must be an object');
  }

  const invoke = options.invoke;
  assertFunction(invoke, 'performance-log client requires an invoke function');

  async function writePerformance(entries) {
    return invoke('write_performance_logs', { entries }, {}, { record: false });
  }

  return Object.freeze({ writePerformance });
}
