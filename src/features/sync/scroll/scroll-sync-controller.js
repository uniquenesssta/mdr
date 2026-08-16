/**
 * Responsibility: Preserve the R9-01 scroll behavior contract for user-source acquisition, programmatic scroll suppression, compensation scheduling, timeout windows and runtime statistics.
 * Imports: None; browser timing and element capabilities are consumed only through the explicit controller instance boundary.
 * Exports: ScrollSyncController and createScrollSyncController.
 * State/side effects: Owns one editor/preview scroll session, event listeners, requestAnimationFrame work, source metadata, programmatic windows and statistics; it does not own geometry mapping or selection mapping policy.
 * Lifecycle: Explicit instance lifecycle; destroy() removes listeners, cancels queued animation frames and is safe to repeat.
 */

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const SIDE_NAMES = new Set(['editor', 'preview']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function now() {
  return performance.now();
}

export class ScrollSyncController {
  constructor(editor, preview) {
    if (!editor || !preview) throw new Error('ScrollSyncController requires editor and preview elements');
    this.elements = { editor, preview };
    this.callbacks = {
      editor: null,
      preview: null
    };
    this.sourceSide = '';
    this.sourceReason = '';
    this.sourceLastEventAt = 0;
    this.suspendedUntil = 0;
    this.programmaticUntil = { editor: 0, preview: 0 };
    this.pendingSourceSide = '';
    this.sourceFrame = 0;
    this.pendingTarget = null;
    this.targetFrame = 0;
    this.geometryFrame = 0;
    this.sequence = 0;
    this.stats = {
      sourceSwitches: 0,
      targetWrites: 0,
      ignoredTargetEvents: 0,
      geometryResyncs: 0,
      lastSourceSide: '',
      lastSourceReason: '',
      lastTargetSide: '',
      lastTargetTop: 0,
      lastTargetDelta: 0
    };
    this.disposers = [];
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
    this.callbacks.editor = typeof callbacks.syncFromEditor === 'function' ? callbacks.syncFromEditor : null;
    this.callbacks.preview = typeof callbacks.syncFromPreview === 'function' ? callbacks.syncFromPreview : null;
  }

  beginUserGesture(side, reason = 'user') {
    if (!SIDE_NAMES.has(side)) return;
    if (this.sourceSide !== side) {
      this.stats.sourceSwitches += 1;
      this.cancelTarget(side);
    }
    this.sourceSide = side;
    this.sourceReason = reason;
    this.sourceLastEventAt = now();
    this.programmaticUntil[side] = 0;
    this.stats.lastSourceSide = side;
    this.stats.lastSourceReason = reason;
  }

  handleScroll(side) {
    const timestamp = now();
    if (timestamp < this.programmaticUntil[side]) {
      this.stats.ignoredTargetEvents += 1;
      return;
    }
    if (timestamp < this.suspendedUntil) return;

    // 只有明确的用户输入才能取得滚动源所有权。目标侧的 scroll 事件、
    // 虚拟高度补偿和异步布局变化都不能自动切换源侧。
    if (this.sourceSide !== side) {
      this.stats.ignoredTargetEvents += 1;
      return;
    }

    this.sourceLastEventAt = timestamp;
    this.scheduleSourceSync(side);
  }

  scheduleSourceSync(side) {
    this.pendingSourceSide = side;
    if (this.sourceFrame) return;
    this.sourceFrame = requestAnimationFrame(() => {
      this.sourceFrame = 0;
      const pendingSide = this.pendingSourceSide;
      this.pendingSourceSide = '';
      if (!pendingSide || this.sourceSide !== pendingSide || now() < this.suspendedUntil) return;
      this.callbacks[pendingSide]?.();
    });
  }

  scheduleTarget(side, top, options = {}) {
    if (!SIDE_NAMES.has(side)) return;
    const element = this.elements[side];
    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    const targetTop = clamp(top, 0, maxScroll);
    this.pendingTarget = {
      side,
      top: targetTop,
      reason: String(options.reason || 'linked-scroll'),
      settleMs: Math.max(120, Number(options.settleMs) || 700),
      sequence: ++this.sequence
    };
    if (this.targetFrame) return;
    this.targetFrame = requestAnimationFrame(() => {
      this.targetFrame = 0;
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
    if (!SIDE_NAMES.has(side)) return false;
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
    if (!SIDE_NAMES.has(side) || !Number.isFinite(delta) || Math.abs(delta) < 0.5) return false;
    const changed = this.applyScrollTop(side, this.elements[side].scrollTop + delta, {
      reason,
      behavior: 'auto',
      settleMs: 900
    });
    if (changed) this.notifyGeometryChanged(side);
    return changed;
  }

  notifyGeometryChanged(side = '') {
    if (side && !SIDE_NAMES.has(side)) return;
    if (this.geometryFrame) return;
    this.geometryFrame = requestAnimationFrame(() => {
      this.geometryFrame = 0;
      if (!this.sourceSide || now() < this.suspendedUntil) return;
      this.stats.geometryResyncs += 1;
      this.callbacks[this.sourceSide]?.();
    });
  }

  markProgrammaticScroll(side, duration = 700) {
    if (!SIDE_NAMES.has(side)) return;
    this.programmaticUntil[side] = Math.max(
      this.programmaticUntil[side],
      now() + Math.max(120, Number(duration) || 0)
    );
  }

  suspend(duration = 360) {
    this.suspendedUntil = Math.max(this.suspendedUntil, now() + Math.max(0, Number(duration) || 0));
  }

  cancelTarget(side = '') {
    if (this.pendingTarget && (!side || this.pendingTarget.side === side)) this.pendingTarget = null;
    if (!this.pendingTarget && this.targetFrame) {
      cancelAnimationFrame(this.targetFrame);
      this.targetFrame = 0;
    }
  }

  syncNow(side = this.sourceSide) {
    if (!SIDE_NAMES.has(side)) return;
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
    const timestamp = now();
    if (timestamp < this.programmaticUntil[side]) return { side, origin: 'programmatic' };
    if (side === this.sourceSide) return { side, origin: 'user' };
    return { side, origin: 'passive' };
  }

  getState() {
    return {
      sourceSide: this.sourceSide,
      sourceReason: this.sourceReason,
      sourceLastEventAt: this.sourceLastEventAt,
      suspendedUntil: this.suspendedUntil,
      programmaticUntil: { ...this.programmaticUntil },
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
    cancelAnimationFrame(this.sourceFrame);
    cancelAnimationFrame(this.targetFrame);
    cancelAnimationFrame(this.geometryFrame);
    this.sourceFrame = 0;
    this.targetFrame = 0;
    this.geometryFrame = 0;
    this.pendingTarget = null;
    this.disposers.splice(0).forEach(dispose => dispose());
    this.callbacks.editor = null;
    this.callbacks.preview = null;
  }
}

export function createScrollSyncController(editor, preview) {
  return new ScrollSyncController(editor, preview);
}
