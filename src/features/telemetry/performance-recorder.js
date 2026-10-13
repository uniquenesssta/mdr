import { redactTelemetryDetails as safeDetails, redactTelemetryLabel } from './telemetry-redaction.js';

// The single frontend envelope/measurement owner. No DOM, timers or file transport.
function cleanString(value, maxLength = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** Create an independently owned Recorder. Aggregation and persistence are injected ports. */
export function createTelemetryRecorder({ sessionId, now, monotonicNow, emit, aggregate } = {}) {
  if (typeof sessionId !== 'string' || !sessionId.trim() || redactTelemetryLabel(sessionId) === '[redacted]') throw new TypeError('Recorder requires a sessionId');
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
    return { ...options, category: redactTelemetryLabel(options.category || 'ui.operation'), status: redactTelemetryLabel(options.status || 'ok') };
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
      operation: redactTelemetryLabel(operation),
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
      if (!destroyed) aggregate(redactTelemetryLabel(operation), { category: normalized.category, status: normalized.status, durationMs: Number(normalized.durationMs), aggregate: true, details });
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
