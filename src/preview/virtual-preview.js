const DEFAULT_OVERSCAN_PX = 1000;
const MIN_WINDOW_BLOCKS = 24;
const MAX_WINDOW_BLOCKS = 180;
const PREWARM_BLOCK_LIMIT = 96;
const HEIGHT_CACHE_PREFIX = 'md_editor_preview_heights_v1:';
const HEIGHT_CACHE_LIMIT = 4000;
const HEIGHT_CACHE_VERSION = 1;


function simpleHash(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function blockHeightSignature(block) {
  const raw = String(block?.raw || '');
  const lines = Math.max(1, (block?.endLine || block?.startLine || 1) - (block?.startLine || 1) + 1);
  const sample = raw.length <= 160 ? raw : raw.slice(0, 80) + raw.slice(-80);
  return `${block?.type || 'unknown'}:${lines}:${raw.length}:${simpleHash(sample)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function estimateBlockHeight(block) {
  const lines = Math.max(1, (block.endLine || block.startLine || 1) - (block.startLine || 1) + 1);
  switch (block.type) {
    case 'heading': return 58;
    case 'code': return Math.min(1200, 42 + lines * 25);
    case 'blockquote': return Math.min(800, 28 + lines * 28);
    case 'list': return Math.min(1000, 18 + lines * 31);
    case 'table': return Math.min(1200, 48 + lines * 39);
    case 'hr': return 34;
    case 'html': return Math.min(1000, 24 + lines * 28);
    default: return Math.min(700, 16 + lines * 29);
  }
}

function findIndexAtOffset(offsets, value) {
  if (offsets.length <= 1) return 0;
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function findIndexAtLine(blocks, line) {
  if (!blocks.length) return 0;
  let low = 0;
  let high = blocks.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((blocks[middle].startLine || 1) <= line) low = middle;
    else high = middle - 1;
  }
  return low;
}

export class VirtualPreviewController {
  constructor(preview) {
    this.preview = preview;
    this.body = null;
    this.topSpacer = null;
    this.bottomSpacer = null;
    this.blocks = [];
    this.changedIds = new Set();
    this.heightById = new Map();
    this.insetById = new Map();
    this.blockById = new Map();
    this.blockIndexById = new Map();
    this.cachedHeightEntries = new Map();
    this.cacheDocumentId = '';
    this.cacheVisualKey = '';
    this.cacheStorageKey = '';
    this.persistTimer = 0;
    this.offsets = [0];
    this.totalHeight = 0;
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
    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.scheduleMeasure())
      : null;
    this.viewportResizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(entries => {
          const rect = entries[0]?.contentRect;
          const width = Math.round(rect?.width || this.preview.clientWidth || 0);
          const height = Math.round(rect?.height || this.preview.clientHeight || 0);
          const changed = Math.abs(width - this.viewportWidth) > 1 || Math.abs(height - this.viewportHeight) > 1;
          const becameVisible = width > 0 && height > 0 && (this.viewportWidth <= 0 || this.viewportHeight <= 0);
          this.viewportWidth = width;
          this.viewportHeight = height;
          if (!this.active || width <= 0 || height <= 0 || (!changed && !becameVisible)) return;
          cancelAnimationFrame(this.viewportResizeFrame);
          this.viewportResizeFrame = requestAnimationFrame(() => {
            this.viewportResizeFrame = 0;
            if (!this.active || this.preview.clientWidth <= 0 || this.preview.clientHeight <= 0) return;
            this.refreshViewport({ forceWindow: true });
          });
        })
      : null;
    this.viewportResizeObserver?.observe(preview);
    this.handleScroll = () => {
      const nextScrollTop = this.preview.scrollTop || 0;
      this.scrollDirection = nextScrollTop >= this.lastScrollTop ? 1 : -1;
      this.lastScrollTop = nextScrollTop;
      this.scheduleWindowUpdate();
    };
    preview.addEventListener('scroll', this.handleScroll, { passive: true });
  }

  setCacheContext(documentId, visualKey = '') {
    const nextDocumentId = String(documentId || 'anonymous');
    const nextVisualKey = String(visualKey || 'default');
    if (nextDocumentId === this.cacheDocumentId && nextVisualKey === this.cacheVisualKey) return;
    this.persistHeightCache();
    this.cacheDocumentId = nextDocumentId;
    this.cacheVisualKey = nextVisualKey;
    this.cacheStorageKey = HEIGHT_CACHE_PREFIX + encodeURIComponent(nextDocumentId);
    this.heightById.clear();
    this.insetById.clear();
    this.cachedHeightEntries.clear();
    try {
      const parsed = JSON.parse(localStorage.getItem(this.cacheStorageKey) || 'null');
      if (!parsed || parsed.version !== HEIGHT_CACHE_VERSION || parsed.visualKey !== nextVisualKey || !Array.isArray(parsed.entries)) return;
      for (const item of parsed.entries) {
        if (!Array.isArray(item) || item.length < 4) continue;
        const [id, signature, height, top = 0, bottom = 0] = item;
        const numericHeight = Number(height);
        if (!id || !signature || !Number.isFinite(numericHeight) || numericHeight < 18) continue;
        this.cachedHeightEntries.set(String(id), {
          signature: String(signature),
          height: numericHeight,
          inset: { top: Number(top) || 0, bottom: Number(bottom) || 0 }
        });
      }
    } catch (_) {
      this.cachedHeightEntries.clear();
    }
  }

  applyCachedHeights() {
    if (!this.cachedHeightEntries.size || !this.blocks.length) return 0;
    let restored = 0;
    for (const block of this.blocks) {
      if (this.heightById.has(block.id)) continue;
      const cached = this.cachedHeightEntries.get(block.id);
      if (!cached || cached.signature !== blockHeightSignature(block)) continue;
      this.heightById.set(block.id, cached.height);
      this.insetById.set(block.id, cached.inset);
      restored += 1;
    }
    return restored;
  }

  schedulePersistHeightCache() {
    if (!this.cacheStorageKey) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = 0;
      const scheduler = window.markdownEditorTaskScheduler;
      if (scheduler?.schedule) {
        scheduler.schedule('preview-height-cache', () => this.persistHeightCache(), { priority: 'idle', timeout: 1200 });
      } else {
        this.persistHeightCache();
      }
    }, 900);
  }

  persistHeightCache() {
    clearTimeout(this.persistTimer);
    this.persistTimer = 0;
    if (!this.cacheStorageKey || !this.heightById.size || !this.blockById.size) return;
    const merged = new Map(this.cachedHeightEntries);
    for (const [id, height] of this.heightById) {
      const block = this.blockById.get(id);
      if (!block) continue;
      const inset = this.insetById.get(id) || { top: 0, bottom: 0 };
      merged.delete(id);
      merged.set(id, {
        signature: blockHeightSignature(block),
        height: Math.round(height * 10) / 10,
        inset: { top: inset.top || 0, bottom: inset.bottom || 0 }
      });
    }
    const selected = [...merged.entries()].slice(-HEIGHT_CACHE_LIMIT);
    this.cachedHeightEntries = new Map(selected);
    const entries = selected.map(([id, item]) => [
      id,
      item.signature,
      item.height,
      item.inset?.top || 0,
      item.inset?.bottom || 0
    ]);
    try {
      localStorage.setItem(this.cacheStorageKey, JSON.stringify({
        version: HEIGHT_CACHE_VERSION,
        visualKey: this.cacheVisualKey,
        updatedAt: Date.now(),
        entries
      }));
    } catch (error) {
      console.debug('Preview height cache skipped:', error?.message || error);
    }
  }

  shouldUse(blocks, sourceLength) {
    return sourceLength >= 400000 || blocks.length >= 1400;
  }

  activate() {
    if (this.active && this.body?.isConnected) return;
    this.active = true;
    this.body = document.createElement('div');
    this.body.className = 'markdown-body virtual-preview-body';
    this.body.dataset.previewScope = this.scope;
    this.topSpacer = document.createElement('div');
    this.topSpacer.className = 'virtual-preview-spacer virtual-preview-spacer-top';
    this.topSpacer.setAttribute('aria-hidden', 'true');
    this.bottomSpacer = document.createElement('div');
    this.bottomSpacer.className = 'virtual-preview-spacer virtual-preview-spacer-bottom';
    this.bottomSpacer.setAttribute('aria-hidden', 'true');
    this.body.append(this.topSpacer, this.bottomSpacer);
    this.preview.replaceChildren(this.body);
    this.mounted.clear();
    this.range = { start: 0, end: 0 };
  }

  deactivate() {
    this.persistHeightCache();
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.renderFrame);
    cancelAnimationFrame(this.measureFrame);
    cancelAnimationFrame(this.viewportResizeFrame);
    this.renderFrame = 0;
    this.measureFrame = 0;
    this.viewportResizeFrame = 0;
    this.body = null;
    this.topSpacer = null;
    this.bottomSpacer = null;
    this.resizeObserver?.disconnect();
    this.mounted.clear();
    this.range = { start: 0, end: 0 };
    this.metricsCache = null;
    this.lastPrewarmKey = '';
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

  captureScrollAnchor() {
    if (!this.active || !this.blocks.length || this.offsets.length <= 1) return null;
    const localY = clamp(this.preview.scrollTop - (this.body?.offsetTop || 0), 0, Math.max(0, this.totalHeight));
    const index = findIndexAtOffset(this.offsets, localY);
    const block = this.blocks[index];
    if (!block) return null;
    return {
      blockId: block.id,
      offsetWithinBlock: localY - (this.offsets[index] || 0)
    };
  }

  restoreScrollAnchor(anchor) {
    if (!anchor?.blockId || !this.active) return;
    const index = this.blockIndexById.get(anchor.blockId);
    if (!Number.isFinite(index)) return;
    const bodyTop = this.body?.offsetTop || 0;
    const targetTop = bodyTop + (this.offsets[index] || 0) + anchor.offsetWithinBlock;
    const delta = targetTop - this.preview.scrollTop;
    if (Math.abs(delta) < 1) return;
    const controller = window.markdownEditorScrollController;
    if (controller?.compensate) controller.compensate('preview', delta, 'virtual-preview-model');
    else {
      window.markdownEditorScrollSync?.markProgrammaticScroll?.('preview', 900);
      this.preview.scrollTop += delta;
    }
    this.lastScrollTop = this.preview.scrollTop;
  }

  refreshRenderData(result) {
    if (!this.active) return;
    this.blocks = result.blocks || this.blocks;
    this.rebuildBlockMaps();
    this.applyCachedHeights();
    this.priorityChapter = result.focusChapter || null;
  }

  update(result, options) {
    this.activate();
    const scrollAnchor = options.forceAll ? null : this.captureScrollAnchor();
    this.blocks = result.blocks || [];
    this.rebuildBlockMaps();
    this.changedIds = new Set(result.changedIds || []);
    this.createNodes = options.createNodes;
    this.applySourceRange = options.applySourceRange;
    this.onNodesMounted = options.onNodesMounted;
    this.onPrewarmNeeded = options.onPrewarmNeeded || null;
    this.priorityChapter = result.focusChapter || null;
    this.scope = options.scope === 'chapter' ? 'chapter' : 'virtual';
    this.body.dataset.previewScope = this.scope;
    if (options.forceAll) {
      const currentIds = new Set(this.blocks.map(block => block.id));
      for (const id of [...this.heightById.keys()]) {
        if (!currentIds.has(id)) this.heightById.delete(id);
      }
      for (const id of [...this.insetById.keys()]) {
        if (!currentIds.has(id)) this.insetById.delete(id);
      }
      this.mounted.clear();
    } else {
      for (const id of result.removedIds || []) {
        this.heightById.delete(id);
        this.insetById.delete(id);
        this.mounted.delete(id);
      }
    }
    this.applyCachedHeights();
    this.rebuildOffsets();
    const mountResult = this.renderWindow(Boolean(options.forceAll));
    this.restoreScrollAnchor(scrollAnchor);
    window.markdownEditorScrollController?.notifyGeometryChanged?.('preview');
    return {
      body: this.body,
      changedNodes: mountResult.changedNodes,
      reused: mountResult.reused,
      parsedChars: result.parsedChars,
      mode: result.incremental ? 'worker-virtual-incremental' : 'worker-virtual-' + result.reason,
      virtualized: true,
      blockCount: this.blocks.length
    };
  }

  rebuildOffsets() {
    const offsets = new Array(this.blocks.length + 1);
    offsets[0] = 0;
    for (let index = 0; index < this.blocks.length; index += 1) {
      const block = this.blocks[index];
      const height = this.heightById.get(block.id) || estimateBlockHeight(block);
      offsets[index + 1] = offsets[index] + Math.max(18, height);
    }
    this.offsets = offsets;
    this.totalHeight = offsets[offsets.length - 1] || 0;
    this.metricsCache = null;
  }

  calculateWindow() {
    if (!this.blocks.length) return { start: 0, end: 0 };
    const viewportTop = Math.max(0, this.preview.scrollTop - DEFAULT_OVERSCAN_PX);
    const viewportBottom = this.preview.scrollTop + this.preview.clientHeight + DEFAULT_OVERSCAN_PX;
    let start = findIndexAtOffset(this.offsets, viewportTop);
    let end = Math.min(this.blocks.length, findIndexAtOffset(this.offsets, viewportBottom) + 1);
    if (end - start < MIN_WINDOW_BLOCKS) {
      const missing = MIN_WINDOW_BLOCKS - (end - start);
      start = Math.max(0, start - Math.ceil(missing / 2));
      end = Math.min(this.blocks.length, start + MIN_WINDOW_BLOCKS);
      start = Math.max(0, end - MIN_WINDOW_BLOCKS);
    }
    if (end - start > MAX_WINDOW_BLOCKS) end = start + MAX_WINDOW_BLOCKS;
    return { start, end };
  }

  renderWindow(force = false, explicitRange = null) {
    if (!this.active || !this.body) return { changedNodes: [], reused: 0 };
    const nextRange = explicitRange || this.calculateWindow();
    const sameRange = nextRange.start === this.range.start && nextRange.end === this.range.end;

    this.topSpacer.style.height = (this.offsets[nextRange.start] || 0) + 'px';
    this.bottomSpacer.style.height = Math.max(0, this.totalHeight - (this.offsets[nextRange.end] || 0)) + 'px';

    // 输入发生在当前窗口外时，不触碰已挂载的富文本 DOM，只更新上下占位高度。
    // 当前窗口内的变化则按位置替换对应 wrapper，避免每次输入都重新挂载整窗节点。
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
          wrapper = document.createElement('div');
          wrapper.className = 'preview-virtual-block';
          wrapper.dataset.previewBlockId = block.id;
          wrapper.dataset.previewBlockType = block.type || 'unknown';
          const nodes = this.createNodes(block);
          this.applySourceRange([wrapper], block);
          wrapper.append(...nodes);
          if (currentWrapper) currentWrapper.replaceWith(wrapper);
          else this.body.insertBefore(wrapper, this.bottomSpacer);
          if (contentChanged) changedNodes.push(...nodes);
          mountedNodes.push(...nodes);
          this.changedIds.delete(block.id);
        } else {
          reused += 1;
          wrapper.dataset.previewBlockType = block.type || 'unknown';
          this.applySourceRange([wrapper], block);
        }

        wrapper.dataset.previewBlockIndex = String(index);
        nextMounted.set(block.id, wrapper);
      }

      this.mounted = nextMounted;
      this.metricsCache = null;
      this.resizeObserver?.disconnect();
      for (const wrapper of this.mounted.values()) this.resizeObserver?.observe(wrapper);
      if (mountedNodes.length) this.onNodesMounted?.(mountedNodes, { changedNodes, initial: false });
      if (mountedNodes.length || changedNodes.length) {
        window.markdownEditorSelectionController?.notifyPreviewMounted?.('virtual-preview-block-update');
      }
      this.scheduleMeasure();
      this.requestPrewarm(nextRange);
      return { changedNodes, reused };
    }

    const previousMounted = this.mounted;
    const nextMounted = new Map();
    const fragment = document.createDocumentFragment();
    const changedNodes = [];
    const mountedNodes = [];
    let reused = 0;

    fragment.append(this.topSpacer);

    for (let index = nextRange.start; index < nextRange.end; index += 1) {
      const block = this.blocks[index];
      let wrapper = previousMounted.get(block.id);
      const contentChanged = this.changedIds.has(block.id);
      const mustRender = !wrapper || contentChanged;
      if (mustRender) {
        wrapper = document.createElement('div');
        wrapper.className = 'preview-virtual-block';
        wrapper.dataset.previewBlockId = block.id;
        wrapper.dataset.previewBlockType = block.type || 'unknown';
        const nodes = this.createNodes(block);
        this.applySourceRange([wrapper], block);
        wrapper.append(...nodes);
        if (contentChanged) changedNodes.push(...nodes);
        mountedNodes.push(...nodes);
        this.changedIds.delete(block.id);
      } else {
        reused += 1;
        wrapper.dataset.previewBlockType = block.type || 'unknown';
        this.applySourceRange([wrapper], block);
      }
      wrapper.dataset.previewBlockIndex = String(index);
      nextMounted.set(block.id, wrapper);
      fragment.append(wrapper);
    }

    fragment.append(this.bottomSpacer);
    this.body.replaceChildren(fragment);
    this.mounted = nextMounted;
    this.range = nextRange;
    this.metricsCache = null;
    this.resizeObserver?.disconnect();
    for (const wrapper of this.mounted.values()) this.resizeObserver?.observe(wrapper);

    if (mountedNodes.length) this.onNodesMounted?.(mountedNodes, { changedNodes, initial: force });
    window.markdownEditorSelectionController?.notifyPreviewMounted?.('virtual-preview-window');
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

    if (this.scrollDirection >= 0) {
      for (let index = range.end; index < this.blocks.length && ids.length < PREWARM_BLOCK_LIMIT; index += 1) append(index);
      for (let index = range.start - 1; index >= 0 && ids.length < PREWARM_BLOCK_LIMIT; index -= 1) append(index);
    } else {
      for (let index = range.start - 1; index >= 0 && ids.length < PREWARM_BLOCK_LIMIT; index -= 1) append(index);
      for (let index = range.end; index < this.blocks.length && ids.length < PREWARM_BLOCK_LIMIT; index += 1) append(index);
    }

    if (!ids.length) return;
    const key = ids.join('|');
    if (key === this.lastPrewarmKey) return;
    this.lastPrewarmKey = key;
    this.onPrewarmNeeded(ids);
  }

  applyRenderedBlocks(renderedBlocks) {
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
    }
  }

  refreshViewport(options = {}) {
    if (!this.active || !this.body?.isConnected) return false;
    cancelAnimationFrame(this.renderFrame);
    cancelAnimationFrame(this.measureFrame);
    this.renderFrame = 0;
    this.measureFrame = 0;
    this.lastScrollTop = this.preview.scrollTop || 0;
    this.renderWindow(Boolean(options.forceWindow));
    this.scheduleMeasure();
    window.markdownEditorScrollController?.notifyGeometryChanged?.('preview');
    return true;
  }

  scheduleWindowUpdate() {
    if (!this.active || this.renderFrame) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = 0;
      this.renderWindow(false);
    });
  }

  scheduleMeasure() {
    cancelAnimationFrame(this.measureFrame);
    this.measureFrame = requestAnimationFrame(() => {
      this.measureFrame = 0;
      this.measureMountedBlocks();
    });
  }

  measureMountedBlocks() {
    if (!this.active || !this.mounted.size) return;
    const oldStartOffset = this.offsets[this.range.start] || 0;
    let changed = false;
    for (const [id, wrapper] of this.mounted) {
      const style = getComputedStyle(wrapper);
      const marginTop = Number.parseFloat(style.marginTop) || 0;
      const marginBottom = Number.parseFloat(style.marginBottom) || 0;
      const outerHeight = Math.max(18, wrapper.offsetHeight + marginTop + marginBottom);
      const previous = this.heightById.get(id) || 0;
      if (Math.abs(previous - outerHeight) >= 1) {
        this.heightById.delete(id);
        this.heightById.set(id, outerHeight);
        this.insetById.set(id, { top: marginTop, bottom: marginBottom });
        changed = true;
      }
    }
    if (!changed) return;
    this.schedulePersistHeightCache();
    this.rebuildOffsets();
    const newStartOffset = this.offsets[this.range.start] || 0;
    const delta = newStartOffset - oldStartOffset;
    this.topSpacer.style.height = newStartOffset + 'px';
    this.bottomSpacer.style.height = Math.max(0, this.totalHeight - (this.offsets[this.range.end] || 0)) + 'px';
    if (Math.abs(delta) >= 1 && this.range.start > 0) {
      const controller = window.markdownEditorScrollController;
      if (controller?.compensate) {
        controller.compensate('preview', delta, 'virtual-preview-height');
      } else {
        window.markdownEditorScrollSync?.markProgrammaticScroll?.('preview', 900);
        this.preview.scrollTop += delta;
      }
      this.lastScrollTop = this.preview.scrollTop;
    }
    window.invalidatePreviewAnchorMetrics?.();
    window.markdownEditorScrollController?.notifyGeometryChanged?.('preview');
  }

  getContentYForLine(lineFloat) {
    if (!this.active || !this.blocks.length) return 0;
    const line = Math.max(1, Number(lineFloat) || 1);
    const index = findIndexAtLine(this.blocks, line);
    const block = this.blocks[index] || this.blocks[0];
    const inset = this.insetById.get(block.id) || { top: 0, bottom: 0 };
    const bodyTop = this.body?.offsetTop || 0;
    const top = bodyTop + (this.offsets[index] || 0) + inset.top;
    const next = bodyTop + (this.offsets[index + 1] || top + 18) - inset.bottom;
    const startLine = block.startLine || 1;
    const endLine = block.endLine || startLine;
    const span = Math.max(1, endLine - startLine + 1);
    const fraction = clamp((line - startLine) / span, 0, 1);
    return top + Math.max(1, next - top) * fraction;
  }

  getLineForContentY(contentY) {
    if (!this.active || !this.blocks.length) return 1;
    const bodyTop = this.body?.offsetTop || 0;
    const localY = clamp((Number(contentY) || 0) - bodyTop, 0, Math.max(0, this.totalHeight));
    const index = findIndexAtOffset(this.offsets, localY);
    const block = this.blocks[index] || this.blocks[0];
    const inset = this.insetById.get(block.id) || { top: 0, bottom: 0 };
    const top = (this.offsets[index] || 0) + inset.top;
    const bottom = (this.offsets[index + 1] || top + 18) - inset.bottom;
    const fraction = clamp((localY - top) / Math.max(1, bottom - top), 0, 1);
    const startLine = block.startLine || 1;
    const endLine = block.endLine || startLine;
    return startLine + fraction * Math.max(1, endLine - startLine + 1);
  }

  containsLineRange(startLine, endLine = startLine) {
    if (!this.active || !this.blocks.length) return false;
    const from = Math.max(1, Number(startLine) || 1);
    const to = Math.max(from, Number(endLine) || from);
    const first = this.blocks[0];
    const last = this.blocks[this.blocks.length - 1];
    const scopeStart = Math.max(1, Number(first?.startLine) || 1);
    const scopeEnd = Math.max(scopeStart, Number(last?.endLine) || Number(last?.startLine) || scopeStart);
    return from >= scopeStart && to <= scopeEnd;
  }

  hasLineRangeMounted(startLine, endLine = startLine) {
    if (!this.containsLineRange(startLine, endLine)) return false;
    const fromIndex = findIndexAtLine(this.blocks, Math.max(1, Number(startLine) || 1));
    const toIndex = findIndexAtLine(this.blocks, Math.max(1, Number(endLine) || Number(startLine) || 1));
    return fromIndex >= this.range.start && toIndex < this.range.end;
  }

  ensureLineRangeVisible(startLine, endLine = startLine) {
    if (!this.containsLineRange(startLine, endLine)) return null;
    const fromIndex = findIndexAtLine(this.blocks, Math.max(1, Number(startLine) || 1));
    const toIndex = findIndexAtLine(this.blocks, Math.max(1, Number(endLine) || Number(startLine) || 1));
    const low = Math.min(fromIndex, toIndex);
    const high = Math.max(fromIndex, toIndex);
    const required = high - low + 1;
    let clipped = false;

    if (low < this.range.start || high >= this.range.end) {
      let start;
      let end;
      if (required >= MAX_WINDOW_BLOCKS) {
        clipped = true;
        start = low;
        end = Math.min(this.blocks.length, start + MAX_WINDOW_BLOCKS);
      } else {
        const targetSize = Math.min(MAX_WINDOW_BLOCKS, Math.max(MIN_WINDOW_BLOCKS, required + 8));
        const spare = targetSize - required;
        start = clamp(low - Math.floor(spare / 2), 0, Math.max(0, this.blocks.length - targetSize));
        end = Math.min(this.blocks.length, start + targetSize);
        if (high >= end) {
          end = Math.min(this.blocks.length, high + 1);
          start = Math.max(0, end - targetSize);
        }
      }
      this.renderWindow(true, { start, end });
    }

    return {
      startAnchor: this.mounted.get(this.blocks[low]?.id) || null,
      endAnchor: this.mounted.get(this.blocks[Math.min(high, this.range.end - 1)]?.id) || null,
      clipped,
      startIndex: low,
      endIndex: high
    };
  }

  ensureLineVisible(line) {
    return this.ensureLineRangeVisible(line, line)?.startAnchor || null;
  }

  getMountedAnchors() {
    return [...this.mounted.values()];
  }

  getMetrics() {
    if (!this.active) return null;
    if (this.metricsCache) return this.metricsCache;
    const bodyTop = this.body?.offsetTop || 0;
    this.metricsCache = this.blocks.map((block, index) => {
      const anchor = this.mounted.get(block.id) || null;
      const inset = this.insetById.get(block.id) || { top: 0, bottom: 0 };
      const top = bodyTop + (this.offsets[index] || 0) + inset.top;
      const next = bodyTop + (this.offsets[index + 1] || top + 18);
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
    return {
      active: this.active,
      blocks: this.blocks.length,
      mountedBlocks: this.mounted.size,
      start: this.range.start,
      end: this.range.end,
      estimatedHeight: Math.round(this.totalHeight),
      measuredHeights: this.heightById.size,
      cachedHeights: this.cachedHeightEntries.size,
      priorityChapter: this.priorityChapter,
      scope: this.scope,
      scopeStartLine: this.blocks[0]?.startLine || 0,
      scopeEndLine: this.blocks[this.blocks.length - 1]?.endLine || 0,
      viewportWidth: Math.round(this.preview.clientWidth || 0),
      viewportHeight: Math.round(this.preview.clientHeight || 0)
    };
  }

  destroy() {
    this.persistHeightCache();
    clearTimeout(this.persistTimer);
    window.markdownEditorTaskScheduler?.cancel?.('preview-height-cache');
    this.deactivate();
    this.viewportResizeObserver?.disconnect();
    this.preview.removeEventListener('scroll', this.handleScroll);
  }
}

export function createVirtualPreviewController(preview) {
  return new VirtualPreviewController(preview);
}
