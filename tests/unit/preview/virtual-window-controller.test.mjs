import test from 'node:test';
import assert from 'node:assert/strict';
import { createVirtualWindowController } from '../../../src/features/preview/render/virtual-window/virtual-window-controller.js';

function createDomHarness() {
  const listeners = new Map();
  function makeNode(tag = 'div', fragment = false) {
    const node = {
      tag,
      isFragment: fragment,
      className: '',
      dataset: {},
      style: {},
      attributes: {},
      children: [],
      parentNode: null,
      isConnected: false,
      offsetHeight: tag === 'div' ? 45 : 10,
      offsetTop: 0,
      setAttribute(name, value) { this.attributes[name] = String(value); },
      append(...items) {
        for (const item of items) {
          if (item?.isFragment) {
            const nested = [...item.children];
            item.children = [];
            this.append(...nested);
            continue;
          }
          if (!item) continue;
          if (item.parentNode) {
            const old = item.parentNode.children.indexOf(item);
            if (old >= 0) item.parentNode.children.splice(old, 1);
          }
          item.parentNode = this;
          item.isConnected = this.isConnected;
          this.children.push(item);
        }
      },
      replaceChildren(...items) {
        for (const child of this.children) {
          child.parentNode = null;
          child.isConnected = false;
        }
        this.children = [];
        this.append(...items);
      },
      insertBefore(item, cursor) {
        if (item.parentNode) {
          const old = item.parentNode.children.indexOf(item);
          if (old >= 0) item.parentNode.children.splice(old, 1);
        }
        const index = this.children.indexOf(cursor);
        item.parentNode = this;
        item.isConnected = this.isConnected;
        if (index >= 0) this.children.splice(index, 0, item);
        else this.children.push(item);
      },
      replaceWith(item) {
        if (!this.parentNode) return;
        const parent = this.parentNode;
        const index = parent.children.indexOf(this);
        if (index < 0) return;
        this.parentNode = null;
        this.isConnected = false;
        item.parentNode = parent;
        item.isConnected = parent.isConnected;
        parent.children[index] = item;
      },
      remove() {
        if (!this.parentNode) return;
        const index = this.parentNode.children.indexOf(this);
        if (index >= 0) this.parentNode.children.splice(index, 1);
        this.parentNode = null;
        this.isConnected = false;
      }
    };
    return node;
  }

  const documentRef = {
    defaultView: null,
    createElement: tag => makeNode(tag),
    createDocumentFragment: () => makeNode('#fragment', true)
  };
  const preview = makeNode('preview');
  preview.ownerDocument = documentRef;
  preview.isConnected = true;
  preview.clientWidth = 600;
  preview.clientHeight = 120;
  preview.scrollTop = 0;
  preview.addEventListener = (type, listener) => listeners.set(type, listener);
  preview.removeEventListener = (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); };
  preview.dispatchScroll = () => listeners.get('scroll')?.();

  const frames = new Map();
  let nextFrame = 1;
  const requestFrame = callback => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  const cancelFrame = id => frames.delete(id);
  const flushFrames = (limit = 20) => {
    let count = 0;
    while (frames.size && count < limit) {
      const batch = [...frames.entries()];
      frames.clear();
      for (const [, callback] of batch) callback();
      count += 1;
    }
  };

  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; this.observed = new Set(); this.disconnected = false; }
    observe(node) { this.observed.add(node); }
    disconnect() { this.observed.clear(); this.disconnected = true; }
  }

  return { documentRef, preview, requestFrame, cancelFrame, flushFrames, FakeResizeObserver };
}

const thresholds = {
  mode: { virtualChars: 400000, virtualBlocks: 1400 },
  virtualWindow: { overscanPx: 0, minimumBlocks: 3, maximumBlocks: 5, prewarmBlocks: 2 }
};
const blocks = Array.from({ length: 20 }, (_, index) => ({
  id: `b${index}`,
  type: 'paragraph',
  startLine: index + 1,
  endLine: index + 1,
  raw: `line ${index}`
}));

function createController(harness, notifications = []) {
  return createVirtualWindowController(harness.preview, {
    thresholds,
    documentRef: harness.documentRef,
    storage: null,
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame,
    createResizeObserver: callback => new harness.FakeResizeObserver(callback),
    getComputedStyleFn: node => ({ marginTop: node.style.marginTop || '0', marginBottom: node.style.marginBottom || '0' }),
    notifyPreviewMounted: reason => notifications.push(`mounted:${reason}`),
    notifyGeometryChanged: reason => notifications.push(`geometry:${reason}`),
    invalidateAnchorMetrics: () => notifications.push('invalidate')
  });
}

test('Atomic 7.10 controller initially mounts only the necessary block window with correct spacers', () => {
  const harness = createDomHarness();
  const controller = createController(harness);
  const result = controller.update({ blocks, changedIds: blocks.map(block => block.id), reason: 'initial' }, {
    forceAll: true,
    createNodes: block => [{ dataset: { id: block.id }, parentNode: null, isConnected: false }],
    applySourceRange() {}
  });
  const stats = controller.getStats();
  assert.equal(result.virtualized, true);
  assert.ok(stats.mountedBlocks >= 3 && stats.mountedBlocks <= 5);
  assert.ok(stats.mountedBlocks < blocks.length);
  assert.equal(result.body.children.length, stats.mountedBlocks + 2);
  assert.equal(result.body.children[0].className, 'virtual-preview-spacer virtual-preview-spacer-top');
  assert.equal(result.body.children.at(-1).className, 'virtual-preview-spacer virtual-preview-spacer-bottom');
  controller.destroy();
});

test('Atomic 7.10 controller switches the mounted window after scroll without mounting the whole document', () => {
  const harness = createDomHarness();
  const controller = createController(harness);
  controller.update({ blocks, changedIds: [], reason: 'initial' }, {
    forceAll: true,
    createNodes: block => [{ dataset: { id: block.id }, parentNode: null, isConnected: false }],
    applySourceRange() {}
  });
  const before = controller.getStats();
  harness.preview.scrollTop = 500;
  harness.preview.dispatchScroll();
  harness.flushFrames(1);
  const after = controller.getStats();
  assert.ok(after.start > before.start);
  assert.ok(after.mountedBlocks <= thresholds.virtualWindow.maximumBlocks);
  assert.ok(after.mountedBlocks < blocks.length);
  controller.destroy();
});

test('Atomic 7.10 asynchronous measurement corrects cached geometry after mount', () => {
  const harness = createDomHarness();
  const notifications = [];
  const controller = createController(harness, notifications);
  const result = controller.update({ blocks, changedIds: [], reason: 'initial' }, {
    forceAll: true,
    createNodes: block => [{ dataset: { id: block.id }, parentNode: null, isConnected: false }],
    applySourceRange() {}
  });
  const beforeHeight = controller.getStats().estimatedHeight;
  const beforeLineY = controller.getContentYForLine(4);
  for (const wrapper of result.body.children.slice(1, -1)) {
    wrapper.offsetHeight = 100;
    wrapper.style.marginTop = '3';
    wrapper.style.marginBottom = '2';
  }
  harness.flushFrames();
  const afterStats = controller.getStats();
  const afterLineY = controller.getContentYForLine(4);
  assert.ok(afterStats.estimatedHeight > beforeHeight);
  assert.ok(afterLineY > beforeLineY);
  assert.ok(afterStats.measuredHeights > 0);
  assert.ok(notifications.includes('invalidate'));
  assert.ok(notifications.includes('geometry:preview'));
  controller.destroy();
  assert.throws(() => controller.getStats(), /destroyed/);
});
