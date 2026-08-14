import {
  PREVIEW_BEHAVIOR_THRESHOLDS,
  VirtualWindowController,
  createVirtualWindowController
} from '../features/preview/index.js';

export class VirtualPreviewController extends VirtualWindowController {
  constructor(preview) {
    const runtime = preview?.ownerDocument?.defaultView || globalThis;
    super(preview, {
      thresholds: PREVIEW_BEHAVIOR_THRESHOLDS,
      documentRef: preview?.ownerDocument || runtime.document,
      storage: runtime.localStorage,
      requestFrame: callback => runtime.requestAnimationFrame(callback),
      cancelFrame: handle => runtime.cancelAnimationFrame(handle),
      createResizeObserver: typeof runtime.ResizeObserver === 'function'
        ? callback => new runtime.ResizeObserver(callback)
        : null,
      getComputedStyleFn: node => runtime.getComputedStyle(node),
      scheduleTimer: (callback, delay) => runtime.setTimeout(callback, delay),
      cancelTimer: handle => runtime.clearTimeout(handle),
      scheduleIdle(callback) {
        const scheduler = runtime.markdownEditorTaskScheduler;
        if (scheduler?.schedule) {
          return scheduler.schedule('preview-height-cache', callback, { priority: 'idle', timeout: 1200 });
        }
        return callback();
      },
      cancelIdle: () => runtime.markdownEditorTaskScheduler?.cancel?.('preview-height-cache'),
      now: () => runtime.Date.now(),
      notifyPreviewMounted: reason => runtime.markdownEditorSelectionController?.notifyPreviewMounted?.(reason),
      notifyGeometryChanged: reason => runtime.markdownEditorScrollController?.notifyGeometryChanged?.(reason),
      invalidateAnchorMetrics: () => runtime.invalidatePreviewAnchorMetrics?.(),
      compensateScroll(delta, reason) {
        const controller = runtime.markdownEditorScrollController;
        if (controller?.compensate) {
          controller.compensate('preview', delta, reason);
          return true;
        }
        runtime.markdownEditorScrollSync?.markProgrammaticScroll?.('preview', 900);
        preview.scrollTop += delta;
        return true;
      },
      reportError(message, error) {
        runtime.console?.debug?.(message, error?.message || error);
      }
    });
  }
}

export function createVirtualPreviewController(preview) {
  return new VirtualPreviewController(preview);
}

export { createVirtualWindowController };
