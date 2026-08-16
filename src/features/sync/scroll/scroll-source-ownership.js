/**
 * Responsibility: Authoritative Stage 9 scroll source ownership for user source identity, reason/time, programmatic suppression windows, suspension and monotonic sequence allocation.
 * Imports: None; time is supplied through an explicit capability.
 * Exports: ScrollSourceOwnership and createScrollSourceOwnership.
 * State/side effects: Owns source-side metadata, programmatic windows, suspension, switch statistics and sequence only; never reads/writes DOM or schedules frames.
 * Lifecycle: Explicit instance lifecycle; destroy() is terminal and idempotent.
 */

const SIDE_NAMES = new Set(['editor', 'preview']);

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function normalizeDuration(value, minimum = 0) {
  return Math.max(minimum, Number(value) || 0);
}

export class ScrollSourceOwnership {
  constructor({ now = defaultNow } = {}) {
    if (typeof now !== 'function') throw new Error('ScrollSourceOwnership requires a now capability');
    this.now = now;
    this.destroyed = false;
    this.sourceSide = '';
    this.sourceReason = '';
    this.sourceLastEventAt = 0;
    this.suspendedUntil = 0;
    this.programmaticUntil = { editor: 0, preview: 0 };
    this.sourceSwitches = 0;
    this.sequence = 0;
  }

  beginUserGesture(side, reason = 'user') {
    if (this.destroyed || !SIDE_NAMES.has(side)) {
      return { accepted: false, sourceChanged: false };
    }
    const sourceChanged = this.sourceSide !== side;
    if (sourceChanged) this.sourceSwitches += 1;
    this.sourceSide = side;
    this.sourceReason = String(reason || 'user');
    this.sourceLastEventAt = this.now();
    this.programmaticUntil[side] = 0;
    return { accepted: true, sourceChanged };
  }

  touchSource(side) {
    if (this.destroyed || this.sourceSide !== side) return false;
    this.sourceLastEventAt = this.now();
    return true;
  }

  markProgrammaticScroll(side, duration = 700) {
    if (this.destroyed || !SIDE_NAMES.has(side)) return false;
    this.programmaticUntil[side] = Math.max(
      this.programmaticUntil[side],
      this.now() + normalizeDuration(duration, 120)
    );
    return true;
  }

  suspend(duration = 360) {
    if (this.destroyed) return false;
    this.suspendedUntil = Math.max(
      this.suspendedUntil,
      this.now() + normalizeDuration(duration)
    );
    return true;
  }

  isProgrammatic(side) {
    return !this.destroyed
      && SIDE_NAMES.has(side)
      && this.now() < this.programmaticUntil[side];
  }

  isSuspended() {
    return !this.destroyed && this.now() < this.suspendedUntil;
  }

  isSource(side) {
    return !this.destroyed && SIDE_NAMES.has(side) && this.sourceSide === side;
  }

  getSourceSide() {
    return this.destroyed ? '' : this.sourceSide;
  }

  classify(side) {
    if (this.destroyed || !SIDE_NAMES.has(side)) return 'passive';
    if (this.isProgrammatic(side)) return 'programmatic';
    if (this.sourceSide === side) return 'user';
    return 'passive';
  }

  nextSequence() {
    if (this.destroyed) return 0;
    this.sequence += 1;
    return this.sequence;
  }

  getState() {
    return {
      sourceSide: this.destroyed ? '' : this.sourceSide,
      sourceReason: this.destroyed ? '' : this.sourceReason,
      sourceLastEventAt: this.destroyed ? 0 : this.sourceLastEventAt,
      suspendedUntil: this.destroyed ? 0 : this.suspendedUntil,
      programmaticUntil: this.destroyed
        ? { editor: 0, preview: 0 }
        : { ...this.programmaticUntil },
      sourceSwitches: this.destroyed ? 0 : this.sourceSwitches,
      lastSourceSide: this.destroyed ? '' : this.sourceSide,
      lastSourceReason: this.destroyed ? '' : this.sourceReason
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
  }
}

export function createScrollSourceOwnership(options = {}) {
  return new ScrollSourceOwnership(options);
}
