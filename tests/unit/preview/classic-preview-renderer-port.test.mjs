import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewRendererPort } from '../../../src/features/preview/index.js';
test('R16-08 the explicit Preview renderer owns actual specialized renderer lifecycle without a DOM property bridge', async () => {
  const listeners = new Map(), calls = [];
  const root = { querySelector: () => null, querySelectorAll: () => [], replaceChildren() {}, contains: () => true,
    addEventListener(type, callback) { listeners.set(type, callback); }, removeEventListener(type) { listeners.delete(type); } };
  const documentRef = { body: {}, defaultView: { navigator: {} }, createElement: () => ({ className: '', dataset: {}, setAttribute() {}, classList: { add() {}, remove() {} } }) };
  const renderer = createPreviewRendererPort({ root, documentRef, documentModel: { sliceText: () => '' },
    presentation: { code: { getNormalizedCodeLanguage: value => value, renderHighlightedCodeRows: () => true },
      math: { delimiters: [], renderTree: node => calls.push(node) },
      mermaid: { getTheme: () => 'default', renderDiagram: async () => ({ status: 'rendered' }) } } });
  const node = { querySelectorAll: () => [] };
  assert.throws(() => renderer.renderCode([node]), /not started/);
  assert.equal(renderer.start(), true); assert.equal(renderer.start(), false);
  assert.equal(listeners.size, 2);
  assert.equal(renderer.renderMath([node]), 1);
  await renderer.renderMermaid([node], () => false);
  assert.deepEqual(calls, [node]);
  renderer.destroy(); renderer.destroy();
  assert.equal(listeners.size, 0);
  assert.throws(() => renderer.renderMath([node]), /destroyed/);
});
