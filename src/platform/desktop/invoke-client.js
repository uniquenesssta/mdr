import { invoke as tauriInvoke } from '@tauri-apps/api/core';

const NATIVE_ROUNDTRIP_CATEGORY = 'native.roundtrip';

function defaultNow() {
  const value = globalThis.performance?.now?.();
  return Number.isFinite(value) ? value : Date.now();
}

function readTimestamp(now) {
  try {
    const value = Number(now());
    return Number.isFinite(value) ? value : 0;
  } catch (_) {
    return 0;
  }
}

function errorMessage(error) {
  return error?.message || String(error);
}

function recordSafely(record, operation, entry) {
  if (!record) return;
  try {
    record(operation, entry);
  } catch (_) {
    // Telemetry must never replace the native result or original invoke error.
  }
}

/**
 * Creates the single desktop invoke transport.
 * Command names and argument objects pass through unchanged; telemetry is observational only.
 */
export function createInvokeClient(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('invoke client options must be an object');
  }

  const invokeCommand = Object.hasOwn(options, 'invoke') ? options.invoke : tauriInvoke;
  const now = Object.hasOwn(options, 'now') ? options.now : defaultNow;
  const record = Object.hasOwn(options, 'record') ? options.record : null;

  if (typeof invokeCommand !== 'function') {
    throw new TypeError('invoke client requires an invoke function');
  }
  if (typeof now !== 'function') {
    throw new TypeError('invoke client now must be a function');
  }
  if (record !== null && record !== undefined && typeof record !== 'function') {
    throw new TypeError('invoke client record must be a function when provided');
  }

  async function invoke(operation, args, details = {}, invocationOptions = {}) {
    const shouldRecord = invocationOptions?.record !== false;
    const started = shouldRecord ? readTimestamp(now) : 0;

    try {
      const result = await invokeCommand(operation, args);
      if (shouldRecord) {
        recordSafely(record, 'native.' + operation, {
          category: NATIVE_ROUNDTRIP_CATEGORY,
          durationMs: Math.max(0, readTimestamp(now) - started),
          details
        });
      }
      return result;
    } catch (error) {
      if (shouldRecord) {
        const errorDetails = details && typeof details === 'object' && !Array.isArray(details)
          ? { ...details, error: errorMessage(error) }
          : { error: errorMessage(error) };
        recordSafely(record, 'native.' + operation, {
          category: NATIVE_ROUNDTRIP_CATEGORY,
          durationMs: Math.max(0, readTimestamp(now) - started),
          status: 'error',
          details: errorDetails
        });
      }
      throw error;
    }
  }

  return Object.freeze({ invoke });
}
