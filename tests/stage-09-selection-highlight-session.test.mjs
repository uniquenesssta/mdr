import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionHighlightSession } from '../src/features/sync/index.js';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.nodeType = ELEMENT_NODE;
    this.tagName = tagName.toUpperCase();
    this.parentNode = null;
    this.children = [];
    this.classList = new FakeClassList();
    this.className = '';
    this.textContent = '';
  }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }
  replaceChild(next, previous) {
    const index = this.children.indexOf(previous);
    if (index < 0) throw new Error('missing child');
    previous.parentNode = null;
    next.parentNode = this;
    this.children.splice(index, 1, next);
  }
  replaceWith(next) { this.parentNode?.replaceChild(next, this); }
  normalize() {
    for (let index = 0; index < this.children.length - 1;) {
      const left = this.children[index];
      const right = this.children[index + 1];
      if (left.nodeType === TEXT_NODE && right.nodeType === TEXT_NODE) {
        left.nodeValue += right.nodeValue;
        this.children.splice(index + 1, 1);
        right.parentNode = null;
      } else index += 1;
    }
  }
}

class FakeText {
  constructor(value = '') {
    this.nodeType = TEXT_NODE;
    this.nodeValue = value;
    this.parentNode = null;
  }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
  splitText(offset) {
    const safe = Math.max(0, Math.min(this.nodeValue.length, offset));
    const tail = new FakeText(this.nodeValue.slice(safe));
    this.nodeValue = this.nodeValue.slice(0, safe);
    const parent = this.parentNode;
    if (parent) {
      const index = parent.children.indexOf(this);
      tail.parentNode = parent;
      parent.children.splice(index + 1, 0, tail);
    }
    return tail;
  }
  replaceWith(next) {
    this.parentNode?.replaceChild(next, this);
  }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName); }
  createTextNode(value) { return new FakeText(value); }
}

function createTree(text = 'abcdef') {
  const documentRef = new FakeDocument();
  const preview = new FakeElement('section');
  const block = preview.appendChild(new FakeElement('p'));
  const textNode = block.appendChild(new FakeText(text));
  return { documentRef, preview, block, textNode };
}

function range(node, start, end) {
  return { startContainer: node, endContainer: node, startOffset: start, endOffset: end };
}

function createRegistry() {
  const values = new Map();
  const deleted = [];
  return {
    values,
    deleted,
    set(name, value) { values.set(name, value); },
    delete(name) { deleted.push(name); return values.delete(name); }
  };
}

class FakeHighlight {
  constructor(...ranges) { this.ranges = ranges; }
}

test('R9-09 Highlight Session owns CSS Highlight multi-Range publication and exact range state', () => {
  const { documentRef, preview, textNode } = createTree();
  const second = preview.children[0].appendChild(new FakeText('ghij'));
  const registry = createRegistry();
  const firstRange = range(textNode, 1, 3);
  const secondRange = range(second, 0, 2);
  const session = createSelectionHighlightSession({ previewElement: preview, documentRef, highlightRegistry: registry, HighlightCtor: FakeHighlight });
  assert.equal(session.show({ ranges: [firstRange, secondRange] }), true);
  assert.deepEqual(registry.values.get('preview-selection-sync').ranges, [firstRange, secondRange]);
  assert.deepEqual(session.getState(), { active: true, rangeCount: 2, atomicCount: 0, fallbackCount: 0, hasRestore: false, restoreCount: 0, destroyed: false });
  session.destroy();
});

test('R9-09 Highlight Session replaces old CSS ranges and atomic classes through one authority', () => {
  const { documentRef, preview, block, textNode } = createTree();
  const registry = createRegistry();
  const session = createSelectionHighlightSession({ previewElement: preview, documentRef, highlightRegistry: registry, HighlightCtor: FakeHighlight });
  session.show({ ranges: [range(textNode, 0, 2)], atomicElements: [block] });
  assert.equal(block.classList.contains('preview-atomic-selection-highlight'), true);
  session.show({ ranges: [range(textNode, 2, 4)] });
  assert.equal(block.classList.contains('preview-atomic-selection-highlight'), false);
  assert.ok(registry.deleted.includes('preview-selection-sync'));
  assert.equal(session.getState().rangeCount, 1);
  session.destroy();
});

test('R9-09 Highlight Session provides the legacy single-text fallback when CSS Highlight is unavailable and clear restores text', () => {
  const { documentRef, preview, block, textNode } = createTree('abcdef');
  const session = createSelectionHighlightSession({ previewElement: preview, documentRef });
  assert.equal(session.show({ ranges: [range(textNode, 1, 4)] }), true);
  assert.equal(block.children.length, 3);
  const mark = block.children[1];
  assert.equal(mark.className, 'preview-text-highlight');
  assert.equal(mark.textContent, 'bcd');
  session.clear();
  assert.equal(block.children.length, 1);
  assert.equal(block.children[0].nodeValue, 'abcdef');
  assert.deepEqual(session.getState(), { active: false, rangeCount: 0, atomicCount: 0, fallbackCount: 0, hasRestore: false, restoreCount: 0, destroyed: false });
  session.destroy();
});

test('R9-09 Highlight Session rejects unsupported multi-Range fallback and ranges outside preview without side effects', () => {
  const { documentRef, preview, textNode } = createTree();
  const outside = new FakeElement('div');
  const outsideText = outside.appendChild(new FakeText('outside'));
  const session = createSelectionHighlightSession({ previewElement: preview, documentRef });
  assert.equal(session.canPresent({ ranges: [range(textNode, 0, 1), range(textNode, 2, 3)] }), false);
  assert.equal(session.show({ ranges: [range(textNode, 0, 1), range(textNode, 2, 3)] }), false);
  assert.equal(session.canPresent({ ranges: [range(outsideText, 0, 2)] }), false);
  assert.equal(session.show({ ranges: [range(outsideText, 0, 2)] }), false);
  assert.equal(session.getState().active, false);
  session.destroy();
});

test('R9-09 Highlight Session restores fresh ranges and atomic elements after virtual remount without retry scheduling', () => {
  const firstTree = createTree('first');
  const registry = createRegistry();
  const session = createSelectionHighlightSession({ previewElement: firstTree.preview, documentRef: firstTree.documentRef, highlightRegistry: registry, HighlightCtor: FakeHighlight });
  const firstRange = range(firstTree.textNode, 0, 3);
  let mountedText = firstTree.textNode;
  let mountedBlock = firstTree.block;
  const restore = () => ({ ranges: [range(mountedText, 1, 4)], atomicElements: [mountedBlock] });
  session.show({ ranges: [firstRange] }, { restore });

  const freshBlock = new FakeElement('p');
  const freshText = freshBlock.appendChild(new FakeText('fresh'));
  firstTree.preview.children = [freshBlock];
  freshBlock.parentNode = firstTree.preview;
  firstTree.block.parentNode = null;
  mountedText = freshText;
  mountedBlock = freshBlock;

  assert.equal(session.restore(), true);
  const active = registry.values.get('preview-selection-sync');
  assert.equal(active.ranges[0].startContainer, freshText);
  assert.equal(freshBlock.classList.contains('preview-atomic-selection-highlight'), true);
  assert.equal(session.getState().restoreCount, 1);
  assert.equal(session.getState().hasRestore, true);
  session.destroy();
});

test('R9-09 Highlight Session reports restore exceptions keeps intent and permits a later remount recovery', () => {
  const { documentRef, preview, textNode } = createTree();
  const registry = createRegistry();
  const errors = [];
  let fail = true;
  const session = createSelectionHighlightSession({
    previewElement: preview,
    documentRef,
    highlightRegistry: registry,
    HighlightCtor: FakeHighlight,
    reportError: (message, error) => errors.push({ message, error })
  });
  const restore = () => {
    if (fail) throw new Error('remount failed');
    return { ranges: [range(textNode, 2, 4)] };
  };
  session.show({ ranges: [range(textNode, 0, 2)] }, { restore });
  assert.equal(session.restore(), false);
  assert.equal(errors.length, 1);
  assert.equal(session.getState().hasRestore, true);
  fail = false;
  assert.equal(session.restore(), true);
  session.destroy();
});

test('R9-09 Highlight Session clear removes CSS ranges atomic classes and remount intent', () => {
  const { documentRef, preview, block, textNode } = createTree();
  const registry = createRegistry();
  const session = createSelectionHighlightSession({ previewElement: preview, documentRef, highlightRegistry: registry, HighlightCtor: FakeHighlight });
  session.show({ ranges: [range(textNode, 0, 2)], atomicElements: [block] }, { restore: () => ({ ranges: [range(textNode, 0, 2)] }) });
  session.clear();
  assert.equal(registry.values.has('preview-selection-sync'), false);
  assert.equal(block.classList.contains('preview-atomic-selection-highlight'), false);
  assert.equal(session.restore(), false);
  assert.equal(session.getState().hasRestore, false);
  session.destroy();
});

test('R9-09 Highlight Session destroy clears every effect and is terminal idempotent', () => {
  const { documentRef, preview, block, textNode } = createTree();
  const registry = createRegistry();
  const session = createSelectionHighlightSession({ previewElement: preview, documentRef, highlightRegistry: registry, HighlightCtor: FakeHighlight });
  session.show({ ranges: [range(textNode, 0, 2)], atomicElements: [block] }, { restore: () => ({ ranges: [range(textNode, 0, 2)] }) });
  session.destroy();
  session.destroy();
  assert.equal(registry.values.has('preview-selection-sync'), false);
  assert.equal(block.classList.contains('preview-atomic-selection-highlight'), false);
  assert.equal(session.getState().destroyed, true);
  assert.equal(session.getState().rangeCount, 0);
  assert.throws(() => session.show({ ranges: [] }), /destroyed/);
  assert.equal(session.restore(), false);
});
