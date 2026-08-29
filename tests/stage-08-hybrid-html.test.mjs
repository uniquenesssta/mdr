import test from 'node:test';
import assert from 'node:assert/strict';
import { createHtmlBlockWidgetType } from '../src/features/hybrid-editor/widgets/html/html-block-widget.js';
import { renderHtmlBlockSource } from '../src/features/hybrid-editor/widgets/html/html-block-view.js';

class FakeWidgetType {}

test('Atomic 8.13 HTML widget factory requires an injected WidgetType base', () => {
  assert.throws(() => createHtmlBlockWidgetType(null), /WidgetType base is required/);
});

test('Atomic 8.13 HTML widget preserves descriptor identity and equality semantics', () => {
  const HtmlBlockWidget = createHtmlBlockWidgetType(FakeWidgetType);
  const first = new HtmlBlockWidget({ from: 4, to: 18, source: '<b>x</b>', fingerprint: 'fp-1' });
  const equal = new HtmlBlockWidget({ from: 4, to: 18, source: '<i>ignored by eq</i>', fingerprint: 'fp-1' });
  const changed = new HtmlBlockWidget({ from: 4, to: 18, source: '<b>x</b>', fingerprint: 'fp-2' });
  assert.equal(first.eq(equal), true);
  assert.equal(first.eq(changed), false);
});

test('Atomic 8.13 HTML widget keeps source normalization and source-derived fingerprint fallback', () => {
  const HtmlBlockWidget = createHtmlBlockWidgetType(FakeWidgetType);
  const widget = new HtmlBlockWidget({ from: 0, to: 1, source: 42 });
  assert.equal(widget.source, '42');
  assert.equal(widget.fingerprint, '42');
});

test('Atomic 8.13 HTML view preserves raw template.innerHTML rendering without transformation', () => {
  let raw = null;
  let published = null;
  const template = {
    set innerHTML(value) { raw = value; },
    content: { cloneNode() { return { raw }; } }
  };
  const documentRef = {
    createElement(tag) {
      assert.equal(tag, 'template');
      return template;
    }
  };
  const target = { replaceChildren(node) { published = node; } };
  const source = '<details open><summary>x</summary><em data-k="1">raw</em></details>';
  renderHtmlBlockSource(target, source, documentRef);
  assert.equal(raw, source);
  assert.deepEqual(published, { raw: source });
});

test('Atomic 8.13 HTML widget continues to shield CodeMirror events', () => {
  const HtmlBlockWidget = createHtmlBlockWidgetType(FakeWidgetType);
  const widget = new HtmlBlockWidget({ from: 1, to: 2, source: '<p>x</p>' });
  assert.equal(widget.ignoreEvent(), true);
});
