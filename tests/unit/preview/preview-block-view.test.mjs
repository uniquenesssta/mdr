import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewBlockView } from '../../../src/features/preview/render/preview-block-view.js';

function element(tag = 'P') {
  return { nodeType: 1, tagName: tag, dataset: {}, textContent: '', classList: { add() {} } };
}

test('Atomic 7.8 Preview Block View creates detached block nodes and projects source metadata', () => {
  const parsedElement = element('P');
  parsedElement.textContent = 'alpha';
  const textNode = { nodeType: 3, textContent: ' loose ' };
  const documentRef = {
    defaultView: { Node: { ELEMENT_NODE: 1 } },
    createElement(tag) { const node = element(tag.toUpperCase()); node.textContent = ''; return node; }
  };
  const seenHtml = [];
  const view = createPreviewBlockView({
    documentRef,
    parseHtml(html) { seenHtml.push(html); return [parsedElement, textNode, { nodeType: 3, textContent: '   ' }]; }
  });
  const nodes = view.createNodes({ id: 'b-1', raw: 'raw' }, source => `<p>${source}</p>`);
  assert.deepEqual(seenHtml, ['<p>raw</p>']);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].dataset.previewBlockId, 'b-1');
  assert.equal(nodes[1].tagName, 'SPAN');
  assert.equal(nodes[1].textContent, ' loose ');
  view.applySourceRange(nodes, { startLine: 3, endLine: 5, start: 20, end: 42 });
  assert.deepEqual(nodes.map(node => ({
    line: node.dataset.sourceLine,
    endLine: node.dataset.sourceEndLine,
    start: node.dataset.sourceStartIndex,
    end: node.dataset.sourceEndIndex
  })), [
    { line: '3', endLine: '5', start: '20', end: '42' },
    { line: '3', endLine: '5', start: '20', end: '42' }
  ]);
  view.destroy();
  assert.throws(() => view.createNodes({ id: 'b-2', html: '<p>x</p>' }), /destroyed/);
});
