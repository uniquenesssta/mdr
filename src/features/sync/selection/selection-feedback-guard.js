/**
 * Responsibility: Authoritative R9-08 bidirectional selection feedback transaction state.
 * Imports: Injected timer capabilities only.
 * Exports: SelectionFeedbackGuard and factory.
 * State/side effects: Owns monotonic sequence, current source, preview revision and one cancellable release timer.
 * Lifecycle: Explicit reset/destroy; stale release callbacks cannot clear a newer transaction.
 */

const VALID_SOURCES = new Set(['editor', 'preview']);

function normalizeRevision(value, fallback = 0) {
  const revision = Number(value);
  return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : fallback;
}

function assertSource(source) {
  if (!VALID_SOURCES.has(source)) {
    throw new TypeError(`SelectionFeedbackGuard source must be editor or preview, received: ${String(source)}`);
  }
}

export class SelectionFeedbackGuard {
  constructor({
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timerId => clearTimeout(timerId)
  } = {}) {
    if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
      throw new TypeError('SelectionFeedbackGuard requires timer capabilities');
    }
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.sequence = 0;
    this.source = '';
    this.revision = 0;
    this.activeRevision = 0;
    this.releaseTimer = 0;
    this.destroyed = false;
  }

  begin(source, { revision = this.revision } = {}) {
    this.assertUsable();
    assertSource(source);
    this.cancelRelease();
    const requestedRevision = normalizeRevision(revision, this.revision);
    if (requestedRevision > this.revision) this.revision = requestedRevision;
    this.sequence += 1;
    this.source = source;
    this.activeRevision = this.revision;
    return Object.freeze({
      sequence: this.sequence,
      source: this.source,
      revision: this.activeRevision
    });
  }

  shouldIgnore(source, { revision = this.revision, allowSource = false } = {}) {
    if (this.destroyed) return true;
    assertSource(source);
    const incomingRevision = normalizeRevision(revision, this.revision);
    if (incomingRevision < this.revision) return true;
    if (incomingRevision > this.revision || !this.source) return false;
    if (this.activeRevision !== incomingRevision) return false;
    return allowSource ? this.source !== source : true;
  }

  advanceRevision() {
    this.assertUsable();
    this.revision += 1;
    if (this.source) this.activeRevision = this.revision;
    return this.revision;
  }

  release(token, delay = 0) {
    if (this.destroyed || !token || typeof token !== 'object') return false;
    if (token.sequence !== this.sequence || token.source !== this.source || !this.source) return false;
    this.cancelRelease();
    const sequence = token.sequence;
    const source = token.source;
    const clearCurrent = () => {
      this.releaseTimer = 0;
      if (this.destroyed) return;
      if (this.sequence !== sequence || this.source !== source) return;
      this.source = '';
      this.activeRevision = this.revision;
    };
    const settleDelay = Math.max(0, Number(delay) || 0);
    if (settleDelay > 0) {
      this.releaseTimer = this.setTimer(clearCurrent, settleDelay);
      return true;
    }
    clearCurrent();
    return true;
  }

  reset() {
    if (this.destroyed) return;
    this.cancelRelease();
    this.sequence += 1;
    this.source = '';
    this.activeRevision = this.revision;
  }

  getRevision() {
    return this.revision;
  }

  getState() {
    return Object.freeze({
      sequence: this.sequence,
      source: this.source,
      revision: this.revision,
      active: Boolean(this.source),
      destroyed: this.destroyed
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.reset();
    this.destroyed = true;
    this.setTimer = null;
    this.clearTimer = null;
  }

  cancelRelease() {
    if (!this.releaseTimer) return;
    this.clearTimer(this.releaseTimer);
    this.releaseTimer = 0;
  }

  assertUsable() {
    if (this.destroyed) throw new Error('SelectionFeedbackGuard is destroyed');
  }
}

export function createSelectionFeedbackGuard(options = {}) {
  return new SelectionFeedbackGuard(options);
}
