
export function parseQuotePrefix(text) {
  const source = String(text || '');
  const leading = source.match(/^\s{0,3}/)?.[0].length || 0;
  let cursor = leading;
  let depth = 0;

  while (source[cursor] === '>') {
    depth += 1;
    cursor += 1;
    if (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;

    let nestedMarker = cursor;
    let indentation = 0;
    while (indentation < 3 && source[nestedMarker] === ' ') {
      nestedMarker += 1;
      indentation += 1;
    }
    if (source[nestedMarker] !== '>') break;
    cursor = nestedMarker;
  }

  if (!depth) return null;
  return {
    depth,
    markerFrom: leading,
    markerTo: cursor,
    contentFrom: cursor,
    content: source.slice(cursor)
  };
}

export function applyQuoteLinePresentation({
  view,
  line,
  quote,
  lineClasses,
  lineStyles,
  replace,
  Decoration,
  addLineClass,
  addLineStyle
}) {
  addLineClass(lineClasses, line.from, 'cm-hybrid-blockquote');
  addLineClass(lineClasses, line.from, `cm-hybrid-blockquote-depth-${Math.min(quote.depth, 6)}`);
  addLineStyle(lineStyles, line.from, '--hybrid-quote-depth', String(quote.depth));
  addLineStyle(lineStyles, line.from, '--hybrid-quote-indent', `${quote.depth * 28}px`);

  const previousDepth = line.number > 1
    ? parseQuotePrefix(view.state.doc.line(line.number - 1).text)?.depth || 0
    : 0;
  const nextDepth = line.number < view.state.doc.lines
    ? parseQuotePrefix(view.state.doc.line(line.number + 1).text)?.depth || 0
    : 0;
  if (previousDepth === 0) addLineClass(lineClasses, line.from, 'cm-hybrid-blockquote-root-start');
  if (nextDepth === 0) addLineClass(lineClasses, line.from, 'cm-hybrid-blockquote-root-end');

  replace(
    line.from + quote.markerFrom,
    line.from + quote.markerTo,
    Decoration.replace({ inclusive: false })
  );
}

export function applyBlockquoteTreeNode({
  view,
  name,
  from,
  to,
  lineClasses,
  editableRanges,
  blockRanges,
  intersectsRevealRanges,
  overlapsRanges,
  addLineClass
}) {
  if (name !== 'Blockquote') return false;
  let line = view.state.doc.lineAt(Math.max(0, Math.min(view.state.doc.length, from)));
  while (line.from <= to) {
    if (!intersectsRevealRanges(editableRanges, line.from, line.to)
      && !overlapsRanges(blockRanges, line.from, Math.max(line.from + 1, line.to))) {
      addLineClass(lineClasses, line.from, 'cm-hybrid-blockquote');
    }
    if (line.number >= view.state.doc.lines) break;
    line = view.state.doc.line(line.number + 1);
  }
  return true;
}
