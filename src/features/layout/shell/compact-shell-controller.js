/**
 * Responsibility: Own compact-shell width hysteresis and the observable viewport-resize burst lifecycle.
 * Imports: Shared responsive breakpoint policy only.
 * Exports: createCompactShellController() and WINDOW_RESIZE_SETTLE_MS.
 * State/side effects: Writes canonical LayoutState compact/sidebar/resize fields, compact-shell root classes, scoped timers/RAF, and one viewport resize listener.
 * Lifecycle: Explicit start/destroy; destroy removes the listener, cancels scheduled work, clears burst state, and is terminal.
 */
import { getCompactShellMaxWidth } from './responsive-breakpoints.js';

export const WINDOW_RESIZE_SETTLE_MS = 220;

function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

export function createCompactShellController({
  state,
  root,
  viewport,
  requestFrame,
  cancelFrame,
  setTimer,
  clearTimer,
  now,
  closeMenus = () => {},
  onGeometryChanged = () => {},
  record = () => {},
  settleMs = WINDOW_RESIZE_SETTLE_MS
} = {}) {
  requireObject(state, 'Compact Shell LayoutState');
  requireFunction(state.setCompact, 'LayoutState.setCompact');
  requireFunction(state.setSidebar, 'LayoutState.setSidebar');
  requireFunction(state.setResize, 'LayoutState.setResize');
  requireObject(root, 'Compact Shell root');
  requireObject(root.classList, 'Compact Shell root classList');
  requireObject(viewport, 'Compact Shell viewport');
  requireFunction(viewport.addEventListener, 'Compact Shell viewport addEventListener');
  requireFunction(viewport.removeEventListener, 'Compact Shell viewport removeEventListener');
  requireFunction(requestFrame, 'Compact Shell requestFrame');
  requireFunction(cancelFrame, 'Compact Shell cancelFrame');
  requireFunction(setTimer, 'Compact Shell setTimer');
  requireFunction(clearTimer, 'Compact Shell clearTimer');
  requireFunction(now, 'Compact Shell clock');
  requireFunction(closeMenus, 'Compact Shell menu close callback');
  requireFunction(onGeometryChanged, 'Compact Shell geometry callback');
  requireFunction(record, 'Compact Shell recorder');
  if (!Number.isFinite(Number(settleMs)) || Number(settleMs) < 0) throw new TypeError('Compact Shell settleMs must be non-negative.');

  let started = false;
  let destroyed = false;
  let evaluationFrame = 0;
  let settleTimer = 0;

  const snapshot = () => state.snapshot;
  const width = () => Math.max(0, Number(viewport.innerWidth) || 0);

  function projectRoot(active) {
    root.classList.toggle('compact-shell', Boolean(active));
    root.classList.toggle('is-compact-shell', Boolean(active));
  }

  function reconcile(reason = 'manual') {
    if (destroyed) throw new Error('Compact Shell Controller is destroyed.');
    const current = snapshot();
    const viewportWidth = width();
    const threshold = getCompactShellMaxWidth(current.compact.shellActive);
    const nextActive = viewportWidth > 0 && viewportWidth <= threshold;
    const shellChanged = nextActive !== current.compact.shellActive;
    const sidebarChanged = nextActive !== current.sidebar.autoCollapsed;
    if (shellChanged) state.setCompact({ shellActive: nextActive });
    if (sidebarChanged) state.setSidebar({ autoCollapsed: nextActive });
    projectRoot(nextActive);
    if (shellChanged || sidebarChanged) {
      closeMenus();
      onGeometryChanged(Object.freeze({ reason, active: nextActive, viewportWidth }));
      record('layout.compact-shell-change', {
        category: 'ui.layout',
        durationMs: 0,
        details: { active: nextActive, viewportWidth, sidebarAutoCollapsed: nextActive, reason }
      });
    }
    return nextActive;
  }

  function scheduleEvaluation(reason = 'resize') {
    if (destroyed) return false;
    if (evaluationFrame) cancelFrame(evaluationFrame);
    evaluationFrame = requestFrame(() => {
      evaluationFrame = 0;
      if (!destroyed) reconcile(reason);
    });
    return true;
  }

  function settleResizeBurst() {
    settleTimer = 0;
    if (destroyed) return;
    const current = snapshot().resize;
    const timestamp = now();
    const durationMs = current.windowBurstStartedAt
      ? Math.max(0, timestamp - current.windowBurstStartedAt)
      : 0;
    const events = current.windowBurstEvents;
    state.setResize({ windowActiveUntil: 0, windowBurstStartedAt: 0, windowBurstEvents: 0 });
    scheduleEvaluation('resize-settled');
    record('layout.window-resize-settled', {
      category: 'ui.layout',
      durationMs: 0,
      details: {
        durationMs: Number(durationMs.toFixed(1)),
        events,
        viewportWidth: width(),
        viewportHeight: Math.max(0, Number(viewport.innerHeight) || 0)
      }
    });
  }

  function onViewportResize() {
    if (destroyed) return;
    const timestamp = now();
    const current = snapshot().resize;
    state.setResize({
      windowActiveUntil: timestamp + Number(settleMs),
      windowBurstStartedAt: current.windowBurstStartedAt || timestamp,
      windowBurstEvents: current.windowBurstEvents + 1
    });
    closeMenus();
    scheduleEvaluation('resize');
    if (settleTimer) clearTimer(settleTimer);
    settleTimer = setTimer(settleResizeBurst, Number(settleMs));
  }

  const controller = Object.freeze({
    start() {
      if (destroyed) throw new Error('Compact Shell Controller is destroyed.');
      if (started) return controller;
      if (!snapshot().compact.shellInitialized) state.setCompact({ shellInitialized: true });
      viewport.addEventListener('resize', onViewportResize, { passive: true });
      started = true;
      reconcile('start');
      return controller;
    },
    reconcile,
    scheduleEvaluation,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (started) viewport.removeEventListener('resize', onViewportResize);
      if (evaluationFrame) cancelFrame(evaluationFrame);
      evaluationFrame = 0;
      if (settleTimer) clearTimer(settleTimer);
      settleTimer = 0;
      const current = snapshot();
      if (current.resize.windowActiveUntil || current.resize.windowBurstStartedAt || current.resize.windowBurstEvents) {
        state.setResize({ windowActiveUntil: 0, windowBurstStartedAt: 0, windowBurstEvents: 0 });
      }
      if (current.compact.shellInitialized) state.setCompact({ shellInitialized: false });
      started = false;
    }
  });
  return controller;
}
