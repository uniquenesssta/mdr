/**
 * Responsibility: Map preview source lines to preview content geometry using either virtual height-index capabilities or rendered source anchors, without querying editor internals or owning scroll-source/target writes.
 * Imports: None; consumes an injected preview element, Preview virtual geometry capability and optional ResizeObserver/timer capabilities.
 * Exports: PreviewScrollMapper and createPreviewScrollMapper.
 * State/side effects: Owns only preview anchor/metric caches, preview-body observation and its debounce timer; reports geometry invalidation through an injected callback.
 * Lifecycle: Explicit instance lifecycle; destroy() disconnects observation, clears timers/caches and makes later reads terminal.
 */

function assertCapabilities(previewElement, virtualApi) {
  const previewMethods = ['querySelector', 'querySelectorAll'];
  const virtualMethods = ['getMountedAnchors', 'getMetrics', 'getContentYForLine', 'getLineForContentY'];
  if (!previewElement || previewMethods.some(name => typeof previewElement[name] !== 'function')) {
    throw new TypeError('PreviewScrollMapper requires preview DOM query capabilities');
  }
  if (!virtualApi || virtualMethods.some(name => typeof virtualApi[name] !== 'function')) {
    throw new TypeError('PreviewScrollMapper requires virtual preview geometry capabilities');
  }
}

function findLastMetricIndex(metrics, value, field) {
  let low = 0;
  let high = metrics.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (metrics[mid][field] <= value) low = mid;
    else high = mid - 1;
  }
  return low;
}

export class PreviewScrollMapper {
  constructor({
    previewElement,
    virtualApi,
    createResizeObserver = null,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timerId => clearTimeout(timerId),
    onGeometryChanged = () => {}
  } = {}) {
    assertCapabilities(previewElement, virtualApi);
    if (createResizeObserver !== null && typeof createResizeObserver !== 'function') {
      throw new TypeError('PreviewScrollMapper createResizeObserver must be a function or null');
    }
    if (typeof setTimer !== 'function' || typeof clearTimer !== 'function' || typeof onGeometryChanged !== 'function') {
      throw new TypeError('PreviewScrollMapper requires timer and geometry callback capabilities');
    }
    this.previewElement = previewElement;
    this.virtualApi = virtualApi;
    this.createResizeObserver = createResizeObserver;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onGeometryChanged = onGeometryChanged;
    this.anchorsCache = null;
    this.metricsCache = null;
    this.resizeObserver = null;
    this.observedBody = null;
    this.resizeTimer = 0;
    this.destroyed = false;
  }

  assertActive() {
    if (this.destroyed) throw new Error('PreviewScrollMapper has been destroyed');
  }

  isVirtualActive() {
    this.assertActive();
    return Boolean(this.virtualApi.active);
  }

  getAnchors() {
    this.assertActive();
    if (this.isVirtualActive()) {
      this.anchorsCache = this.virtualApi.getMountedAnchors() || [];
      return this.anchorsCache;
    }
    if (this.anchorsCache) return this.anchorsCache;
    this.anchorsCache = Array.from(this.previewElement.querySelectorAll('[data-source-line]'));
    return this.anchorsCache;
  }

  replaceAnchors(anchors) {
    this.assertActive();
    this.anchorsCache = Array.from(anchors || []);
    return this.anchorsCache;
  }

  invalidateMetrics() {
    this.assertActive();
    this.metricsCache = null;
  }

  invalidateStructure() {
    this.assertActive();
    this.anchorsCache = null;
    this.metricsCache = null;
  }

  observeBodySize() {
    this.assertActive();
    if (!this.createResizeObserver) return;
    if (this.isVirtualActive()) {
      this.resizeObserver?.disconnect();
      this.observedBody = null;
      return;
    }
    const body = this.previewElement.querySelector('.markdown-body');
    if (!body) return;
    if (!this.resizeObserver) {
      this.resizeObserver = this.createResizeObserver(() => {
        if (this.destroyed) return;
        if (this.resizeTimer) this.clearTimer(this.resizeTimer);
        this.resizeTimer = this.setTimer(() => {
          if (this.destroyed) return;
          this.resizeTimer = 0;
          this.metricsCache = null;
          this.onGeometryChanged();
        }, 64);
      });
    }
    if (this.observedBody === body) return;
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(body);
    this.observedBody = body;
  }

  refreshStructure() {
    this.assertActive();
    this.anchorsCache = this.isVirtualActive()
      ? (this.virtualApi.getMountedAnchors() || [])
      : Array.from(this.previewElement.querySelectorAll('[data-source-line]'));
    this.observeBodySize();
    return this.anchorsCache;
  }

  getMetrics() {
    this.assertActive();
    if (this.metricsCache) return this.metricsCache;
    if (this.isVirtualActive()) {
      this.metricsCache = this.virtualApi.getMetrics() || [];
      return this.metricsCache;
    }
    const body = this.previewElement.querySelector('.markdown-body');
    if (!body) return [];
    const bodyTop = Number(body.offsetTop) || 0;
    this.metricsCache = this.getAnchors().map(anchor => {
      const top = bodyTop + (Number(anchor.offsetTop) || 0);
      return {
        anchor,
        startLine: Number(anchor.dataset?.sourceLine || 1),
        endLine: Number(anchor.dataset?.sourceEndLine || anchor.dataset?.sourceLine || 1),
        top,
        bottom: top + Math.max(1, Number(anchor.offsetHeight) || 0)
      };
    });
    return this.metricsCache;
  }

  getAnchorCount() {
    this.assertActive();
    return this.getAnchors().length;
  }

  findAnchor(line) {
    this.assertActive();
    const metrics = this.getMetrics();
    if (!metrics.length) return null;
    const index = findLastMetricIndex(metrics, Math.max(1, Number(line) || 1), 'startLine');
    return metrics[index]?.anchor || metrics[0].anchor;
  }

  getContentYForLine(lineFloat) {
    this.assertActive();
    if (this.isVirtualActive()) return this.virtualApi.getContentYForLine(lineFloat);
    const metrics = this.getMetrics();
    if (!metrics.length) return 0;
    const line = Math.max(1, Number(lineFloat) || 1);
    if (line <= metrics[0].startLine) return metrics[0].top;
    const index = findLastMetricIndex(metrics, line, 'startLine');
    const current = metrics[index];
    const next = metrics[index + 1];
    if (line <= current.endLine + 0.999 || !next) {
      const span = Math.max(1, current.endLine - current.startLine + 1);
      const fraction = Math.max(0, Math.min(1, (line - current.startLine) / span));
      return current.top + (current.bottom - current.top) * fraction;
    }
    const gapLines = Math.max(1, next.startLine - current.endLine);
    const fraction = Math.max(0, Math.min(1, (line - current.endLine) / gapLines));
    return current.bottom + (next.top - current.bottom) * fraction;
  }

  getLineForContentY(contentY) {
    this.assertActive();
    if (this.isVirtualActive()) return this.virtualApi.getLineForContentY(contentY);
    const metrics = this.getMetrics();
    if (!metrics.length) return 1;
    const y = Math.max(0, Number(contentY) || 0);
    if (y <= metrics[0].top) return metrics[0].startLine;
    const index = findLastMetricIndex(metrics, y, 'top');
    const current = metrics[index];
    const next = metrics[index + 1];
    if (y <= current.bottom || !next) {
      const fraction = Math.max(0, Math.min(1, (y - current.top) / Math.max(1, current.bottom - current.top)));
      return current.startLine + fraction * Math.max(1, current.endLine - current.startLine + 1);
    }
    const fraction = Math.max(0, Math.min(1, (y - current.bottom) / Math.max(1, next.top - current.bottom)));
    return current.endLine + fraction * Math.max(1, next.startLine - current.endLine);
  }

  getTopVisibleLine(scrollTop, offsetPx = 8) {
    this.assertActive();
    return Math.max(1, Math.floor(this.getLineForContentY(Math.max(0, Number(scrollTop) || 0) + Math.max(0, Number(offsetPx) || 0))));
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.resizeTimer) this.clearTimer(this.resizeTimer);
    this.resizeTimer = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.observedBody = null;
    this.anchorsCache = null;
    this.metricsCache = null;
    this.previewElement = null;
    this.virtualApi = null;
    this.createResizeObserver = null;
    this.setTimer = null;
    this.clearTimer = null;
    this.onGeometryChanged = null;
  }
}

export function createPreviewScrollMapper(options = {}) {
  return new PreviewScrollMapper(options);
}
