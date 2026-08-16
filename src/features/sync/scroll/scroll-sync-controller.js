/**
 * Responsibility: Preserve the R9-01 scroll behavior contract while orchestrating element input, source-owned eligibility, target writes, compensation and cancellable frame publication.
 * Imports: Scroll source ownership only; geometry mapping and selection mapping remain later Stage 9 responsibilities.
 * Exports: ScrollSyncController and createScrollSyncController.
 * State/side effects: Owns element listeners, callbacks, queued source/target/geometry frames, pending target writes and target/geometry statistics; source identity/windows/sequence belong only to ScrollSourceOwnership.
 * Lifecycle: Explicit instance lifecycle; destroy() removes listeners, cancels queued animation frames and destroys only internally-created source ownership.
 */

import { createScrollSourceOwnership } from './scroll-source-ownership.js';

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const SIDE_NAMES = new Set(['editor', 'preview']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export class ScrollSyncController {
  constructor(editor, preview, options = {}) {
    if (!editor || !preview) throw new Error('ScrollSyncController requires editor and preview elements');
    const sourceOwnership = options.sourceOwnership || createScrollSourceOwnership();
    if (!sourceOwnership
      || typeof sourceOwnership.beginUserGesture !== 'function'
      || typeof sourceOwnership.markProgrammaticScroll !== 'function'
      || typeof sourceOwnership.suspend !== 'function'
      || typeof sourceOwnership.getState !== 'function') {
      throw new Error('ScrollSyncController requires a ScrollSourceOwnership capability');
    }
    this.elements = { editor, preview };
    this.sourceOwnership = sourceOwnership;
    this.ownsSourceOwnership = !options.sourceOwnership;
    this.callbacks = {
      editor: null,
      preview: null
    };
    this.pendingSourceSide = '';
    this.sourceFrame = 0;
    this.pendingTarget = null;
    this.targetFrame = 0;
    this.geometryFrame = 0;
    this.stats = {
      targetWrites: 0,
      ignoredTargetEvents: 0,
      geometryResyncs: 0,
      lastTargetSide: '',
      lastTargetTop: 0,
      lastTargetDelta: 0
    };
    this.disposers = [];
    this.destroyed = false;
    this.installListeners();
  }

  installListeners() {
    for (const side of SIDE_NAMES) {
      const element = this.elements[side];
      const onWheel = () => this.beginUserGesture(side, 'wheel');
      const onPointerDown = () => this.beginUserGesture(side, 'pointer');
      const onTouchStart = () => this.beginUserGesture(side, 'touch');
      const onKeyDown = event => {
        if (SCROLL_KEYS.has(event.key)) this.beginUserGesture(side, 'keyboard');
      };
      const onScroll = () => this.handleScroll(side);

      element.addEventListener('wheel', onWheel, { passive: true });
      element.addEventListener('pointerdown', onPointerDown, true);
      element.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
      element.addEventListener('keydown', onKeyDown, true);
      element.addEventListener('scroll', onScroll, { passive: true });

      this.disposers.push(() => element.removeEventListener('wheel', onWheel));
      this.disposers.push(() => element.removeEventListener('pointerdown', onPointerDown, true));
      this.disposers.push(() => element.removeEventListener('touchstart', onTouchStart, true));
      this.disposers.push(() => element.removeEventListener('keydown', onKeyDown, true));
      this.disposers.push(() => element.removeEventListener('scroll', onScroll));
    }
  }

  configure(callbacks = {}) {
    if (this.destroyed) return;
    this.callbacks.editor = typeof callbacks.syncFromEditor === 'function' ? callbacks.syncFromEditor : null;
    this.callbacks.preview = typeof callbacks.syncFromPreview === 'function' ? callbacks.syncFromPreview : null;
  }

  beginUserGesture(side, reason = 'user') {
    if (this.destroyed || !SIDE_NAMES.has(side)) return;
    const result = this.sourceOwnership.beginUserGesture(side, reason);
    if (result?.sourceChanged) this.cancelTarget(side);
  }

  handleScroll(side) {
    if (this.destroyed || !SIDE_NAMES.has(side)) return;
    if (this.sourceOwnership.isProgrammatic(side)) {
      this.stats.ignoredTargetEvents += 1;
      return;
    }
    if (this.sourceOwnership.isSuspended()) return;

    if (!this.sourceOwnership.isSource(side)) {
      this.stats.ignoredTargetEvents += 1;
      return;
    }

    this.sourceOwnership.touchSource(side);
    this.scheduleSourceSync(side);
  }

  scheduleSourceSync(side) {
    if (this.destroyed) return;
    this.pendingSourceSide = side;
    if (this.sourceFrame) return;
    this.sourceFrame = requestAnimationFrame(() => {
      this.sourceFrame = 0;
      if (this.destroyed) return;
      const pendingSide = this.pendingSourceSide;
      this.pendingSourceSide = '';
      if (!pendingSide
        || !this.sourceOwnership.isSource(pendingSide)
        || this.sourceOwnership.isSuspended()) return;
      this.callbacks[pendingSide]?.();
    });
  }

  scheduleTarget(side, top, options = {}) {
    if (this.destroyed || !SIDE_NAMES.has(side)) return;
    const element = this.elements[side];
    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    const targetTop = clamp(top, 0, maxScroll);
    this.pendingTarget = {
      side,
      top: targetTop,
      reason: String(options.reason || 'linked-scroll'),
      settleMs: Math.max(120, Number(options.settleMs) || 700),
      sequence: this.sourceOwnership.nextSequence()
    };
    if (this.targetFrame) return;
    this.targetFrame = requestAnimationFrame(() => {
      this.targetFrame = 0;
      if (this.destroyed) return;
      const target = this.pendingTarget;
      this.pendingTarget = null;
      if (!target) return;
      this.applyScrollTop(target.side, target.top, {
        reason: target.reason,
        behavior: 'auto',
        settleMs: target.settleMs
      });
    });
  }

  applyScrollTop(side, top, options = {}) {
    if (this.destroyed || !SIDE_NAMES.has(side)) return false;
    const element = this.elements[side];
    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    const targetTop = clamp(top, 0, maxScroll);
    const delta = targetTop - element.scrollTop;
    if (Math.abs(delta) < 0.75) return false;

    this.markProgrammaticScroll(side, options.settleMs || (options.behavior === 'smooth' ? 900 : 700));
    this.stats.targetWrites += 1;
    this.stats.lastTargetSide = side;
    this.stats.lastTargetTop = Math.round(targetTop);
    this.stats.lastTargetDelta = Math.round(delta);

    if (options.behavior === 'smooth') {
      element.scrollTo({ top: targetTop, behavior: 'smooth' });
    } else {
      element.scrollTop = targetTop;
    }
    return true;
  }

  scrollTo(side, top, options = {}) {
    if (options.suspendMs) this.suspend(options.suspendMs);
    return this.applyScrollTop(side, top, {
      reason: options.reason || 'programmatic',
      behavior: options.behavior || 'auto',
      settleMs: options.settleMs
    });
  }

  compensate(side, delta, reason = 'geometry-compensation') {
    if (this.destroyed || !SIDE_NAMES.has(side) || !Number.isFinite(delta) || Math.abs(delta) < 0.5) return false;
    const changed = this.applyScrollTop(side, this.elements[side].scrollTop + delta, {
      reason,
      behavior: 'auto',
      settleMs: 900
    });
    if (changed) this.notifyGeometryChanged(side);
    return changed;
  }

  notifyGeometryChanged(side = '') {
    if (this.destroyed || (side && !SIDE_NAMES.has(side))) return;
    if (this.geometryFrame) return;
    this.geometryFrame = requestAnimationFrame(() => {
      this.geometryFrame = 0;
      if (this.destroyed || this.sourceOwnership.isSuspended()) return;
      const sourceSide = this.sourceOwnership.getSourceSide();
      if (!sourceSide) return;
      this.stats.geometryResyncs += 1;
      this.callbacks[sourceSide]?.();
    });
  }

  markProgrammaticScroll(side, duration = 700) {
    if (this.destroyed) return;
    this.sourceOwnership.markProgrammaticScroll(side, duration);
  }

  suspend(duration = 360) {
    if (this.destroyed) return;
    this.sourceOwnership.suspend(duration);
  }

  cancelTarget(side = '') {
    if (this.destroyed) return;
    if (this.pendingTarget && (!side || this.pendingTarget.side === side)) this.pendingTarget = null;
    if (!this.pendingTarget && this.targetFrame) {
      cancelAnimationFrame(this.targetFrame);
      this.targetFrame = 0;
    }
  }

  syncNow(side = this.sourceOwnership.getSourceSide()) {
    if (this.destroyed || !SIDE_NAMES.has(side)) return;
    this.callbacks[side]?.();
  }

  getSideForElement(target) {
    if (!target) return '';
    if (target === this.elements.editor || this.elements.editor.contains?.(target)) return 'editor';
    if (target === this.elements.preview || this.elements.preview.contains?.(target)) return 'preview';
    return '';
  }

  classifyScrollTarget(target) {
    const side = this.getSideForElement(target);
    if (!side) return { side: '', origin: 'other' };
    return { side, origin: this.sourceOwnership.classify(side) };
  }

  getState() {
    return {
      ...this.sourceOwnership.getState(),
      pendingTargetSide: this.pendingTarget?.side || '',
      ...this.stats
    };
  }

  getPublicApi() {
    return {
      markProgrammaticScroll: (side, duration) => this.markProgrammaticScroll(side, duration),
      markManualScroll: (side, reason) => this.beginUserGesture(side, reason || 'legacy'),
      suspend: duration => this.suspend(duration),
      scheduleTarget: (side, top, options) => this.scheduleTarget(side, top, options),
      scrollTo: (side, top, options) => this.scrollTo(side, top, options),
      compensate: (side, delta, reason) => this.compensate(side, delta, reason),
      notifyGeometryChanged: side => this.notifyGeometryChanged(side),
      syncNow: side => this.syncNow(side),
      getState: () => this.getState()
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.sourceFrame);
    cancelAnimationFrame(this.targetFrame);
    cancelAnimationFrame(this.geometryFrame);
    this.sourceFrame = 0;
    this.targetFrame = 0;
    this.geometryFrame = 0;
    this.pendingSourceSide = '';
    this.pendingTarget = null;
    this.disposers.splice(0).forEach(dispose => dispose());
    this.callbacks.editor = null;
    this.callbacks.preview = null;
    if (this.ownsSourceOwnership) this.sourceOwnership.destroy?.();
  }
}

export function createScrollSyncController(editor, preview, options = {}) {
  return new ScrollSyncController(editor, preview, options);
}
