/**
 * Responsibility: Coordinate virtual-preview block mounting over the pure window model, height cache and spacer view.
 * Imports: Virtual Window modules only.
 * Exports: VirtualWindowController and createVirtualWindowController.
 * State/side effects: Owns mounted virtual block DOM and injected frame/observer resources.
 * Lifecycle: activate/deactivate/destroy; destroy is terminal.
 */

import { createVirtualHeightCache } from './height-cache.js';
import { createVirtualSpacerView } from './spacer-view.js';
import { createVirtualWindowModel } from './virtual-window-model.js';

export class VirtualWindowController {
  constructor(preview, {
    thresholds,
    documentRef = preview?.ownerDocument,
    storage = null,
    requestFrame,
    cancelFrame,
    createResizeObserver = null,
    getComputedStyleFn,
    scheduleTimer,
    cancelTimer,
    scheduleIdle,
    cancelIdle,
    now,
    notifyPreviewMounted = () => {},
    notifyGeometryChanged = () => {},
    invalidateAnchorMetrics = () => {},
    compensateScroll = () => false,
    reportError = () => {}
  } = {}) {
    if (!preview) throw new TypeError('Preview root is required.');
    if (!thresholds?.virtualWindow || !thresholds?.mode) throw new TypeError('Preview thresholds are required.');
    if (!documentRef?.createElement || !documentRef?.createDocumentFragment) throw new TypeError('documentRef is required.');
    if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') throw new TypeError('Frame scheduler is required.');
    if (typeof getComputedStyleFn !== 'function') throw new TypeError('getComputedStyleFn is required.');

    this.preview = preview;
    this.documentRef = documentRef;
    this.thresholds = thresholds;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.createResizeObserver = createResizeObserver;
    this.getComputedStyle = getComputedStyleFn;
    this.notifyPreviewMounted = notifyPreviewMounted;
    this.notifyGeometryChanged = notifyGeometryChanged;
    this.invalidateAnchorMetrics = invalidateAnchorMetrics;
    this.compensateScroll = compensateScroll;
    this.body = null;
    this.spacers = null;
    this.blocks = [];
    this.changedIds = new Set();
    this.blockById = new Map();
    this.blockIndexById = new Map();
    this.mounted = new Map();
    this.range = { start: 0, end: 0 };
    this.renderFrame = 0;
    this.measureFrame = 0;
    this.viewportResizeFrame = 0;
    this.viewportWidth = Math.round(preview.clientWidth || 0);
    this.viewportHeight = Math.round(preview.clientHeight || 0);
    this.metricsCache = null;
    this.createNodes = null;
    this.applySourceRange = null;
    this.onNodesMounted = null;
    this.onPrewarmNeeded = null;
    this.priorityChapter = null;
    this.lastPrewarmKey = '';
    this.lastScrollTop = preview.scrollTop || 0;
    this.scrollDirection = 1;
    this.scope = 'virtual';
    this.active = false;
    this.destroyed = false;

    this.heightCache = createVirtualHeightCache({
      storage,
      ...(scheduleTimer ? { scheduleTimer } : {}),
      ...(cancelTimer ? { cancelTimer } : {}),
      ...(scheduleIdle ? { scheduleIdle } : {}),
      ...(cancelIdle ? { cancelIdle } : {}),
      ...(now ? { now } : {}),
      reportError
    });
    this.model = createVirtualWindowModel({
      thresholds: thresholds.virtualWindow,
      getBlockHeight: block => this.heightCache.getHeight(block)
    });

    this.resizeObserver = createResizeObserver
      ? createResizeObserver(() => this.scheduleMeasure())
      : null;
    this.viewportResizeObserver = createResizeObserver
      ? createResizeObserver(entries => this.handleViewportResize(entries))
      : null;
    this.viewportResizeObserver?.observe(preview);

    this.handleScroll = () => {
      if (this.destroyed) return;
      const nextScrollTop = this.preview.scrollTop || 0;
      this.scrollDirection = nextScrollTop >= this.lastScrollTop ? 1 : -1;
      this.lastScrollTop = nextScrollTop;
      this.scheduleWindowUpdate();
    };
    preview.addEventListener('scroll', this.handleScroll, { passive: true });
  }

  assertAlive() {
    if (this.destroyed) throw new Error('Virtual Window controller is destroyed.');
  }

  handleViewportResize(entries) {
    if (this.destroyed) return;
    const rect = entries?.[0]?.contentRect;
    const width = Math.round(rect?.width || this.preview.clientWidth || 0);
    const height = Math.round(rect?.height || this.preview.clientHeight || 0);
    const changed = Math.abs(width - this.viewportWidth) > 1 || Math.abs(height - this.viewportHeight) > 1;
    const becameVisible = width > 0 && height > 0 && (this.viewportWidth <= 0 || this.viewportHeight <= 0);
    this.viewportWidth = width;
    this.viewportHeight = height;
    if (!this.active || width <= 0 || height <= 0 || (!changed && !becameVisible)) return;
    this.cancelFrame(this.viewportResizeFrame);
    this.viewportResizeFrame = this.requestFrame(() => {
      this.viewportResizeFrame = 0;
      if (!this.active || this.preview.clientWidth <= 0 || this.preview.clientHeight <= 0) return;
      this.refreshViewport({ forceWindow: true });
    });
  }

  setCacheContext(documentId, visualKey = '') {
    this.assertAlive();
    this.heightCache.setBlocks(this.blocks);
    return this.heightCache.setContext(documentId, visualKey);
  }

  shouldUse(blocks, sourceLength) {
    this.assertAlive();
    return sourceLength >= this.thresholds.mode.virtualChars
      || (blocks?.length || 0) >= this.thresholds.mode.virtualBlocks;
  }

  activate() {
    this.assertAlive();
    if (this.active && this.body?.isConnected) return;
    this.active = true;
    this.body = this.documentRef.createElement('div');
    this.body.className = 'markdown-body virtual-preview-body';
    this.body.dataset.previewScope = this.scope;
    this.spacers?.destroy();
    this.spacers = createVirtualSpacerView({ documentRef: this.documentRef });
    this.spacers.appendTo(this.body);
    this.preview.replaceChildren(this.body);
    this.mounted.clear();
    this.range = { start: 0, end: 0 };
  }

  deactivate() {
    if (this.destroyed) return;
    this.heightCache.setBlocks(this.blocks);
    this.heightCache.persist();
    if (!this.active) return;
    this.active = false;
    this.cancelFrame(this.renderFrame);
    this.cancelFrame(this.measureFrame);
    this.cancelFrame(this.viewportResizeFrame);
    this.renderFrame = 0;
    this.measureFrame = 0;
    this.viewportResizeFrame = 0;
    this.resizeObserver?.disconnect();
    this.mounted.clear();
    this.range = { start: 0, end: 0 };
    this.metricsCache = null;
    this.lastPrewarmKey = '';
    this.spacers?.destroy();
    this.spacers = null;
    this.body = null;
  }

  rebuildBlockMaps() {
    this.blockById = new Map();
    this.blockIndexById = new Map();
    for (let index = 0; index < this.blocks.length; index += 1) {
      const block = this.blocks[index];
      this.blockById.set(block.id, block);
      this.blockIndexById.set(block.id, index);
    }
  }

  rebuildModel() {
    this.heightCache.setBlocks(this.blocks);
    this.model.setBlocks(this.blocks);
    this.metricsCache = null;
  }

  captureScrollAnchor() {
    if (!this.active) return null;
    return this.model.captureAnchor(this.preview.scrollTop, this.body?.offsetTop || 0);
  }

  restoreScrollAnchor(anchor) {
    if (!anchor?.blockId || !this.active) return;
    const targetTop = this.model.getAnchorScrollTop(anchor, this.blockIndexById, this.body?.offsetTop || 0);
    if (!Number.isFinite(targetTop)) return;
    const delta = targetTop - this.preview.scrollTop;
    if (Math.abs(delta) < 1) return;
    const compensated = this.compensateScroll(delta, 'virtual-preview-model');
    if (!compensated) this.preview.scrollTop += delta;
    this.lastScrollTop = this.preview.scrollTop;
  }

  refreshRenderData(result) {
    this.assertAlive();
    if (!this.active) return;
    this.blocks = result?.blocks || this.blocks;
    this.rebuildBlockMaps();
    this.heightCache.setBlocks(this.blocks);
    this.heightCache.restore(this.blocks);
    this.rebuildModel();
    this.priorityChapter = result?.focusChapter || null;
  }

  update(result, options = {}) {
    this.assertAlive();
    this.activate();
    const scrollAnchor = options.forceAll ? null : this.captureScrollAnchor();
    this.blocks = result?.blocks || [];
    this.rebuildBlockMaps();
    this.changedIds = new Set(result?.changedIds || []);
    this.createNodes = options.createNodes;
    this.applySourceRange = options.applySourceRange;
    this.onNodesMounted = options.onNodesMounted;
    this.onPrewarmNeeded = options.onPrewarmNeeded || null;
    this.priorityChapter = result?.focusChapter || null;
    this.scope = options.scope === 'chapter' ? 'chapter' : 'virtual';
    this.body.dataset.previewScope = this.scope;

    if (typeof this.createNodes !== 'function' || typeof this.applySourceRange !== 'function') {
      throw new TypeError('Virtual Window render ports are incomplete.');
    }

    if (options.forceAll) {
      this.heightCache.retainIds(new Set(this.blocks.map(block => block.id)));
      this.mounted.clear();
    } else {
      for (const id of result?.removedIds || []) {
        this.heightCache.remove(id);
        this.mounted.delete(id);
      }
    }

    this.heightCache.setBlocks(this.blocks);
    this.heightCache.restore(this.blocks);
    this.rebuildModel();
    const mountResult = this.renderWindow(Boolean(options.forceAll));
    this.restoreScrollAnchor(scrollAnchor);
    this.notifyGeometryChanged('preview');
    return {
      body: this.body,
      changedNodes: mountResult.changedNodes,
      reused: mountResult.reused,
      parsedChars: result?.parsedChars,
      mode: result?.incremental ? 'worker-virtual-incremental' : 'worker-virtual-' + result?.reason,
      virtualized: true,
      blockCount: this.blocks.length
    };
  }

  calculateWindow() {
    this.assertAlive();
    return this.model.calculateWindow(this.preview.scrollTop, this.preview.clientHeight);
  }

  updateSpacers(range = this.range) {
    const top = this.model.offsets[range.start] || 0;
    const bottom = Math.max(0, this.model.totalHeight - (this.model.offsets[range.end] || 0));
    this.spacers?.update(top, bottom);
  }

  createWrapper(block, index, changedNodes, mountedNodes) {
    const wrapper = this.documentRef.createElement('div');
    wrapper.className = 'preview-virtual-block';
    wrapper.dataset.previewBlockId = block.id;
    wrapper.dataset.previewBlockType = block.type || 'unknown';
    const nodes = this.createNodes(block);
    this.applySourceRange([wrapper], block);
    wrapper.append(...nodes);
    wrapper.dataset.previewBlockIndex = String(index);
    if (this.changedIds.has(block.id)) changedNodes.push(...nodes);
    mountedNodes.push(...nodes);
    this.changedIds.delete(block.id);
    return wrapper;
  }

  observeMounted() {
    this.resizeObserver?.disconnect();
    for (const wrapper of this.mounted.values()) this.resizeObserver?.observe(wrapper);
  }

  renderWindow(force = false, explicitRange = null) {
    this.assertAlive();
    if (!this.active || !this.body) return { changedNodes: [], reused: 0 };
    const nextRange = explicitRange || this.calculateWindow();
    const sameRange = nextRange.start === this.range.start && nextRange.end === this.range.end;
    this.updateSpacers(nextRange);

    if (!force && sameRange) {
      const nextMounted = new Map();
      const changedNodes = [];
      const mountedNodes = [];
      let reused = 0;

      for (let index = nextRange.start; index < nextRange.end; index += 1) {
        const block = this.blocks[index];
        const childIndex = index - nextRange.start + 1;
        const currentWrapper = this.body.children[childIndex] || null;
        const contentChanged = this.changedIds.has(block.id);
        let wrapper = currentWrapper;
        if (!currentWrapper || currentWrapper.dataset.previewBlockId !== block.id || contentChanged) {
          wrapper = this.createWrapper(block, index, changedNodes, mountedNodes);
          if (currentWrapper) currentWrapper.replaceWith(wrapper);
          else this.body.insertBefore(wrapper, this.spacers.bottom);
        } else {
          reused += 1;
          wrapper.dataset.previewBlockType = block.type || 'unknown';
          this.applySourceRange([wrapper], block);
          wrapper.dataset.previewBlockIndex = String(index);
        }
        nextMounted.set(block.id, wrapper);
      }

      this.mounted = nextMounted;
      this.metricsCache = null;
      this.observeMounted();
      if (mountedNodes.length) this.onNodesMounted?.(mountedNodes, { changedNodes, initial: false });
      if (mountedNodes.length || changedNodes.length) this.notifyPreviewMounted('virtual-preview-block-update');
      this.scheduleMeasure();
      this.requestPrewarm(nextRange);
      return { changedNodes, reused };
    }

    const previousMounted = this.mounted;
    const nextMounted = new Map();
    const fragment = this.documentRef.createDocumentFragment();
    const changedNodes = [];
    const mountedNodes = [];
    let reused = 0;
    fragment.append(this.spacers.top);

    for (let index = nextRange.start; index < nextRange.end; index += 1) {
      const block = this.blocks[index];
      let wrapper = previousMounted.get(block.id);
      const contentChanged = this.changedIds.has(block.id);
      if (!wrapper || contentChanged) {
        wrapper = this.createWrapper(block, index, changedNodes, mountedNodes);
      } else {
        reused += 1;
        wrapper.dataset.previewBlockType = block.type || 'unknown';
        this.applySourceRange([wrapper], block);
        wrapper.dataset.previewBlockIndex = String(index);
      }
      nextMounted.set(block.id, wrapper);
      fragment.append(wrapper);
    }

    fragment.append(this.spacers.bottom);
    this.body.replaceChildren(fragment);
    this.mounted = nextMounted;
    this.range = nextRange;
    this.metricsCache = null;
    this.observeMounted();
    if (mountedNodes.length) this.onNodesMounted?.(mountedNodes, { changedNodes, initial: force });
    this.notifyPreviewMounted('virtual-preview-window');
    this.scheduleMeasure();
    this.requestPrewarm(nextRange);
    return { changedNodes, reused };
  }

  requestPrewarm(range = this.range) {
    if (!this.active || !this.onPrewarmNeeded || !this.blocks.length) return;
    const ids = [];
    const seen = new Set();
    const append = index => {
      const block = this.blocks[index];
      if (!block || typeof block.html === 'string' || seen.has(block.id)) return;
      seen.add(block.id);
      ids.push(block.id);
    };
    const limit = this.thresholds.virtualWindow.prewarmBlocks;
    if (this.scrollDirection >= 0) {
      for (let index = range.end; index < this.blocks.length && ids.length < limit; index += 1) append(index);
      for (let index = range.start - 1; index >= 0 && ids.length < limit; index -= 1) append(index);
    } else {
      for (let index = range.start - 1; index >= 0 && ids.length < limit; index -= 1) append(index);
      for (let index = range.end; index < this.blocks.length && ids.length < limit; index += 1) append(index);
    }
    if (!ids.length) return;
    const key = ids.join('|');
    if (key === this.lastPrewarmKey) return;
    this.lastPrewarmKey = key;
    this.onPrewarmNeeded(ids);
  }

  applyRenderedBlocks(renderedBlocks) {
    this.assertAlive();
    if (!Array.isArray(renderedBlocks) || !renderedBlocks.length || !this.blocks.length) return;
    const htmlById = new Map(renderedBlocks.map(item => [item.id, item.html]));
    let changed = false;
    this.blocks = this.blocks.map(block => {
      if (!htmlById.has(block.id)) return block;
      changed = true;
      return { ...block, html: htmlById.get(block.id) };
    });
    if (changed) {
      this.lastPrewarmKey = '';
      this.rebuildBlockMaps();
      this.rebuildModel();
    }
  }

  refreshViewport(options = {}) {
    this.assertAlive();
    if (!this.active || !this.body?.isConnected) return false;
    this.cancelFrame(this.renderFrame);
    this.cancelFrame(this.measureFrame);
    this.renderFrame = 0;
    this.measureFrame = 0;
    this.lastScrollTop = this.preview.scrollTop || 0;
    this.renderWindow(Boolean(options.forceWindow));
    this.scheduleMeasure();
    this.notifyGeometryChanged('preview');
    return true;
  }

  scheduleWindowUpdate() {
    if (this.destroyed || !this.active || this.renderFrame) return;
    this.renderFrame = this.requestFrame(() => {
      this.renderFrame = 0;
      if (!this.destroyed) this.renderWindow(false);
    });
  }

  scheduleMeasure() {
    if (this.destroyed || !this.active) return;
    this.cancelFrame(this.measureFrame);
    this.measureFrame = this.requestFrame(() => {
      this.measureFrame = 0;
      if (!this.destroyed) this.measureMountedBlocks();
    });
  }

  measureMountedBlocks() {
    this.assertAlive();
    if (!this.active || !this.mounted.size) return false;
    const oldStartOffset = this.model.offsets[this.range.start] || 0;
    let changed = false;
    for (const [id, wrapper] of this.mounted) {
      const style = this.getComputedStyle(wrapper);
      const marginTop = Number.parseFloat(style.marginTop) || 0;
      const marginBottom = Number.parseFloat(style.marginBottom) || 0;
      const outerHeight = Math.max(18, wrapper.offsetHeight + marginTop + marginBottom);
      changed = this.heightCache.recordMeasurement(id, outerHeight, { top: marginTop, bottom: marginBottom }) || changed;
    }
    if (!changed) return false;
    this.heightCache.schedulePersist();
    this.model.rebuild();
    this.metricsCache = null;
    const newStartOffset = this.model.offsets[this.range.start] || 0;
    const delta = newStartOffset - oldStartOffset;
    this.updateSpacers(this.range);
    if (Math.abs(delta) >= 1 && this.range.start > 0) {
      const compensated = this.compensateScroll(delta, 'virtual-preview-height');
      if (!compensated) this.preview.scrollTop += delta;
      this.lastScrollTop = this.preview.scrollTop;
    }
    this.invalidateAnchorMetrics();
    this.notifyGeometryChanged('preview');
    return true;
  }

  getContentYForLine(lineFloat) {
    this.assertAlive();
    if (!this.active) return 0;
    return this.model.contentYForLine(lineFloat, this.body?.offsetTop || 0, id => this.heightCache.getInset(id));
  }

  getLineForContentY(contentY) {
    this.assertAlive();
    if (!this.active) return 1;
    return this.model.lineForContentY(contentY, this.body?.offsetTop || 0, id => this.heightCache.getInset(id));
  }

  containsLineRange(startLine, endLine = startLine) {
    this.assertAlive();
    return this.active && this.model.containsLineRange(startLine, endLine);
  }

  hasLineRangeMounted(startLine, endLine = startLine) {
    this.assertAlive();
    if (!this.containsLineRange(startLine, endLine)) return false;
    const indices = this.model.indicesForLineRange(startLine, endLine);
    return indices.low >= this.range.start && indices.high < this.range.end;
  }

  ensureLineRangeVisible(startLine, endLine = startLine) {
    this.assertAlive();
    if (!this.containsLineRange(startLine, endLine)) return null;
    const indices = this.model.indicesForLineRange(startLine, endLine);
    if (indices.low < this.range.start || indices.high >= this.range.end) {
      const next = this.model.windowForLineRange(startLine, endLine);
      this.renderWindow(true, { start: next.start, end: next.end });
    }
    const next = this.model.windowForLineRange(startLine, endLine);
    return {
      startAnchor: this.mounted.get(this.blocks[next.low]?.id) || null,
      endAnchor: this.mounted.get(this.blocks[Math.min(next.high, this.range.end - 1)]?.id) || null,
      clipped: next.clipped,
      startIndex: next.low,
      endIndex: next.high
    };
  }

  ensureLineVisible(line) {
    return this.ensureLineRangeVisible(line, line)?.startAnchor || null;
  }

  getMountedAnchors() {
    this.assertAlive();
    return [...this.mounted.values()];
  }

  getMetrics() {
    this.assertAlive();
    if (!this.active) return null;
    if (this.metricsCache) return this.metricsCache;
    const bodyTop = this.body?.offsetTop || 0;
    this.metricsCache = this.blocks.map((block, index) => {
      const anchor = this.mounted.get(block.id) || null;
      const inset = this.heightCache.getInset(block.id);
      const top = bodyTop + (this.model.offsets[index] || 0) + inset.top;
      const next = bodyTop + (this.model.offsets[index + 1] || top + 18);
      return {
        anchor,
        blockId: block.id,
        startLine: block.startLine || 1,
        endLine: block.endLine || block.startLine || 1,
        top,
        bottom: Math.max(top + 1, next - inset.bottom)
      };
    });
    return this.metricsCache;
  }

  getStats() {
    this.assertAlive();
    return {
      active: this.active,
      blocks: this.blocks.length,
      mountedBlocks: this.mounted.size,
      start: this.range.start,
      end: this.range.end,
      estimatedHeight: Math.round(this.model.totalHeight),
      measuredHeights: this.heightCache.measuredCount,
      cachedHeights: this.heightCache.cachedCount,
      priorityChapter: this.priorityChapter,
      scope: this.scope,
      scopeStartLine: this.blocks[0]?.startLine || 0,
      scopeEndLine: this.blocks[this.blocks.length - 1]?.endLine || 0,
      viewportWidth: Math.round(this.preview.clientWidth || 0),
      viewportHeight: Math.round(this.preview.clientHeight || 0)
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.heightCache.setBlocks(this.blocks);
    this.heightCache.persist();
    this.deactivate();
    this.destroyed = true;
    this.viewportResizeObserver?.disconnect();
    this.preview.removeEventListener('scroll', this.handleScroll);
    this.heightCache.destroy();
  }
}

export function createVirtualWindowController(preview, options) {
  return new VirtualWindowController(preview, options);
}
