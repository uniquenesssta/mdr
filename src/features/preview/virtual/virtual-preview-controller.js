import {
  PREVIEW_BEHAVIOR_THRESHOLDS,
  VirtualWindowController
} from '../index.js';

/**
 * Responsibility: Adapt the canonical VirtualWindowController to Preview runtime capabilities using explicit dependencies.
 * State/side effects: Owns virtual-window lifecycle only; no window globals or classic-script lookups.
 */
export class VirtualPreviewController extends VirtualWindowController {
  constructor(preview, options = {}) {
    const runtime = options.runtime || preview?.ownerDocument?.defaultView || globalThis;
    const scheduler = options.scheduler;
    const selection = options.selectionController;
    const scroll = options.scrollController;
    const invalidateAnchorMetrics = typeof options.invalidateAnchorMetrics === 'function'
      ? options.invalidateAnchorMetrics
      : () => {};
    super(preview, {
      thresholds: options.thresholds || PREVIEW_BEHAVIOR_THRESHOLDS,
      documentRef: preview?.ownerDocument || runtime.document,
      storage: options.storage || runtime.localStorage,
      requestFrame: callback => runtime.requestAnimationFrame(callback),
      cancelFrame: handle => runtime.cancelAnimationFrame(handle),
      createResizeObserver: typeof runtime.ResizeObserver === 'function'
        ? callback => new runtime.ResizeObserver(callback)
        : null,
      getComputedStyleFn: node => runtime.getComputedStyle(node),
      scheduleTimer: (callback, delay) => runtime.setTimeout(callback, delay),
      cancelTimer: handle => runtime.clearTimeout(handle),
      scheduleIdle(callback) {
        if (scheduler?.schedule) {
          return scheduler.schedule('preview-height-cache', callback, { priority: 'idle', timeout: 1200 });
        }
        return callback();
      },
      cancelIdle: () => scheduler?.cancel?.('preview-height-cache'),
      now: () => runtime.Date.now(),
      notifyPreviewMounted: reason => selection?.notifyPreviewMounted?.(reason),
      notifyGeometryChanged: reason => scroll?.notifyGeometryChanged?.(reason),
      invalidateAnchorMetrics,
      compensateScroll(delta, reason) {
        if (scroll?.compensate) return scroll.compensate('preview', delta, reason);
        preview.scrollTop += delta;
        return true;
      },
      reportError: typeof options.reportError === 'function'
        ? options.reportError
        : (message, error) => console.debug(message, error?.message || error)
    });
  }
}

export function createVirtualPreviewController(preview, options) {
  return new VirtualPreviewController(preview, options);
}
