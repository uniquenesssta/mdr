import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewRendererPort } from '../../../src/features/preview/render/preview-renderer-port.js';

function fakeRoot() {
  const listeners = new Map();
  return {
    querySelector() { return null; },
    querySelectorAll() { return []; },
    replaceChildren() {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    contains() { return true; },
    listenerCount() { return listeners.size; }
  };
}

test('Atomic 7.8 PreviewRendererPort owns specialized renderer lifecycle and shared presentation injection', () => {
  const root = fakeRoot();
  const documentRef = {
    body: {},
    defaultView: { navigator: {} },
    createElement(tag) {
      if (tag === 'template') return { content: { childNodes: [] }, set innerHTML(_) {} };
      return { className: '', dataset: {}, setAttribute() {}, classList: { add() {}, remove() {} } };
    }
  };
  const mathCalls = [];
  const port = createPreviewRendererPort({
    root,
    documentRef,
    documentModel: { sliceText() { return ''; } },
    presentation: {
      code: { getNormalizedCodeLanguage(value) { return value; }, renderHighlightedCodeRows() { return true; } },
      math: { delimiters: [], renderTree(node) { mathCalls.push(node); } },
      mermaid: { getTheme() { return 'default'; }, async renderDiagram() { return { status: 'rendered' }; } }
    }
  });
  assert.equal(port.start(), true);
  assert.equal(port.start(), false);
  assert.equal(root.listenerCount(), 2);
  const node = { querySelectorAll() { return []; } };
  assert.equal(port.renderMath([node]), 1);
  assert.deepEqual(mathCalls, [node]);
  port.destroy();
  assert.equal(root.listenerCount(), 0);
  assert.throws(() => port.renderMath([node]), /destroyed/);
});
