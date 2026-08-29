
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAtxHeadingLine } from '../src/features/hybrid-editor/presentation/heading-presentation.js';
import { applyListLinePresentation } from '../src/features/hybrid-editor/presentation/list-presentation.js';
import { parseQuotePrefix } from '../src/features/hybrid-editor/presentation/quote-presentation.js';
import {
  normalizeReferenceLabel,
  parseReferenceDefinitionSource
} from '../src/features/hybrid-editor/presentation/link-presentation.js';
import {
  parseInlineColorStyles,
  parseInlineHtmlTag
} from '../src/features/hybrid-editor/presentation/html-inline-presentation.js';
import { applyFallbackInlinePresentation } from '../src/features/hybrid-editor/presentation/inline-format-presentation.js';
import { createInlinePresentationCoordinator } from '../src/features/hybrid-editor/presentation/inline-presentation-coordinator.js';

const Decoration = {
  replace(spec = {}) { return { kind: 'replace', spec, range: (from, to) => ({ kind: 'replace', spec, from, to }) }; },
  mark(spec = {}) { return { kind: 'mark', spec, range: (from, to) => ({ kind: 'mark', spec, from, to }) }; },
  line(spec = {}) { return { kind: 'line', spec, range: from => ({ kind: 'line', spec, from }) }; }
};

class WidgetType {}

test('Atomic 8.14 quote presentation preserves nested prefix depth and source offsets', () => {
  assert.deepEqual(parseQuotePrefix('  > > quoted'), {
    depth: 2,
    markerFrom: 2,
    markerTo: 6,
    contentFrom: 6,
    content: 'quoted'
  });
  assert.equal(parseQuotePrefix('plain'), null);
});

test('Atomic 8.14 heading presentation preserves ATX scale class and marker replacement range', () => {
  const lineClasses = new Map();
  const lineStyles = new Map();
  const replaced = [];
  const addLineClass = (map, from, value) => map.set(from, new Set([...(map.get(from) || []), value]));
  const addLineStyle = (map, from, key, value) => map.set(from, new Map([...(map.get(from) || []), [key, value]]));
  const heading = applyAtxHeadingLine({
    line: { from: 10 },
    content: '## Title',
    contentOffset: 0,
    lineClasses,
    lineStyles,
    replace: (from, to) => replaced.push([from, to]),
    Decoration,
    addLineClass,
    addLineStyle
  });
  assert.equal(heading.level, 2);
  assert.deepEqual(replaced, [[10, 13]]);
  assert.equal(lineStyles.get(10).get('font-size'), '155%');
  assert.match([...lineClasses.get(10)].join(' '), /cm-hybrid-heading-2/);
});

test('Atomic 8.14 list presentation preserves task marker writeback position and terminal handling', () => {
  class TaskCheckboxWidget { constructor(descriptor) { this.descriptor = descriptor; } }
  class HybridPrefixWidget {}
  const lineClasses = new Map();
  const replacements = [];
  const terminal = applyListLinePresentation({
    line: { from: 20 },
    content: '- [x] done',
    contentOffset: 0,
    heading: null,
    lineClasses,
    addLineClass: (map, from, value) => map.set(from, new Set([value])),
    replace: (from, to, decoration) => replacements.push({ from, to, decoration }),
    Decoration,
    TaskCheckboxWidget,
    HybridPrefixWidget
  });
  assert.equal(terminal, true);
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].from, 20);
  assert.equal(replacements[0].to, 26);
  assert.equal(replacements[0].decoration.spec.widget.descriptor.checked, true);
  assert.equal(replacements[0].decoration.spec.widget.descriptor.markerFrom, 23);
});

test('Atomic 8.14 link presentation preserves reference normalization and definition parsing', () => {
  assert.equal(normalizeReferenceLabel('[  Docs   Home ]'), 'docs home');
  assert.deepEqual(parseReferenceDefinitionSource(' [Docs]: <https://example.com> "Title"'), {
    label: 'docs',
    url: 'https://example.com'
  });
  assert.equal(parseReferenceDefinitionSource('not a definition'), null);
});

test('Atomic 8.14 inline HTML presentation preserves supported tags and strict six-digit color projection', () => {
  assert.deepEqual(parseInlineHtmlTag('<a href="https://example.com">'), {
    name: 'a',
    closing: false,
    selfClosing: false,
    url: 'https://example.com'
  });
  assert.deepEqual(parseInlineColorStyles('<span style="color:#AABBCC;background-color:#001122">'), {
    color: '#aabbcc',
    backgroundColor: '#001122'
  });
  assert.equal(parseInlineColorStyles('<span style="color:red">'), null);
});

test('Atomic 8.14 fallback formatting keeps visible content while hiding strong source markers', () => {
  const hidden = [];
  const marks = [];
  applyFallbackInlinePresentation({
    view: {},
    line: { from: 5, to: 13, text: '**bold**' },
    replaceUncovered: (from, to) => hidden.push([from, to]),
    blockRanges: [],
    editableRanges: [],
    addMark: (from, to, className) => marks.push([from, to, className]),
    referenceDefinitions: new Map(),
    overlapsRanges: () => false,
    intersectsRevealRanges: () => false,
    lexInline: () => [{ type: 'strong', raw: '**bold**', tokens: [{ type: 'text', raw: 'bold' }] }],
    Decoration,
    applyFallbackLinkToken: () => false,
    applyFallbackReferenceLinks: () => {}
  });
  assert.deepEqual(hidden, [[5, 7], [11, 13]]);
  assert.deepEqual(marks, [[5, 13, 'cm-hybrid-strong']]);
});

test('Atomic 8.14 coordinator requires explicit editor/model/presentation capabilities and returns one builder', () => {
  assert.throws(() => createInlinePresentationCoordinator({}), /Decoration/);
  const builder = createInlinePresentationCoordinator({
    Decoration,
    WidgetType,
    lexInline: () => [],
    renderFormula: () => {},
    collectInlineMathRanges: () => [],
    collectVisibleLines: () => [],
    intersectsRanges: () => false,
    intersectsRevealRanges: () => false,
    overlapsRanges: () => false,
    shouldDecorateSourceActiveLine: () => false
  });
  assert.equal(typeof builder, 'function');
});
