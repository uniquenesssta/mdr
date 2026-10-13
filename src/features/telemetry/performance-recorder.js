// The single frontend envelope/measurement owner. No DOM, timers or file transport.
function cleanString(value, maxLength = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeDetails(details) {
  if (!details || typeof details !== 'object') return {};
  const ancestors = new WeakSet();
  let remaining = 512;
  const visit = (value, depth) => {
    if (--remaining < 0 || depth > 8) return '[truncated]';
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return cleanString(value, 300);
    if (typeof value !== 'object') return undefined;
    if (ancestors.has(value)) return '[circular]';
    ancestors.add(value);
    try {
      if (Array.isArray(value)) return value.slice(0, 20).map(item => visit(item, depth + 1) ?? null);
      const safe = Object.create(null);
      for (const key of Object.keys(value).slice(0, 64)) {
        if (remaining <= 0) break;
        const nested = visit(value[key], depth + 1);
        if (nested !== undefined) safe[key] = nested;
      }
      return safe;
    } catch (_) {
      return '[unserializable]';
    } finally {
      ancestors.delete(value);
    }
  };
  return visit(details, 0);
}


/** Create an independently owned Recorder. Aggregation and persistence are injected ports. */
export function createTelemetryRecorder({ sessionId, now, monotonicNow, emit, aggregate } = {}) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) throw new TypeError('Recorder requires a sessionId');
  for (const [name, value] of Object.entries({ now, monotonicNow, emit })) {
    if (typeof value !== 'function') throw new TypeError(`Recorder requires ${name}`);
  }
  if (aggregate !== undefined && typeof aggregate !== 'function') throw new TypeError('Recorder aggregate port must be a function');
  let destroyed = false;
  function normalizeOptions(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Recorder options must be an object');
    for (const name of ['category', 'status']) {
      if (options[name] && typeof options[name] !== 'string') throw new TypeError(`Recorder ${name} must be a string`);
    }
    return { ...options, category: options.category || 'ui.operation', status: options.status || 'ok' };
  }
  function createEntry(operation, options = {}) {
    if (destroyed || typeof operation !== 'string' || !operation.trim()) return null;
    const normalized = normalizeOptions(options);
    const duration = Number(normalized.durationMs);
    const timestampMs = now();
    if (!Number.isFinite(timestampMs)) throw new TypeError('Recorder timestamp must be finite');
    const details = safeDetails(normalized.details);
    if (destroyed) return null;
    return {
      timestampMs,
      sessionId,
      source: 'frontend',
      category: normalized.category,
      operation,
      durationMs: Number.isFinite(duration) ? Math.max(0, Number(duration.toFixed(3))) : null,
      status: normalized.status,
      details
    };
  }
  function record(operation, options = {}) {
    if (destroyed || typeof operation !== 'string' || !operation.trim()) return;
    const normalized = normalizeOptions(options);
    if (destroyed) return;
    if (normalized.aggregate && aggregate) {
      const details = safeDetails(normalized.details);
      if (!destroyed) aggregate(operation, { ...normalized, details });
    } else {
      const entry = createEntry(operation, normalized);
      if (!destroyed && entry) emit(entry);
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
    if (typeof callback !== 'function') throw new TypeError('Recorder measure requires a callback');
    if (destroyed) return callback();
    normalizeOptions(options);
    const started = monotonicNow();
    const finish = (status, error = null) => {
      if (destroyed) return;
      const details = resolveMeasuredDetails(options.details);
      record(operation, {
        ...options,
        durationMs: monotonicNow() - started,
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


  return Object.freeze({ record, measure, createEntry, normalizeDetails: safeDetails,
    destroy() { destroyed = true; emit = null; aggregate = null; } });
}
