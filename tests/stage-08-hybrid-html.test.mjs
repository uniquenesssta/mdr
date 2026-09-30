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

test('R12-22 HTML view fails closed when a real sanitizer DOM is unavailable', () => {
  let published = false;
  const target = { replaceChildren() { published = true; } };
  assert.throws(() => renderHtmlBlockSource(target, '<img onerror="unsafe">', {}), /real DOM document/);
  assert.equal(published, false);
});

test('Atomic 8.13 HTML widget continues to shield CodeMirror events', () => {
  const HtmlBlockWidget = createHtmlBlockWidgetType(FakeWidgetType);
  const widget = new HtmlBlockWidget({ from: 1, to: 2, source: '<p>x</p>' });
  assert.equal(widget.ignoreEvent(), true);
});
