/**
 * Responsibility: Own scroll-geometry recalibration and compensation state, always re-synchronizing from the currently authenticated source side without taking source ownership.
 * Imports: None; consumes injected read/write/scheduling capabilities plus read-only ScrollSourceOwnership access.
 * Exports: ScrollGeometrySession and createScrollGeometrySession.
 * State/side effects: Owns only one pending geometry-source marker and the geometryResyncs statistic; target writes and source identity remain delegated.
 * Lifecycle: Explicit instance lifecycle; destroy() clears pending geometry work, drops capabilities and makes later requests inert.
 */

const SIDE_NAMES = new Set(['editor', 'preview']);

function assertCapabilities({ sourceOwnership, readScrollTop, applyScrollTop, scheduleSourceSync }) {
  if (!sourceOwnership || typeof sourceOwnership.getSourceSide !== 'function') {
    throw new TypeError('ScrollGeometrySession requires read-only ScrollSourceOwnership access');
  }
  if (typeof readScrollTop !== 'function') {
    throw new TypeError('ScrollGeometrySession requires a readScrollTop capability');
  }
  if (typeof applyScrollTop !== 'function') {
    throw new TypeError('ScrollGeometrySession requires an applyScrollTop capability');
  }
  if (typeof scheduleSourceSync !== 'function') {
    throw new TypeError('ScrollGeometrySession requires a scheduleSourceSync capability');
  }
}

export class ScrollGeometrySession {
  constructor({ sourceOwnership, readScrollTop, applyScrollTop, scheduleSourceSync } = {}) {
    assertCapabilities({ sourceOwnership, readScrollTop, applyScrollTop, scheduleSourceSync });
    this.sourceOwnership = sourceOwnership;
    this.readScrollTop = readScrollTop;
    this.applyScrollTop = applyScrollTop;
    this.scheduleSourceSync = scheduleSourceSync;
    this.pendingSourceSide = '';
    this.geometryResyncs = 0;
    this.destroyed = false;
  }

  notifyGeometryChanged(changedSide = '') {
    if (this.destroyed || (changedSide && !SIDE_NAMES.has(changedSide))) return false;
    const sourceSide = this.sourceOwnership.getSourceSide();
    if (!SIDE_NAMES.has(sourceSide)) return false;
    if (this.pendingSourceSide === sourceSide) return true;
    this.pendingSourceSide = sourceSide;
    const scheduled = this.scheduleSourceSync(sourceSide);
    if (!scheduled) this.pendingSourceSide = '';
    return Boolean(scheduled);
  }

  compensate(side, delta, reason = 'geometry-compensation') {
    if (this.destroyed || !SIDE_NAMES.has(side) || !Number.isFinite(delta) || Math.abs(delta) < 0.5) return false;
    const currentTop = Number(this.readScrollTop(side)) || 0;
    const changed = this.applyScrollTop(side, currentTop + delta, {
      reason,
      behavior: 'auto',
      settleMs: 900
    });
    if (changed) this.notifyGeometryChanged(side);
    return Boolean(changed);
  }

  settleSourceSync(side, { published = false } = {}) {
    if (this.destroyed || !SIDE_NAMES.has(side) || this.pendingSourceSide !== side) return false;
    this.pendingSourceSide = '';
    if (!published) return false;
    this.geometryResyncs += 1;
    return true;
  }

  cancelPending() {
    if (this.destroyed) return;
    this.pendingSourceSide = '';
  }

  getState() {
    return { geometryResyncs: this.geometryResyncs };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pendingSourceSide = '';
    this.sourceOwnership = null;
    this.readScrollTop = null;
    this.applyScrollTop = null;
    this.scheduleSourceSync = null;
  }
}

export function createScrollGeometrySession(options = {}) {
  return new ScrollGeometrySession(options);
}
