/**
 * Responsibility: Own Preview pane visibility detection, bounded stable-size convergence and post-layout geometry notification.
 * Imports: None; Preview Scheduler, DOM roots, ResizeObserver factory and side-effect capabilities are injected.
 * Exports: createPreviewLayoutStability().
 * State/side effects: Owns one resize observer, observed size, one connected capability set and the shared layout scheduling channel only.
 * Lifecycle: connect() is one-time; start() is idempotent; cancel()/destroy() invalidate queued layout work and destroy() is terminal.
 */
const SIZE_TOLERANCE_PX = 1;

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`Preview Layout Stability requires ${label}().`);
  return value;
}

function normalizeThresholds(value) {
  const maxAttempts = Math.floor(Number(value?.maxAttempts));
  const stableFrames = Math.floor(Number(value?.stableFrames));
  const retryMs = Number(value?.retryMs);
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('Preview Layout Stability maxAttempts must be at least 1.');
  }
  if (!Number.isFinite(stableFrames) || stableFrames < 0) {
    throw new RangeError('Preview Layout Stability stableFrames must be non-negative.');
  }
  if (!Number.isFinite(retryMs) || retryMs < 0) {
    throw new RangeError('Preview Layout Stability retryMs must be non-negative.');
  }
  return Object.freeze({ maxAttempts, stableFrames, retryMs });
}

function normalizeRenderTarget(value) {
  return Object.freeze({
    present: Boolean(value?.present),
    loading: Boolean(value?.loading),
    empty: Boolean(value?.empty)
  });
}

function normalizeStats(value) {
  const previewBlocks = Math.max(0, Number(value?.previewBlocks) || 0);
  const mountedBlocks = Math.max(0, Number(value?.mountedBlocks) || 0);
  return Object.freeze({ previewBlocks, mountedBlocks });
}

export function createPreviewLayoutStability(options = {}) {
  const root = options.root;
  const pane = options.pane;
  const scheduler = options.scheduler;
  if (!root || typeof root !== 'object') throw new TypeError('Preview Layout Stability requires a preview root.');
  if (!pane || typeof pane !== 'object' || typeof pane.classList?.contains !== 'function') {
    throw new TypeError('Preview Layout Stability requires a preview pane.');
  }
  if (!scheduler || typeof scheduler.schedule !== 'function' || typeof scheduler.cancel !== 'function') {
    throw new TypeError('Preview Layout Stability requires Preview Scheduler.');
  }

  const thresholds = normalizeThresholds(options.thresholds);
  const createResizeObserver = typeof options.createResizeObserver === 'function'
    ? options.createResizeObserver
    : null;
  const now = typeof options.now === 'function'
    ? options.now
    : () => globalThis.performance?.now?.() ?? Date.now();
  const record = typeof options.record === 'function' ? options.record : () => {};
  const reportError = typeof options.reportError === 'function'
    ? options.reportError
    : (message, error) => console.error(message, error);

  let capabilities = null;
  let observer = null;
  let started = false;
  let destroyed = false;
  let observedWidth = 0;
  let observedHeight = 0;

  const assertActive = () => {
    if (destroyed) throw new Error('Preview Layout Stability is destroyed.');
  };
  const assertConnected = () => {
    assertActive();
    if (!capabilities) throw new Error('Preview Layout Stability is not connected.');
  };

  function readLayout() {
    const width = Math.round(Number(root.clientWidth) || 0);
    const height = Math.round(Number(root.clientHeight) || 0);
    return Object.freeze({
      width,
      height,
      visible: Boolean(!pane.classList.contains('collapsed') && width > 0 && height > 0)
    });
  }

  function inspectRenderTarget() {
    return normalizeRenderTarget(capabilities.inspectRenderTarget());
  }

  function renderRequired(forceRender) {
    const target = inspectRenderTarget();
    return Boolean(
      forceRender
      || !capabilities.hasStablePreview()
      || !target.present
      || target.loading
      || target.empty
    );
  }

  function refreshGeometry(task) {
    const refresh = () => {
      capabilities.refreshViewport();
      capabilities.invalidateGeometry();
      capabilities.notifyGeometryChanged('preview');
    };
    if (!task.commit(refresh)) return false;
    task.schedule(nextTask => nextTask.commit(refresh), { kind: 'frame' });
    return true;
  }

  function requestRefresh(optionsValue = {}) {
    assertConnected();
    const forceRender = optionsValue.forceRender !== false;
    const reason = String(optionsValue.reason || 'layout-visible');
    let attempts = 0;
    let stableFrames = 0;
    let previousWidth = -1;
    let previousHeight = -1;

    const run = async task => {
      if (!task.isCurrent() || capabilities.isSuspended()) return;
      const layout = readLayout();
      attempts += 1;

      if (!layout.visible) {
        if (attempts < thresholds.maxAttempts) {
          task.schedule(run, { kind: 'timeout', delay: thresholds.retryMs });
        }
        return;
      }

      if (Math.abs(layout.width - previousWidth) <= SIZE_TOLERANCE_PX
        && Math.abs(layout.height - previousHeight) <= SIZE_TOLERANCE_PX) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        previousWidth = layout.width;
        previousHeight = layout.height;
      }

      if (stableFrames < thresholds.stableFrames && attempts < thresholds.maxAttempts) {
        task.schedule(run, { kind: 'frame' });
        return;
      }

      const shouldRender = renderRequired(forceRender);
      const startedAt = now();
      try {
        if (shouldRender) await Promise.resolve(capabilities.render());
        if (!task.isCurrent() || capabilities.isSuspended()) return;
        refreshGeometry(task);
      } catch (error) {
        task.commit(() => reportError('Preview layout refresh failed.', error));
      } finally {
        task.commit(() => {
          const stats = normalizeStats(capabilities.getStats());
          record('render.preview-layout-refresh', {
            category: 'render.pipeline',
            durationMs: Math.max(0, now() - startedAt),
            aggregate: true,
            details: {
              reason,
              forceRender,
              renderRequired: shouldRender,
              attempts,
              stableFrames,
              width: layout.width,
              height: layout.height,
              previewBlocks: stats.previewBlocks,
              mountedBlocks: stats.mountedBlocks
            }
          });
        });
      }
    };

    return scheduler.schedule('layout', run, { kind: 'frame' });
  }

  function handleResize() {
    if (destroyed || !capabilities || capabilities.isSuspended()) return;
    const layout = readLayout();
    const becameVisible = layout.visible && (observedWidth <= 0 || observedHeight <= 0);
    const sizeChanged = layout.visible && (
      Math.abs(layout.width - observedWidth) > SIZE_TOLERANCE_PX
      || Math.abs(layout.height - observedHeight) > SIZE_TOLERANCE_PX
    );
    observedWidth = layout.width;
    observedHeight = layout.height;
    if (!layout.visible || (!becameVisible && !sizeChanged)) return;

    const target = inspectRenderTarget();
    requestRefresh({
      forceRender: becameVisible
        || !capabilities.hasStablePreview()
        || !target.present
        || target.loading
        || target.empty,
      reason: becameVisible ? 'preview-became-visible' : 'preview-container-resize'
    });
  }

  return Object.freeze({
    connect(value = {}) {
      assertActive();
      if (capabilities) throw new Error('Preview Layout Stability is already connected.');
      capabilities = Object.freeze({
        isSuspended: requireFunction(value.isSuspended, 'isSuspended'),
        hasStablePreview: requireFunction(value.hasStablePreview, 'hasStablePreview'),
        inspectRenderTarget: requireFunction(value.inspectRenderTarget, 'inspectRenderTarget'),
        render: requireFunction(value.render, 'render'),
        refreshViewport: requireFunction(value.refreshViewport, 'refreshViewport'),
        invalidateGeometry: requireFunction(value.invalidateGeometry, 'invalidateGeometry'),
        notifyGeometryChanged: requireFunction(value.notifyGeometryChanged, 'notifyGeometryChanged'),
        getStats: typeof value.getStats === 'function' ? value.getStats : () => ({})
      });
      return true;
    },
    start() {
      assertConnected();
      if (started) return false;
      const initial = readLayout();
      let nextObserver = null;
      try {
        if (createResizeObserver) {
          nextObserver = createResizeObserver(handleResize);
          if (!nextObserver || typeof nextObserver.observe !== 'function' || typeof nextObserver.disconnect !== 'function') {
            throw new TypeError('Preview Layout Stability ResizeObserver factory returned an invalid observer.');
          }
          nextObserver.observe(pane);
          if (root !== pane) nextObserver.observe(root);
        }
      } catch (error) {
        try { nextObserver?.disconnect?.(); } catch (cleanupError) {
          reportError('Preview Layout Stability observer rollback failed.', cleanupError);
        }
        throw error;
      }
      observer = nextObserver;
      observedWidth = initial.width;
      observedHeight = initial.height;
      started = true;
      return true;
    },
    requestRefresh,
    cancel() {
      assertActive();
      return scheduler.cancel('layout');
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      try { observer?.disconnect(); } catch (error) { errors.push(error); }
      observer = null;
      try { scheduler.cancel('layout'); } catch (error) { errors.push(error); }
      capabilities = null;
      if (errors.length) {
        reportError('Preview Layout Stability cleanup failed.', new AggregateError(errors));
      }
    }
  });
}
