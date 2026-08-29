import { getHybridSyncCapabilities } from '../runtime/hybrid-sync-capabilities.js';

/**
 * Atomic 8.5 Widget Geometry Scheduler.
 * Owns the per-editor animation-frame/settle queue and geometry refresh side effects.
 * Widget element observation and component-specific cleanup are outside this module.
 */
const geometrySchedulers = new WeakMap();

function resolveRuntimeWindow(view) {
  return view?.dom?.ownerDocument?.defaultView || globalThis.window || null;
}

function canRefreshGeometry(view) {
  return Boolean(view
    && !view.destroyed
    && view.dom?.isConnected !== false
    && typeof view.requestMeasure === 'function');
}

function runGeometryRefresh(view, reason) {
  if (!canRefreshGeometry(view)) return false;
  const runtimeWindow = resolveRuntimeWindow(view);
  view.requestMeasure();
  runtimeWindow?.scheduleEditorMetricsRebuild?.(40);
  const sync = getHybridSyncCapabilities();
  sync?.notifyScrollGeometry('editor');
  sync?.notifySelectionGeometry(`hybrid-widget:${reason}`);
  runtimeWindow?.markdownEditorPerf?.record?.('hybrid.widget-geometry', {
    category: 'editor.hybrid',
    aggregate: true,
    details: { reason }
  });
  return true;
}

function createGeometryScheduler(view) {
  const runtimeWindow = resolveRuntimeWindow(view);
  const requestFrame = runtimeWindow?.requestAnimationFrame || globalThis.requestAnimationFrame;
  const cancelFrame = runtimeWindow?.cancelAnimationFrame || globalThis.cancelAnimationFrame;
  const setTimer = runtimeWindow?.setTimeout || globalThis.setTimeout;
  const clearTimer = runtimeWindow?.clearTimeout || globalThis.clearTimeout;
  if (typeof requestFrame !== 'function' || typeof setTimer !== 'function') return null;

  let destroyed = false;
  let frame = 0;
  let settleTimer = 0;
  let reason = '';

  const scheduler = {
    request(nextReason = 'resize') {
      if (destroyed || !canRefreshGeometry(view)) return false;
      reason = String(nextReason || 'resize');

      if (!frame) {
        frame = requestFrame.call(runtimeWindow, () => {
          frame = 0;
          if (destroyed) return;
          runGeometryRefresh(view, reason || nextReason);
        });
      }

      if (settleTimer && typeof clearTimer === 'function') {
        clearTimer.call(runtimeWindow, settleTimer);
      }
      settleTimer = setTimer.call(runtimeWindow, () => {
        settleTimer = 0;
        if (destroyed) return;
        runGeometryRefresh(view, `${reason || nextReason}:settled`);
      }, 120);
      return true;
    },

    destroy() {
      if (destroyed) return false;
      destroyed = true;
      if (frame && typeof cancelFrame === 'function') cancelFrame.call(runtimeWindow, frame);
      if (settleTimer && typeof clearTimer === 'function') clearTimer.call(runtimeWindow, settleTimer);
      frame = 0;
      settleTimer = 0;
      reason = '';
      if (geometrySchedulers.get(view) === scheduler) geometrySchedulers.delete(view);
      return true;
    }
  };

  return scheduler;
}

function getGeometryScheduler(view) {
  if (!view || typeof view !== 'object' || !canRefreshGeometry(view)) return null;
  let scheduler = geometrySchedulers.get(view);
  if (scheduler) return scheduler;
  scheduler = createGeometryScheduler(view);
  if (scheduler) geometrySchedulers.set(view, scheduler);
  return scheduler;
}

export function scheduleHybridWidgetGeometry(view, reason = 'resize') {
  return getGeometryScheduler(view)?.request(reason) || false;
}

export function destroyHybridWidgetGeometryScheduler(view) {
  return geometrySchedulers.get(view)?.destroy() || false;
}
