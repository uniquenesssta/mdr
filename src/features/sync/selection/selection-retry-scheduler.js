/**
 * Responsibility: Authoritative R9-10 bounded retry scheduling for recoverable selection synchronization work.
 * Imports: Injected animation-frame capabilities and caller-supplied version reader only.
 * Exports: SelectionRetryScheduler and factory.
 * State/side effects: Owns one pending retry frame, retry generation/version, bounded attempt count and stale/cancel statistics.
 * Lifecycle: Explicit cancel/destroy; replaced, stale and destroyed callbacks cannot execute work.
 */

const DEFAULT_MAX_RETRIES = 3;

function normalizeMaxRetries(value, fallback = DEFAULT_MAX_RETRIES) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.floor(numeric));
}

function assertVersion(version) {
  if (version === null || version === undefined) {
    throw new TypeError('SelectionRetryScheduler requires a version token');
  }
}

export class SelectionRetryScheduler {
  constructor({ requestFrame, cancelFrame, maxRetries = DEFAULT_MAX_RETRIES } = {}) {
    if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
      throw new TypeError('SelectionRetryScheduler requires requestFrame/cancelFrame capabilities');
    }
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.maxRetries = normalizeMaxRetries(maxRetries);
    this.generation = 0;
    this.version = null;
    this.attempts = 0;
    this.pending = null;
    this.frameId = null;
    this.scheduled = 0;
    this.executed = 0;
    this.cancelled = 0;
    this.stale = 0;
    this.destroyed = false;
  }

  schedule({ version, getVersion, run, maxRetries = this.maxRetries } = {}) {
    this.assertUsable();
    assertVersion(version);
    if (typeof getVersion !== 'function' || typeof run !== 'function') {
      throw new TypeError('SelectionRetryScheduler requires getVersion/run capabilities');
    }

    const retryLimit = normalizeMaxRetries(maxRetries, this.maxRetries);
    this.cancelPending();
    if (!Object.is(this.version, version)) {
      this.generation += 1;
      this.version = version;
      this.attempts = 0;
    }
    if (this.attempts >= retryLimit) return false;

    const pending = Object.freeze({
      generation: this.generation,
      version,
      attempt: this.attempts + 1,
      maxRetries: retryLimit,
      getVersion,
      run
    });
    this.attempts = pending.attempt;
    this.pending = pending;
    try {
      this.frameId = this.requestFrame(() => this.flush(pending));
    } catch (error) {
      this.pending = null;
      this.frameId = null;
      this.invalidateSeries();
      throw error;
    }
    this.scheduled += 1;
    return true;
  }

  flush(pending) {
    if (this.destroyed || this.pending !== pending) return;
    this.pending = null;
    this.frameId = null;
    if (pending.generation !== this.generation || !Object.is(pending.version, this.version)) return;

    let currentVersion;
    try {
      currentVersion = pending.getVersion();
    } catch (error) {
      this.invalidateSeries();
      throw error;
    }
    if (!Object.is(currentVersion, pending.version)) {
      this.stale += 1;
      this.invalidateSeries();
      return;
    }

    this.executed += 1;
    pending.run(Object.freeze({
      generation: pending.generation,
      version: pending.version,
      attempt: pending.attempt,
      maxRetries: pending.maxRetries
    }));
  }

  cancel() {
    if (this.destroyed) return;
    this.cancelPending();
    this.invalidateSeries();
  }

  getState() {
    return Object.freeze({
      generation: this.generation,
      version: this.version,
      attempts: this.attempts,
      maxRetries: this.maxRetries,
      pending: Boolean(this.pending),
      pendingAttempt: this.pending?.attempt || 0,
      scheduled: this.scheduled,
      executed: this.executed,
      cancelled: this.cancelled,
      stale: this.stale,
      destroyed: this.destroyed
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.cancel();
    this.destroyed = true;
    this.requestFrame = null;
    this.cancelFrame = null;
  }

  cancelPending() {
    if (!this.pending) return false;
    const frameId = this.frameId;
    this.pending = null;
    this.frameId = null;
    if (frameId !== null) this.cancelFrame(frameId);
    this.cancelled += 1;
    return true;
  }

  invalidateSeries() {
    this.generation += 1;
    this.version = null;
    this.attempts = 0;
  }

  assertUsable() {
    if (this.destroyed) throw new Error('SelectionRetryScheduler is destroyed');
  }
}

export function createSelectionRetryScheduler(options = {}) {
  return new SelectionRetryScheduler(options);
}
