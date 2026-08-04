import { getExpandedVisibleRanges, intersectsRanges, overlapsRanges } from './ranges.js';

function isEscaped(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function lineEntriesInRange(doc, from, to) {
  const entries = [];
  if (!doc.length) return entries;
  let line = doc.lineAt(Math.max(0, Math.min(doc.length, from)));
  while (line.from <= to) {
    entries.push(line);
    if (line.number >= doc.lines) break;
    line = doc.line(line.number + 1);
  }
  return entries;
}

function matchDisplayOpening(lineText) {
  const indent = lineText.match(/^[ \t]{0,3}/)?.[0]?.length || 0;
  const rest = lineText.slice(indent);
  if (rest.startsWith('$$')) return { open: '$$', close: '$$', indent, contentOffset: indent + 2 };
  if (rest.startsWith('\\[')) return { open: '\\[', close: '\\]', indent, contentOffset: indent + 2 };
  return null;
}

function findSameLineClose(text, opening) {
  const start = opening.contentOffset;
  let cursor = start;
  while (cursor <= text.length - opening.close.length) {
    const found = text.indexOf(opening.close, cursor);
    if (found < 0) return -1;
    if (!isEscaped(text, found) && !text.slice(found + opening.close.length).trim()) return found;
    cursor = found + opening.close.length;
  }
  return -1;
}

function findMultilineClose(lines, startIndex, closeDelimiter) {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const text = lines[index].text;
    const trimmedEnd = text.trimEnd();
    if (!trimmedEnd.endsWith(closeDelimiter)) continue;
    const closeFrom = trimmedEnd.length - closeDelimiter.length;
    if (isEscaped(text, closeFrom)) continue;
    return { lineIndex: index, closeFrom };
  }
  return null;
}

export function collectMathBlocks(view, activeSourceRanges = [], existingBlocks = []) {
  const blocks = [];
  const seen = new Set();
  const occupied = existingBlocks.map(block => ({ from: block.from, to: block.to }));
  const doc = view.state.doc;

  for (const visible of getExpandedVisibleRanges(view)) {
    const lines = lineEntriesInRange(doc, visible.from, visible.to);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const opening = matchDisplayOpening(line.text);
      if (!opening) continue;

      const sameLineClose = findSameLineClose(line.text, opening);
      let blockTo = line.to;
      let contentFrom = line.from + opening.contentOffset;
      let contentTo = sameLineClose >= 0 ? line.from + sameLineClose : contentFrom;
      let endLineIndex = index;

      if (sameLineClose < 0) {
        const closing = findMultilineClose(lines, index, opening.close);
        if (!closing) continue;
        const closingLine = lines[closing.lineIndex];
        endLineIndex = closing.lineIndex;
        blockTo = closingLine.to;
        contentFrom = line.to < doc.length ? line.to + 1 : line.to;
        contentTo = closingLine.from + closing.closeFrom;
      }

      const key = `${line.from}:${blockTo}`;
      if (seen.has(key)
        || intersectsRanges(activeSourceRanges, line.from, blockTo)
        || overlapsRanges(occupied, line.from, blockTo)) {
        index = Math.max(index, endLineIndex);
        continue;
      }

      seen.add(key);
      const source = doc.sliceString(line.from, blockTo);
      blocks.push({
        type: 'math',
        from: line.from,
        to: blockTo,
        contentFrom,
        contentTo,
        formula: doc.sliceString(contentFrom, contentTo).trim(),
        displayMode: true,
        delimiter: opening.open,
        fingerprint: source
      });
      occupied.push({ from: line.from, to: blockTo });
      occupied.sort((left, right) => left.from - right.from || left.to - right.to);
      index = Math.max(index, endLineIndex);
    }
  }

  return blocks;
}

function isCodeSyntaxContext(tree, position) {
  let node = tree.resolveInner(position, 1);
  while (node) {
    if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'IndentedCode' || node.name === 'CodeText') {
      return true;
    }
    node = node.parent;
  }
  return false;
}

function collectBackslashInlineMath(line, lineFrom, output) {
  let cursor = 0;
  while (cursor < line.length - 3) {
    const start = line.indexOf('\\(', cursor);
    if (start < 0) break;
    if (isEscaped(line, start)) {
      cursor = start + 2;
      continue;
    }
    let close = line.indexOf('\\)', start + 2);
    while (close >= 0 && isEscaped(line, close)) close = line.indexOf('\\)', close + 2);
    if (close < 0) break;
    output.push({
      from: lineFrom + start,
      to: lineFrom + close + 2,
      contentFrom: lineFrom + start + 2,
      contentTo: lineFrom + close,
      formula: line.slice(start + 2, close),
      delimiter: '\\('
    });
    cursor = close + 2;
  }
}

function collectDollarInlineMath(line, lineFrom, output) {
  let cursor = 0;
  while (cursor < line.length - 2) {
    const start = line.indexOf('$', cursor);
    if (start < 0) break;
    if (isEscaped(line, start) || line[start + 1] === '$' || /\s/.test(line[start + 1] || '')) {
      cursor = start + 1;
      continue;
    }

    let close = start + 1;
    while (close < line.length) {
      close = line.indexOf('$', close);
      if (close < 0) break;
      if (!isEscaped(line, close) && line[close + 1] !== '$' && !/\s/.test(line[close - 1] || '')) break;
      close += 1;
    }
    if (close < 0) break;

    output.push({
      from: lineFrom + start,
      to: lineFrom + close + 1,
      contentFrom: lineFrom + start + 1,
      contentTo: lineFrom + close,
      formula: line.slice(start + 1, close),
      delimiter: '$'
    });
    cursor = close + 1;
  }
}

export function collectInlineMathRanges(view, tree, activeSourceRanges = [], blockRanges = []) {
  const candidates = [];
  const seenLines = new Set();
  for (const visible of view.visibleRanges) {
    let line = view.state.doc.lineAt(visible.from);
    while (line.from <= visible.to) {
      if (!seenLines.has(line.from)) {
        seenLines.add(line.from);
        if (!overlapsRanges(blockRanges, line.from, Math.max(line.from + 1, line.to))) {
          collectBackslashInlineMath(line.text, line.from, candidates);
          collectDollarInlineMath(line.text, line.from, candidates);
        }
      }
      if (line.number >= view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }

  return candidates
    .filter(candidate => candidate.to > candidate.from
      && !intersectsRanges(activeSourceRanges, candidate.from, candidate.to)
      && !overlapsRanges(blockRanges, candidate.from, candidate.to)
      && !isCodeSyntaxContext(tree, candidate.from))
    .sort((left, right) => left.from - right.from || left.to - right.to)
    .filter((candidate, index, all) => index === 0 || candidate.from >= all[index - 1].to);
}
