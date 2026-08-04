import { marked } from 'marked';
import { parseTableRow } from '../editor/hybrid/table-model.js';

const ATOMIC_CHARACTER = '\uFFFC';
const LOOKAHEAD_LIMIT = 96;
const SKIPPED_ELEMENT_SELECTOR = [
  'button', 'input', 'textarea', 'select', 'option', 'script', 'style', 'template',
  '.preview-code-copy', '.markdown-code-line-number', '[aria-hidden="true"]'
].join(',');

function isWhitespace(character) {
  return /\s/.test(character);
}

function decodeEntity(entity) {
  const match = String(entity || '').match(/^&#(?:(x)([0-9a-f]+)|(\d+));$/i);
  if (match) {
    const value = Number.parseInt(match[1] ? match[2] : match[3], match[1] ? 16 : 10);
    if (Number.isFinite(value)) {
      try { return String.fromCodePoint(value); } catch (_) { return entity; }
    }
  }
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    copy: '©', reg: '®', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»'
  };
  const name = String(entity || '').slice(1, -1);
  return Object.hasOwn(named, name) ? named[name] : entity;
}

class SourceProjectionBuilder {
  constructor() {
    this.characters = [];
    this.entries = [];
  }

  appendCharacter(character, from, to, options = {}) {
    const value = String(character || '');
    if (!value) return;
    const safeFrom = Math.max(0, Number(from) || 0);
    const safeTo = Math.max(safeFrom + 1, Number(to) || safeFrom + 1);
    if (isWhitespace(value)) {
      if (!this.characters.length) return;
      if (this.characters[this.characters.length - 1] === ' ') {
        const previous = this.entries[this.entries.length - 1];
        previous.to = Math.max(previous.to, safeTo);
        return;
      }
      this.characters.push(' ');
      this.entries.push({ from: safeFrom, to: safeTo, atomic: false });
      return;
    }
    this.characters.push(value);
    this.entries.push({ from: safeFrom, to: safeTo, atomic: Boolean(options.atomic) });
  }

  appendAtomic(from, to) {
    this.appendCharacter(ATOMIC_CHARACTER, from, to, { atomic: true });
  }

  finish() {
    while (this.characters[this.characters.length - 1] === ' ') {
      this.characters.pop();
      this.entries.pop();
    }
    return { text: this.characters.join(''), entries: this.entries };
  }
}

class DomProjectionBuilder {
  constructor() {
    this.characters = [];
    this.entries = [];
  }

  appendTextCharacter(character, node, startOffset, endOffset) {
    if (isWhitespace(character)) {
      if (!this.characters.length) return;
      if (this.characters[this.characters.length - 1] === ' ') {
        const previous = this.entries[this.entries.length - 1];
        if (previous?.type === 'text' && previous.node === node) previous.endOffset = endOffset;
        return;
      }
      this.characters.push(' ');
      this.entries.push({ type: 'text', node, startOffset, endOffset });
      return;
    }
    this.characters.push(character);
    this.entries.push({ type: 'text', node, startOffset, endOffset });
  }

  appendAtomic(element) {
    this.characters.push(ATOMIC_CHARACTER);
    this.entries.push({ type: 'element', element });
  }

  finish() {
    while (this.characters[this.characters.length - 1] === ' ') {
      this.characters.pop();
      this.entries.pop();
    }
    return { text: this.characters.join(''), entries: this.entries };
  }
}

function isEscaped(source, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function findClosingDelimiter(source, start, delimiter) {
  let cursor = start;
  while (cursor < source.length) {
    const index = source.indexOf(delimiter, cursor);
    if (index < 0) return -1;
    if (!isEscaped(source, index)) return index;
    cursor = index + delimiter.length;
  }
  return -1;
}

function findBackslashDisplayMathRange(source, index) {
  if (!source.startsWith('\\[', index) || isEscaped(source, index)) return null;
  const lineStart = source.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  if (!/^[ \t]{0,3}$/.test(source.slice(lineStart, index))) return null;
  const lineEndIndex = source.indexOf('\n', index);
  const lineEnd = lineEndIndex < 0 ? source.length : lineEndIndex;
  const sameLineClose = source.indexOf('\\]', index + 2);
  if (sameLineClose >= 0
    && sameLineClose < lineEnd
    && !isEscaped(source, sameLineClose)
    && !source.slice(sameLineClose + 2, lineEnd).trim()) {
    return { from: index, to: sameLineClose + 2 };
  }
  if (source.slice(index + 2, lineEnd).trim()) return null;

  let cursor = lineEndIndex < 0 ? source.length : lineEndIndex + 1;
  while (cursor < source.length) {
    const nextEndIndex = source.indexOf('\n', cursor);
    const nextEnd = nextEndIndex < 0 ? source.length : nextEndIndex;
    const line = source.slice(cursor, nextEnd);
    if (/^[ \t]*\\][ \t]*$/.test(line)) {
      const closeOffset = line.indexOf('\\]');
      return { from: index, to: cursor + closeOffset + 2 };
    }
    cursor = nextEndIndex < 0 ? source.length : nextEndIndex + 1;
  }
  return null;
}

function findMathRangeAt(source, index) {
  if (source.startsWith('$$', index) && !isEscaped(source, index)) {
    const close = findClosingDelimiter(source, index + 2, '$$');
    if (close >= 0) return { from: index, to: close + 2 };
  }
  const backslashDisplay = findBackslashDisplayMathRange(source, index);
  if (backslashDisplay) return backslashDisplay;
  if (source.startsWith('\\(', index) && !isEscaped(source, index)) {
    const close = findClosingDelimiter(source, index + 2, '\\)');
    if (close >= 0 && !source.slice(index + 2, close).includes('\n')) return { from: index, to: close + 2 };
  }
  if (source[index] === '$' && source[index + 1] !== '$' && !isEscaped(source, index)) {
    const close = findClosingDelimiter(source, index + 1, '$');
    if (close > index + 1 && !source.slice(index + 1, close).includes('\n')) return { from: index, to: close + 1 };
  }
  return null;
}

function appendLiteralSource(builder, source, absoluteStart) {
  const value = String(source || '');
  let index = 0;
  while (index < value.length) {
    const math = findMathRangeAt(value, index);
    if (math) {
      builder.appendAtomic(absoluteStart + math.from, absoluteStart + math.to);
      index = math.to;
      continue;
    }
    if (value[index] === '&') {
      const entity = value.slice(index).match(/^&(?:#x?[0-9a-f]+|[a-z][a-z0-9]+);/i)?.[0];
      if (entity) {
        const decoded = decodeEntity(entity);
        for (let charIndex = 0; charIndex < decoded.length; charIndex += 1) {
          builder.appendCharacter(decoded[charIndex], absoluteStart + index, absoluteStart + index + entity.length);
        }
        index += entity.length;
        continue;
      }
    }
    builder.appendCharacter(value[index], absoluteStart + index, absoluteStart + index + 1);
    index += 1;
  }
}

function appendRenderedTokenText(builder, renderedText, raw, absoluteStart) {
  const rendered = String(renderedText || '');
  const source = String(raw || '');
  if (!rendered) return;
  const directIndex = source.indexOf(rendered);
  if (directIndex >= 0) {
    appendLiteralSource(builder, source.slice(directIndex, directIndex + rendered.length), absoluteStart + directIndex);
    return;
  }
  for (let index = 0; index < rendered.length; index += 1) {
    builder.appendCharacter(rendered[index], absoluteStart, absoluteStart + Math.max(1, source.length));
  }
}

function locateRaw(parentSource, raw, cursor) {
  const source = String(parentSource || '');
  const value = String(raw || '');
  if (!value) return Math.max(0, Math.min(source.length, cursor));
  let index = source.indexOf(value, Math.max(0, cursor));
  if (index < 0) index = source.indexOf(value);
  return index < 0 ? Math.max(0, Math.min(source.length, cursor)) : index;
}

function collectMathRanges(source) {
  const ranges = [];
  const value = String(source || '');
  let index = 0;
  while (index < value.length) {
    const range = findMathRangeAt(value, index);
    if (range) {
      ranges.push(range);
      index = range.to;
    } else {
      index += 1;
    }
  }
  return ranges;
}

function projectInlineTokens(tokens, parentSource, absoluteStart, builder) {
  const source = String(parentSource || '');
  const mathRanges = collectMathRanges(source);
  if (mathRanges.length) {
    let sourceCursor = 0;
    for (const math of mathRanges) {
      if (math.from > sourceCursor) {
        const prefix = source.slice(sourceCursor, math.from);
        projectInlineTokens(marked.Lexer.lexInline(prefix), prefix, absoluteStart + sourceCursor, builder);
      }
      builder.appendAtomic(absoluteStart + math.from, absoluteStart + math.to);
      sourceCursor = math.to;
    }
    if (sourceCursor < source.length) {
      const suffix = source.slice(sourceCursor);
      projectInlineTokens(marked.Lexer.lexInline(suffix), suffix, absoluteStart + sourceCursor, builder);
    }
    return;
  }

  let cursor = 0;
  for (const token of Array.from(tokens || [])) {
    const raw = String(token?.raw ?? token?.text ?? '');
    const localFrom = locateRaw(source, raw, cursor);
    projectInlineToken(token, raw, absoluteStart + localFrom, builder);
    cursor = Math.max(cursor, localFrom + raw.length);
  }
}

function projectInlineToken(token, raw, absoluteStart, builder) {
  const type = String(token?.type || '');
  if (type === 'html') return;
  if (type === 'image') {
    builder.appendAtomic(absoluteStart, absoluteStart + Math.max(1, raw.length));
    return;
  }
  if (type === 'br') {
    builder.appendCharacter(' ', absoluteStart, absoluteStart + Math.max(1, raw.length));
    return;
  }
  if (type === 'escape') {
    appendRenderedTokenText(builder, token.text, raw, absoluteStart);
    return;
  }
  if (type === 'codespan') {
    const delimiter = raw.match(/^(`+)/)?.[1] || '';
    const contentFrom = delimiter.length;
    const contentTo = Math.max(contentFrom, raw.length - delimiter.length);
    appendRenderedTokenText(builder, token.text, raw.slice(contentFrom, contentTo), absoluteStart + contentFrom);
    return;
  }
  if (Array.isArray(token?.tokens) && token.tokens.length) {
    projectInlineTokens(token.tokens, raw, absoluteStart, builder);
    return;
  }
  appendLiteralSource(builder, raw || token?.text || '', absoluteStart);
}

function projectTable(source, absoluteStart, builder) {
  const lines = String(source || '').split('\n');
  let lineOffset = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const absoluteLineStart = absoluteStart + lineOffset;
    lineOffset += line.length + 1;
    if (lineIndex === 1 || !line.trim()) continue;
    const row = parseTableRow(line, absoluteLineStart);
    for (const cell of row.cells) {
      const inlineTokens = marked.Lexer.lexInline(cell.raw || '');
      projectInlineTokens(inlineTokens, cell.raw || '', cell.from, builder);
    }
  }
}

function projectCode(token, raw, absoluteStart, builder) {
  const source = String(raw || '');
  const opening = source.match(/^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/);
  if (opening) {
    const contentFrom = opening[0].length;
    const lines = source.split('\n');
    let closingLineIndex = -1;
    for (let index = lines.length - 1; index >= 1; index -= 1) {
      const marker = lines[index].match(/^ {0,3}(`{3,}|~{3,})\s*$/)?.[1];
      if (marker && marker[0] === opening[1][0] && marker.length >= opening[1].length) {
        closingLineIndex = index;
        break;
      }
    }
    let contentTo = source.length;
    if (closingLineIndex >= 0) {
      contentTo = 0;
      for (let index = 0; index < closingLineIndex; index += 1) contentTo += lines[index].length + 1;
    }
    appendLiteralSource(builder, source.slice(contentFrom, contentTo), absoluteStart + contentFrom);
    return;
  }
  let lineOffset = 0;
  for (const line of source.split('\n')) {
    const prefix = line.match(/^(?: {4}|\t)/)?.[0] || '';
    appendLiteralSource(builder, line.slice(prefix.length), absoluteStart + lineOffset + prefix.length);
    lineOffset += line.length + 1;
    if (lineOffset <= source.length) builder.appendCharacter('\n', absoluteStart + lineOffset - 1, absoluteStart + lineOffset);
  }
}

function projectBlockToken(token, raw, absoluteStart, builder) {
  const type = String(token?.type || '');
  if (type === 'space' || type === 'def' || type === 'hr') return;
  if (type === 'code') {
    projectCode(token, raw, absoluteStart, builder);
    return;
  }
  if (type === 'table') {
    projectTable(raw, absoluteStart, builder);
    return;
  }
  if (type === 'list') {
    let cursor = 0;
    for (const item of Array.from(token.items || [])) {
      const itemRaw = String(item?.raw || item?.text || '');
      const localFrom = locateRaw(raw, itemRaw, cursor);
      if (Array.isArray(item?.tokens)) projectBlockTokens(item.tokens, itemRaw, absoluteStart + localFrom, builder);
      cursor = Math.max(cursor, localFrom + itemRaw.length);
    }
    return;
  }
  if (Array.isArray(token?.tokens) && token.tokens.length) {
    const inlineTypes = new Set(['paragraph', 'heading', 'text']);
    if (inlineTypes.has(type)) projectInlineTokens(token.tokens, raw, absoluteStart, builder);
    else projectBlockTokens(token.tokens, raw, absoluteStart, builder);
    return;
  }
  if (type === 'html') {
    const stripped = String(raw || '').replace(/<[^>]*>/g, '');
    appendRenderedTokenText(builder, stripped, raw, absoluteStart);
    return;
  }
  appendLiteralSource(builder, raw || token?.text || '', absoluteStart);
}

function projectBlockTokens(tokens, parentSource, absoluteStart, builder) {
  const source = String(parentSource || '');
  let cursor = 0;
  for (const token of Array.from(tokens || [])) {
    const raw = String(token?.raw ?? token?.text ?? '');
    if (!raw) continue;
    const localFrom = locateRaw(source, raw, cursor);
    projectBlockToken(token, raw, absoluteStart + localFrom, builder);
    cursor = Math.max(cursor, localFrom + raw.length);
  }
}

export function createMarkdownSourceProjection(source, absoluteStart = 0) {
  const value = String(source || '');
  const builder = new SourceProjectionBuilder();
  const leading = value.match(/^\s*/)?.[0]?.length || 0;
  const trailing = value.match(/\s*$/)?.[0]?.length || 0;
  const trimmedEnd = Math.max(leading, value.length - trailing);
  const trimmed = value.slice(leading, trimmedEnd);
  const wholeMath = findMathRangeAt(trimmed, 0);
  if (wholeMath && wholeMath.from === 0 && wholeMath.to === trimmed.length) {
    builder.appendAtomic(absoluteStart + leading, absoluteStart + trimmedEnd);
    return builder.finish();
  }
  let tokens = [];
  try {
    tokens = marked.lexer(value) || [];
  } catch (_) {
    tokens = [];
  }
  if (tokens.length) projectBlockTokens(tokens, value, absoluteStart, builder);
  else appendLiteralSource(builder, value, absoluteStart);
  return builder.finish();
}

function isAtomicElement(element) {
  if (!(element instanceof Element)) return false;
  if (element.matches('img, .katex-display')) return true;
  return element.matches('.katex') && !element.parentElement?.closest?.('.katex, .katex-display');
}

function appendDomNode(node, builder, root) {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.nodeValue || '';
    for (let index = 0; index < value.length; index += 1) {
      builder.appendTextCharacter(value[index], node, index, index + 1);
    }
    return;
  }
  if (!(node instanceof Element)) return;
  if (node !== root && node.matches(SKIPPED_ELEMENT_SELECTOR)) return;
  if (node !== root && isAtomicElement(node)) {
    builder.appendAtomic(node);
    return;
  }
  if (node.tagName === 'BR') {
    const parent = node.parentNode;
    if (parent) {
      const offset = Array.prototype.indexOf.call(parent.childNodes, node);
      builder.characters.push(' ');
      builder.entries.push({ type: 'element-boundary', parent, startOffset: offset, endOffset: offset + 1 });
    }
    return;
  }
  for (const child of Array.from(node.childNodes)) appendDomNode(child, builder, root);
}

export function createPreviewDomProjection(root) {
  const builder = new DomProjectionBuilder();
  if (root) appendDomNode(root, builder, root);
  return builder.finish();
}

function alignProjectionTexts(sourceText, domText) {
  const sourceToDom = new Array(sourceText.length).fill(-1);
  const domToSource = new Array(domText.length).fill(-1);
  if (sourceText === domText) {
    for (let index = 0; index < sourceText.length; index += 1) {
      sourceToDom[index] = index;
      domToSource[index] = index;
    }
    return { sourceToDom, domToSource, exact: true };
  }
  let sourceIndex = 0;
  let domIndex = 0;
  while (sourceIndex < sourceText.length && domIndex < domText.length) {
    if (sourceText[sourceIndex] === domText[domIndex]) {
      sourceToDom[sourceIndex] = domIndex;
      domToSource[domIndex] = sourceIndex;
      sourceIndex += 1;
      domIndex += 1;
      continue;
    }
    let nextDom = -1;
    let nextSource = -1;
    for (let lookahead = 1; lookahead <= LOOKAHEAD_LIMIT; lookahead += 1) {
      if (nextDom < 0 && domIndex + lookahead < domText.length
        && domText[domIndex + lookahead] === sourceText[sourceIndex]) nextDom = lookahead;
      if (nextSource < 0 && sourceIndex + lookahead < sourceText.length
        && sourceText[sourceIndex + lookahead] === domText[domIndex]) nextSource = lookahead;
      if (nextDom >= 0 || nextSource >= 0) break;
    }
    if (nextDom >= 0 && (nextSource < 0 || nextDom <= nextSource)) domIndex += nextDom;
    else if (nextSource >= 0) sourceIndex += nextSource;
    else {
      sourceIndex += 1;
      domIndex += 1;
    }
  }
  const mapped = sourceToDom.reduce((count, value) => count + Number(value >= 0), 0);
  return {
    sourceToDom,
    domToSource,
    exact: mapped === sourceText.length && sourceText.length === domText.length,
    coverage: sourceText.length ? mapped / sourceText.length : 1
  };
}

function setRangeBoundary(range, side, entry) {
  const method = side === 'start' ? 'setStart' : 'setEnd';
  if (entry.type === 'text') {
    range[method](entry.node, side === 'start' ? entry.startOffset : entry.endOffset);
    return true;
  }
  if (entry.type === 'element') {
    const parent = entry.element.parentNode;
    if (!parent) return false;
    const offset = Array.prototype.indexOf.call(parent.childNodes, entry.element);
    range[method](parent, side === 'start' ? offset : offset + 1);
    return true;
  }
  if (entry.type === 'element-boundary') {
    range[method](entry.parent, side === 'start' ? entry.startOffset : entry.endOffset);
    return true;
  }
  return false;
}

function createDomRange(entries, fromIndex, toIndex) {
  const first = entries[fromIndex];
  const last = entries[toIndex];
  if (!first || !last) return null;
  const range = document.createRange();
  if (!setRangeBoundary(range, 'start', first) || !setRangeBoundary(range, 'end', last)) return null;
  return range;
}

export function createPreviewRangesForSourceSelection(root, source, absoluteStart, selectionFrom, selectionTo) {
  const sourceProjection = createMarkdownSourceProjection(source, absoluteStart);
  const domProjection = createPreviewDomProjection(root);
  const alignment = alignProjectionTexts(sourceProjection.text, domProjection.text);
  const from = Math.min(selectionFrom, selectionTo);
  const to = Math.max(selectionFrom, selectionTo);
  const domIndices = [];
  const atomicElements = new Set();
  let sourceCharacters = 0;
  for (let index = 0; index < sourceProjection.entries.length; index += 1) {
    const entry = sourceProjection.entries[index];
    if (entry.to <= from || entry.from >= to) continue;
    sourceCharacters += 1;
    const domIndex = alignment.sourceToDom[index];
    if (domIndex >= 0) {
      domIndices.push(domIndex);
      const domEntry = domProjection.entries[domIndex];
      if (entry.atomic && domEntry?.type === 'element') atomicElements.add(domEntry.element);
    }
  }
  const unique = [...new Set(domIndices)].sort((left, right) => left - right);
  const ranges = [];
  let groupStart = -1;
  let previous = -2;
  for (const index of unique) {
    if (groupStart < 0 || index > previous + 1) {
      if (groupStart >= 0) {
        const range = createDomRange(domProjection.entries, groupStart, previous);
        if (range) ranges.push(range);
      }
      groupStart = index;
    }
    previous = index;
  }
  if (groupStart >= 0) {
    const range = createDomRange(domProjection.entries, groupStart, previous);
    if (range) ranges.push(range);
  }
  return {
    ranges,
    sourceCharacters,
    mappedCharacters: unique.length,
    coverage: sourceCharacters ? unique.length / sourceCharacters : 1,
    projectionCoverage: alignment.coverage ?? (alignment.exact ? 1 : 0),
    sourceText: sourceProjection.text,
    domText: domProjection.text,
    atomicElements: [...atomicElements]
  };
}

function closestAtomicElement(root, node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const atomic = element?.closest?.('img, .katex, .katex-display');
  return atomic && root?.contains?.(atomic) ? atomic : null;
}

function getProjectionEntryNode(entry) {
  if (entry?.type === 'text') return entry.node;
  if (entry?.type === 'element') return entry.element;
  if (entry?.type === 'element-boundary') {
    return entry.parent?.childNodes?.[entry.startOffset] || entry.parent;
  }
  return null;
}

function projectionEntryBelongsToNode(entry, node) {
  if (!entry || !node) return false;
  const entryNode = getProjectionEntryNode(entry);
  if (!entryNode) return false;
  if (entryNode === node) return true;
  return node.nodeType === Node.ELEMENT_NODE && typeof node.contains === 'function' && node.contains(entryNode);
}

function findProjectionRangeInNode(entries, node) {
  let first = -1;
  let last = -1;
  for (let index = 0; index < entries.length; index += 1) {
    if (!projectionEntryBelongsToNode(entries[index], node)) continue;
    if (first < 0) first = index;
    last = index;
  }
  return { first, last };
}

function findDomBoundaryForTextPoint(entries, node, offset) {
  const safeOffset = Math.max(0, Math.min(node?.nodeValue?.length || 0, Number(offset) || 0));
  let previous = -1;
  let next = -1;
  let firstInNode = -1;
  let lastInNode = -1;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.type !== 'text' || entry.node !== node) continue;
    if (firstInNode < 0) firstInNode = index;
    lastInNode = index;
    if (entry.endOffset <= safeOffset) previous = index;
    if (next < 0 && entry.startOffset >= safeOffset) next = index;
    // A normalized whitespace entry can span several original DOM characters.
    // A point inside that span belongs to the same visible character on both sides.
    if (entry.startOffset < safeOffset && safeOffset < entry.endOffset) {
      previous = index;
      next = index;
      break;
    }
  }
  // Text-node boundaries frequently coincide with Markdown element boundaries
  // (for example </strong> followed by a plain text node). Include the adjacent
  // projected entry so both DOM representations of the same visual boundary map
  // consistently according to start/end affinity.
  if (previous < 0 && firstInNode > 0) previous = firstInNode - 1;
  if (next < 0 && lastInNode >= 0 && lastInNode + 1 < entries.length) next = lastInNode + 1;
  return { previous, next };
}

function findDomBoundaryForElementPoint(entries, node, offset) {
  const childCount = node?.childNodes?.length || 0;
  const safeOffset = Math.max(0, Math.min(childCount, Number(offset) || 0));
  let previous = -1;
  let next = -1;

  for (let childIndex = safeOffset - 1; childIndex >= 0; childIndex -= 1) {
    const range = findProjectionRangeInNode(entries, node.childNodes[childIndex]);
    if (range.last >= 0) {
      previous = range.last;
      break;
    }
  }
  for (let childIndex = safeOffset; childIndex < childCount; childIndex += 1) {
    const range = findProjectionRangeInNode(entries, node.childNodes[childIndex]);
    if (range.first >= 0) {
      next = range.first;
      break;
    }
  }
  return { previous, next };
}

function findAlignedSourceIndex(domIndex, domToSource, direction) {
  if (!Number.isFinite(domIndex) || domIndex < 0) return -1;
  for (let index = domIndex; index >= 0 && index < domToSource.length; index += direction) {
    if (domToSource[index] >= 0) return domToSource[index];
  }
  return -1;
}

function resolveSourceBoundary(boundary, alignment, sourceEntries, affinity) {
  const previousSourceIndex = findAlignedSourceIndex(boundary.previous, alignment.domToSource, -1);
  const nextSourceIndex = findAlignedSourceIndex(boundary.next, alignment.domToSource, 1);
  const previousEntry = sourceEntries[previousSourceIndex];
  const nextEntry = sourceEntries[nextSourceIndex];

  // DOM selection points are boundaries between visible characters. For a start
  // boundary, choose the next visible source character (after hidden closing
  // Markdown markers). For an end boundary, choose the previous character end
  // (before those markers). This preserves exact rendered selection semantics.
  if (affinity === 'end') {
    if (previousEntry) return { position: previousEntry.to, entry: previousEntry };
    if (nextEntry) return { position: nextEntry.from, entry: nextEntry };
  } else {
    if (nextEntry) return { position: nextEntry.from, entry: nextEntry };
    if (previousEntry) return { position: previousEntry.to, entry: previousEntry };
  }
  return null;
}

export function mapPreviewDomPointToSource(root, source, absoluteStart, node, offset, affinity = 'start') {
  const sourceProjection = createMarkdownSourceProjection(source, absoluteStart);
  const domProjection = createPreviewDomProjection(root);
  const alignment = alignProjectionTexts(sourceProjection.text, domProjection.text);
  const atomic = closestAtomicElement(root, node);
  if (atomic) {
    const domIndex = domProjection.entries.findIndex(entry => entry.type === 'element'
      && (entry.element === atomic || entry.element.contains?.(atomic) || atomic.contains?.(entry.element)));
    const sourceIndex = findAlignedSourceIndex(domIndex, alignment.domToSource, affinity === 'end' ? -1 : 1);
    const entry = sourceProjection.entries[sourceIndex];
    if (!entry) return null;
    return {
      position: affinity === 'end' ? entry.to : entry.from,
      from: entry.from,
      to: entry.to,
      atomic: true,
      projectionCoverage: alignment.coverage ?? (alignment.exact ? 1 : 0)
    };
  }

  let boundary = { previous: -1, next: -1 };
  if (node?.nodeType === Node.TEXT_NODE) {
    boundary = findDomBoundaryForTextPoint(domProjection.entries, node, offset);
  } else if (node?.nodeType === Node.ELEMENT_NODE) {
    boundary = findDomBoundaryForElementPoint(domProjection.entries, node, offset);
  }
  const resolved = resolveSourceBoundary(boundary, alignment, sourceProjection.entries, affinity);
  if (!resolved) return null;
  return {
    position: resolved.position,
    from: resolved.entry.from,
    to: resolved.entry.to,
    atomic: resolved.entry.atomic,
    projectionCoverage: alignment.coverage ?? (alignment.exact ? 1 : 0)
  };
}

export function getSelectionMappingDiagnostics(root, source, absoluteStart = 0) {
  const sourceProjection = createMarkdownSourceProjection(source, absoluteStart);
  const domProjection = createPreviewDomProjection(root);
  const alignment = alignProjectionTexts(sourceProjection.text, domProjection.text);
  return {
    sourceText: sourceProjection.text,
    domText: domProjection.text,
    exact: alignment.exact,
    coverage: alignment.coverage ?? (alignment.exact ? 1 : 0)
  };
}

export const selectionMappingApi = Object.freeze({
  createMarkdownSourceProjection,
  createPreviewDomProjection,
  createPreviewRangesForSourceSelection,
  mapPreviewDomPointToSource,
  getSelectionMappingDiagnostics
});
