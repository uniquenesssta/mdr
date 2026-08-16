/**
 * Responsibility: Orchestrate authenticated scroll-source events into mapper callbacks and cancellable target writes while preserving the frozen R9-01 behavior surface.
 * Imports: Scroll source ownership plus the R9-06 Geometry Session; editor/preview geometry remains owned by dedicated mappers.
 * Exports: ScrollSyncController and createScrollSyncController.
 * State/side effects: Owns element listeners, mapper callback bindings, two cancellable RAF slots, pending target/source work and target/runtime statistics; source and geometry state are delegated to their dedicated owners.
 * Lifecycle: Explicit instance lifecycle; destroy() removes listeners, invalidates queued work, cancels every owned RAF and destroys internally-created source/geometry owners.
 */

import { createScrollSourceOwnership } from './scroll-source-ownership.js';
import { createScrollGeometrySession } from './scroll-geometry-session.js';

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const SIDE_NAMES = new Set(['editor', 'preview']);
const FRAME_NAMES = new Set(['source', 'target']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function resolveFrameCapability(options, optionName, globalName) {
  const explicit = options[optionName];
  const candidate = explicit ?? globalThis[globalName];
  if (typeof candidate !== 'function') {
    throw new Error(`ScrollSyncController requires a ${optionName} capability`);
  }
  return explicit ? explicit : candidate.bind(globalThis);
}

function assertSourceOwnership(sourceOwnership) {
  const required = [
    'beginUserGesture',
    'touchSource',
    'markProgrammaticScroll',
    'suspend',
    'isProgrammatic',
    'isSuspended',
    'isSource',
    'getSourceSide',
    'classify',
    'nextSequence',
    'getState'
  ];
  if (!sourceOwnership || required.some(name => typeof sourceOwnership[name] !== 'function')) {
    throw new Error('ScrollSyncController requires a ScrollSourceOwnership capability');
  }
}

export class ScrollSyncController {
  constructor(editor, preview, options = {}) {
    if (!editor || !preview) throw new Error('ScrollSyncController requires editor and preview elements');
    const sourceOwnership = options.sourceOwnership || createScrollSourceOwnership();
    assertSourceOwnership(sourceOwnership);

    this.elements = { editor, preview };
    this.sourceOwnership = sourceOwnership;
    this.ownsSourceOwnership = !options.sourceOwnership;
    this.frameRuntime = {
      request: resolveFrameCapability(options, 'requestFrame', 'requestAnimationFrame'),
      cancel: resolveFrameCapability(options, 'cancelFrame', 'cancelAnimationFrame')
    };
    this.mapperCallbacks = {
      editor: null,
      preview: null
    };
    this.frames = { source: null, target: null };
    this.frameVersions = { source: 0, target: 0 };
    this.pendingSourceSide = '';
    this.pendingTarget = null;
    this.stats = {
      targetWrites: 0,
      ignoredTargetEvents: 0,
      lastTargetSide: '',
      lastTargetTop: 0,
      lastTargetDelta: 0
    };
    this.disposers = [];
    this.destroyed = false;
    this.geometrySession = createScrollGeometrySession({
      sourceOwnership: this.sourceOwnership,
      readScrollTop: side => this.elements[side].scrollTop,
      applyScrollTop: (side, top, geometryOptions) => this.applyScrollTop(side, top, geometryOptions),
      scheduleSourceSync: side => this.scheduleSourceSync(side)
    });
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
    this.mapperCallbacks.editor = typeof callbacks.syncFromEditor === 'function' ? callbacks.syncFromEditor : null;
    this.mapperCallbacks.preview = typeof callbacks.syncFromPreview === 'function' ? callbacks.syncFromPreview : null;
  }

  queueFrame(name, publish) {
    if (this.destroyed || !FRAME_NAMES.has(name) || this.frames[name] !== null) return false;
    const version = ++this.frameVersions[name];
    const frameId = this.frameRuntime.request(() => {
      if (this.destroyed || this.frameVersions[name] !== version) return;
      this.frames[name] = null;
      publish();
    });
    this.frames[name] = frameId;
    return true;
  }

  cancelQueuedFrame(name) {
    if (!FRAME_NAMES.has(name)) return;
    const frameId = this.frames[name];
    this.frameVersions[name] += 1;
    this.frames[name] = null;
    if (frameId !== null) this.frameRuntime.cancel(frameId);
  }

  cancelSourceSync() {
    this.pendingSourceSide = '';
    this.geometrySession.cancelPending();
    this.cancelQueuedFrame('source');
  }

  beginUserGesture(side, reason = 'user') {
    if (this.destroyed || !SIDE_NAMES.has(side)) return;
    const result = this.sourceOwnership.beginUserGesture(side, reason);
    if (!result?.sourceChanged) return;
    this.cancelSourceSync();
    this.cancelTarget(side);
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
    if (this.destroyed || !SIDE_NAMES.has(side)) return false;
    this.pendingSourceSide = side;
    if (this.frames.source !== null) return true;
    return this.queueFrame('source', () => this.flushSourceSync());
  }

  flushSourceSync() {
    const side = this.pendingSourceSide;
    this.pendingSourceSide = '';
    const published = Boolean(side && this.sourceOwnership.isSource(side) && !this.sourceOwnership.isSuspended());
    this.geometrySession.settleSourceSync(side, { published });
    if (!published) return;
    this.mapperCallbacks[side]?.();
  }

  scheduleTarget(side, top, options = {}) {
    if (this.destroyed || !SIDE_NAMES.has(side)) return false;
    const element = this.elements[side];
    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    this.pendingTarget = {
      side,
      top: clamp(top, 0, maxScroll),
      reason: String(options.reason || 'linked-scroll'),
      settleMs: Math.max(120, Number(options.settleMs) || 700),
      sequence: this.sourceOwnership.nextSequence()
    };
    if (this.frames.target !== null) return true;
    return this.queueFrame('target', () => this.flushTargetWrite());
  }

  flushTargetWrite() {
    const target = this.pendingTarget;
    this.pendingTarget = null;
    if (!target) return;
    this.applyScrollTop(target.side, target.top, {
      reason: target.reason,
      behavior: 'auto',
      settleMs: target.settleMs
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
    if (this.destroyed) return false;
    return this.geometrySession.compensate(side, delta, reason);
  }

  notifyGeometryChanged(side = '') {
    if (this.destroyed) return false;
    return this.geometrySession.notifyGeometryChanged(side);
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
    if (!this.pendingTarget && this.frames.target !== null) this.cancelQueuedFrame('target');
  }

  syncNow(side = this.sourceOwnership.getSourceSide()) {
    if (this.destroyed || !SIDE_NAMES.has(side)) return;
    this.mapperCallbacks[side]?.();
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
      ...this.geometrySession.getState(),
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
    this.cancelQueuedFrame('source');
    this.cancelQueuedFrame('target');
    this.pendingSourceSide = '';
    this.geometrySession.cancelPending();
    this.pendingTarget = null;
    this.disposers.splice(0).forEach(dispose => dispose());
    this.mapperCallbacks.editor = null;
    this.mapperCallbacks.preview = null;
    this.geometrySession.destroy();
    if (this.ownsSourceOwnership) this.sourceOwnership.destroy?.();
  }
}

export function createScrollSyncController(editor, preview, options = {}) {
  return new ScrollSyncController(editor, preview, options);
}
