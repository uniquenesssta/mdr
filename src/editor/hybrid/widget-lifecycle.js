const viewGeometryStates = new WeakMap();
const elementCleanups = new WeakMap();

function runGeometryRefresh(view, reason) {
  if (!view || view.destroyed || view.dom?.isConnected === false) return;
  view.requestMeasure();
  window.scheduleEditorMetricsRebuild?.(40);
  window.markdownEditorScrollSync?.notifyGeometryChanged?.('editor');
  window.markdownEditorSelectionController?.notifyEditorGeometry?.(`hybrid-widget:${reason}`);
  window.markdownEditorPerf?.record?.('hybrid.widget-geometry', {
    category: 'editor.hybrid',
    aggregate: true,
    details: { reason }
  });
}

export function scheduleHybridWidgetGeometry(view, reason = 'resize') {
  if (!view || view.destroyed || view.dom?.isConnected === false) return;
  let state = viewGeometryStates.get(view);
  if (!state) {
    state = { frame: 0, settleTimer: 0, reason: '' };
    viewGeometryStates.set(view, state);
  }
  state.reason = reason;
  if (!state.frame) {
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      runGeometryRefresh(view, state.reason || reason);
    });
  }
  clearTimeout(state.settleTimer);
  state.settleTimer = setTimeout(() => {
    state.settleTimer = 0;
    runGeometryRefresh(view, `${state.reason || reason}:settled`);
  }, 120);
}

export function attachHybridWidgetLifecycle(element, view, type) {
  if (!(element instanceof Element)) return () => {};
  let disposed = false;
  let observer = null;
  const reason = String(type || 'block');

  if (typeof ResizeObserver === 'function') {
    let lastWidth = -1;
    let lastHeight = -1;
    observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      const width = Math.round(rect?.width || element.getBoundingClientRect().width || 0);
      const height = Math.round(rect?.height || element.getBoundingClientRect().height || 0);
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      scheduleHybridWidgetGeometry(view, `${reason}-resize`);
    });
    observer.observe(element);
  }

  const initialFrame = requestAnimationFrame(() => {
    if (!disposed) scheduleHybridWidgetGeometry(view, `${reason}-mounted`);
  });

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(initialFrame);
    observer?.disconnect();
    observer = null;
    elementCleanups.delete(element);
  };
  elementCleanups.set(element, cleanup);
  return cleanup;
}

export function destroyHybridWidgetLifecycle(element) {
  elementCleanups.get(element)?.();
}
