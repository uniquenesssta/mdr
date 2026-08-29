/**
 * Responsibility: Pure virtual-preview window and line/offset model.
 * Imports: None.
 * Exports: createVirtualWindowModel.
 * State/side effects: Owns only blocks, offsets and total estimated height.
 * Lifecycle: Explicit update/reset; no DOM or browser globals.
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
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

export function createVirtualWindowModel({ thresholds, getBlockHeight }) {
  if (!thresholds || typeof thresholds !== 'object') throw new TypeError('Virtual window thresholds are required.');
  if (typeof getBlockHeight !== 'function') throw new TypeError('getBlockHeight is required.');

  let blocks = [];
  let offsets = [0];
  let totalHeight = 0;

  function rebuild() {
    const nextOffsets = new Array(blocks.length + 1);
    nextOffsets[0] = 0;
    for (let index = 0; index < blocks.length; index += 1) {
      const height = Math.max(18, Number(getBlockHeight(blocks[index])) || 0);
      nextOffsets[index + 1] = nextOffsets[index] + height;
    }
    offsets = nextOffsets;
    totalHeight = offsets[offsets.length - 1] || 0;
  }

  function setBlocks(nextBlocks) {
    blocks = Array.isArray(nextBlocks) ? nextBlocks : [];
    rebuild();
  }

  function calculateWindow(scrollTop, viewportHeight) {
    if (!blocks.length) return { start: 0, end: 0 };
    const viewportTop = Math.max(0, (Number(scrollTop) || 0) - thresholds.overscanPx);
    const viewportBottom = (Number(scrollTop) || 0) + (Number(viewportHeight) || 0) + thresholds.overscanPx;
    let start = findIndexAtOffset(offsets, viewportTop);
    let end = Math.min(blocks.length, findIndexAtOffset(offsets, viewportBottom) + 1);
    if (end - start < thresholds.minimumBlocks) {
      const missing = thresholds.minimumBlocks - (end - start);
      start = Math.max(0, start - Math.ceil(missing / 2));
      end = Math.min(blocks.length, start + thresholds.minimumBlocks);
      start = Math.max(0, end - thresholds.minimumBlocks);
    }
    if (end - start > thresholds.maximumBlocks) end = start + thresholds.maximumBlocks;
    return { start, end };
  }

  function captureAnchor(scrollTop, bodyTop = 0) {
    if (!blocks.length || offsets.length <= 1) return null;
    const localY = clamp((Number(scrollTop) || 0) - (Number(bodyTop) || 0), 0, Math.max(0, totalHeight));
    const index = findIndexAtOffset(offsets, localY);
    const block = blocks[index];
    if (!block) return null;
    return {
      blockId: block.id,
      offsetWithinBlock: localY - (offsets[index] || 0)
    };
  }

  function getAnchorScrollTop(anchor, blockIndexById, bodyTop = 0) {
    if (!anchor?.blockId || !(blockIndexById instanceof Map)) return null;
    const index = blockIndexById.get(anchor.blockId);
    if (!Number.isFinite(index)) return null;
    return (Number(bodyTop) || 0) + (offsets[index] || 0) + (Number(anchor.offsetWithinBlock) || 0);
  }

  function containsLineRange(startLine, endLine = startLine) {
    if (!blocks.length) return false;
    const from = Math.max(1, Number(startLine) || 1);
    const to = Math.max(from, Number(endLine) || from);
    const first = blocks[0];
    const last = blocks[blocks.length - 1];
    const scopeStart = Math.max(1, Number(first?.startLine) || 1);
    const scopeEnd = Math.max(scopeStart, Number(last?.endLine) || Number(last?.startLine) || scopeStart);
    return from >= scopeStart && to <= scopeEnd;
  }

  function indicesForLineRange(startLine, endLine = startLine) {
    if (!containsLineRange(startLine, endLine)) return null;
    const fromIndex = findIndexAtLine(blocks, Math.max(1, Number(startLine) || 1));
    const toIndex = findIndexAtLine(blocks, Math.max(1, Number(endLine) || Number(startLine) || 1));
    return {
      low: Math.min(fromIndex, toIndex),
      high: Math.max(fromIndex, toIndex)
    };
  }

  function windowForLineRange(startLine, endLine = startLine) {
    const indices = indicesForLineRange(startLine, endLine);
    if (!indices) return null;
    const { low, high } = indices;
    const required = high - low + 1;
    let clipped = false;
    let start;
    let end;
    if (required >= thresholds.maximumBlocks) {
      clipped = true;
      start = low;
      end = Math.min(blocks.length, start + thresholds.maximumBlocks);
    } else {
      const targetSize = Math.min(thresholds.maximumBlocks, Math.max(thresholds.minimumBlocks, required + 8));
      const spare = targetSize - required;
      start = clamp(low - Math.floor(spare / 2), 0, Math.max(0, blocks.length - targetSize));
      end = Math.min(blocks.length, start + targetSize);
      if (high >= end) {
        end = Math.min(blocks.length, high + 1);
        start = Math.max(0, end - targetSize);
      }
    }
    return { start, end, low, high, clipped };
  }

  function contentYForLine(lineFloat, bodyTop, getInset) {
    if (!blocks.length) return 0;
    const line = Math.max(1, Number(lineFloat) || 1);
    const index = findIndexAtLine(blocks, line);
    const block = blocks[index] || blocks[0];
    const inset = getInset(block.id) || { top: 0, bottom: 0 };
    const top = (Number(bodyTop) || 0) + (offsets[index] || 0) + inset.top;
    const next = (Number(bodyTop) || 0) + (offsets[index + 1] || top + 18) - inset.bottom;
    const startLine = block.startLine || 1;
    const endLine = block.endLine || startLine;
    const span = Math.max(1, endLine - startLine + 1);
    const fraction = clamp((line - startLine) / span, 0, 1);
    return top + Math.max(1, next - top) * fraction;
  }

  function lineForContentY(contentY, bodyTop, getInset) {
    if (!blocks.length) return 1;
    const localY = clamp((Number(contentY) || 0) - (Number(bodyTop) || 0), 0, Math.max(0, totalHeight));
    const index = findIndexAtOffset(offsets, localY);
    const block = blocks[index] || blocks[0];
    const inset = getInset(block.id) || { top: 0, bottom: 0 };
    const top = (offsets[index] || 0) + inset.top;
    const bottom = (offsets[index + 1] || top + 18) - inset.bottom;
    const fraction = clamp((localY - top) / Math.max(1, bottom - top), 0, 1);
    const startLine = block.startLine || 1;
    const endLine = block.endLine || startLine;
    return startLine + fraction * Math.max(1, endLine - startLine + 1);
  }

  return Object.freeze({
    setBlocks,
    rebuild,
    calculateWindow,
    captureAnchor,
    getAnchorScrollTop,
    containsLineRange,
    indicesForLineRange,
    windowForLineRange,
    contentYForLine,
    lineForContentY,
    get blocks() { return blocks; },
    get offsets() { return offsets; },
    get totalHeight() { return totalHeight; }
  });
}
