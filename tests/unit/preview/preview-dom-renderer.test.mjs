import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewDomRenderer } from '../../../src/features/preview/render/preview-dom-renderer.js';

function bodyNode() {
  const body = {
    className: '',
    dataset: {},
    children: [],
    parentNode: null,
    classList: { contains(name) { return String(body.className).split(/\s+/).includes(name); } },
    get childNodes() { return body.children; },
    get firstChild() { return body.children[0] || null; },
    append(...nodes) { nodes.forEach(node => { node.parentNode = body; body.children.push(node); }); },
    replaceChildren(...nodes) { body.children = []; body.append(...nodes); },
    insertBefore(node, cursor) {
      const existing = body.children.indexOf(node);
      if (existing >= 0) body.children.splice(existing, 1);
      const index = cursor ? body.children.indexOf(cursor) : -1;
      node.parentNode = body;
      if (index >= 0) body.children.splice(index, 0, node);
      else body.children.push(node);
    }
  };
  return body;
}

function blockNode(id) {
  return {
    dataset: { previewBlockId: id, previewNodeIndex: '0' },
    parentNode: null,
    remove() { if (!this.parentNode) return; const list = this.parentNode.children; const index = list.indexOf(this); if (index >= 0) list.splice(index, 1); this.parentNode = null; }
  };
}

test('Atomic 7.8 Preview DOM Renderer patches incremental blocks and reports replacement facts without geometry work', () => {
  let currentBody = null;
  const documentRef = {
    createElement(tag) {
      assert.equal(tag, 'div');
      return bodyNode();
    }
  };
  const root = {
    querySelector(selector) { assert.equal(selector, '.markdown-body'); return currentBody; },
    replaceChildren(body) { currentBody = body; body.parentNode = root; }
  };
  const blockView = {
    createNodes(block) { return [blockNode(block.id)]; },
    applySourceRange(nodes, block) {
      for (const node of nodes) {
        node.dataset.sourceLine = String(block.startLine);
        node.dataset.sourceEndLine = String(block.endLine);
        node.dataset.sourceStartIndex = String(block.start);
        node.dataset.sourceEndIndex = String(block.end);
      }
    }
  };
  const renderer = createPreviewDomRenderer({ root, documentRef, blockView });
  const result = renderer.patchBlocks({
    blocks: [
      { id: 'a', startLine: 1, endLine: 1, start: 0, end: 4 },
      { id: 'b', startLine: 2, endLine: 3, start: 5, end: 12 }
    ],
    changedIds: new Set(['a', 'b']),
    incremental: true,
    parsedChars: 12,
    reason: 'incremental'
  });
  assert.equal(result.bodyReplaced, true);
  assert.equal(result.changedNodes.length, 2);
  assert.equal(result.anchors.length, 2);
  assert.equal(result.body.children.length, 2);
  assert.equal(result.body.children[1].dataset.sourceEndLine, '3');
  renderer.destroy();
  assert.throws(() => renderer.patchBlocks({ blocks: [] }), /destroyed/);
});
