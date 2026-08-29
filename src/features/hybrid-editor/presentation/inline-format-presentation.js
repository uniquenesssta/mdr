
const INLINE_CLASSES = new Map([
  ['StrongEmphasis', 'cm-hybrid-strong'],
  ['Emphasis', 'cm-hybrid-emphasis'],
  ['Strikethrough', 'cm-hybrid-strikethrough'],
  ['InlineCode', 'cm-hybrid-inline-code'],
  ['Image', 'cm-hybrid-image']
]);

function locateInlineTokenRaw(source, raw, cursor = 0) {
  const value = String(source || '');
  const tokenRaw = String(raw || '');
  if (!tokenRaw) return Math.max(0, Math.min(value.length, cursor));
  let index = value.indexOf(tokenRaw, Math.max(0, cursor));
  if (index < 0) index = value.indexOf(tokenRaw);
  return index < 0 ? Math.max(0, Math.min(value.length, cursor)) : index;
}

export function applyInlineTreeNode({
  name,
  from,
  to,
  parentName,
  addSemanticMark,
  replace,
  Decoration
}) {
  const inlineClass = INLINE_CLASSES.get(name);
  if (inlineClass) addSemanticMark(from, to, inlineClass);

  const shouldHide = name === 'EmphasisMark'
    || name === 'StrikethroughMark'
    || name === 'LinkMark'
    || (name === 'HeaderMark' && (parentName === 'SetextHeading1' || parentName === 'SetextHeading2'))
    || (name === 'CodeMark' && parentName === 'InlineCode')
    || (name === 'URL' && parentName === 'Image');
  if (shouldHide) replace(from, to, Decoration.replace({ inclusive: false }));
}

export function applyFallbackInlinePresentation({
  view,
  line,
  replaceUncovered,
  blockRanges,
  editableRanges,
  addMark,
  referenceDefinitions,
  overlapsRanges,
  intersectsRevealRanges,
  lexInline,
  Decoration,
  applyFallbackLinkToken,
  applyFallbackReferenceLinks
}) {
  if (!line?.text
    || overlapsRanges(blockRanges, line.from, Math.max(line.from + 1, line.to))
    || intersectsRevealRanges(editableRanges, line.from, line.to)) return;

  let tokens = [];
  try {
    tokens = lexInline(line.text) || [];
  } catch (_) {
    return;
  }
  if (!tokens.length) return;

  const processTokens = (items, parentSource, absoluteFrom) => {
    const source = String(parentSource || '');
    let cursor = 0;
    for (const token of Array.from(items || [])) {
      const raw = String(token?.raw ?? token?.text ?? '');
      if (!raw) continue;
      const localFrom = locateInlineTokenRaw(source, raw, cursor);
      const tokenFrom = absoluteFrom + localFrom;
      const tokenTo = tokenFrom + raw.length;
      cursor = Math.max(cursor, localFrom + raw.length);

      if (token.type === 'strong') {
        const delimiter = raw.startsWith('**') && raw.endsWith('**')
          ? '**'
          : raw.startsWith('__') && raw.endsWith('__')
            ? '__'
            : '';
        if (delimiter && raw.length >= delimiter.length * 2) {
          const contentFrom = tokenFrom + delimiter.length;
          const contentTo = tokenTo - delimiter.length;
          addMark(tokenFrom, tokenTo, 'cm-hybrid-strong');
          replaceUncovered(tokenFrom, contentFrom, Decoration.replace({ inclusive: false }));
          replaceUncovered(contentTo, tokenTo, Decoration.replace({ inclusive: false }));
          if (Array.isArray(token.tokens)) {
            processTokens(token.tokens, raw.slice(delimiter.length, -delimiter.length), contentFrom);
          }
          continue;
        }
      }

      if (token.type === 'em') {
        const delimiter = raw.startsWith('*') && raw.endsWith('*')
          ? '*'
          : raw.startsWith('_') && raw.endsWith('_')
            ? '_'
            : '';
        if (delimiter && raw.length >= 2) {
          const contentFrom = tokenFrom + 1;
          const contentTo = tokenTo - 1;
          addMark(tokenFrom, tokenTo, 'cm-hybrid-emphasis');
          replaceUncovered(tokenFrom, contentFrom, Decoration.replace({ inclusive: false }));
          replaceUncovered(contentTo, tokenTo, Decoration.replace({ inclusive: false }));
          if (Array.isArray(token.tokens)) processTokens(token.tokens, raw.slice(1, -1), contentFrom);
          continue;
        }
      }

      if (token.type === 'del' && raw.startsWith('~~') && raw.endsWith('~~') && raw.length >= 4) {
        const contentFrom = tokenFrom + 2;
        const contentTo = tokenTo - 2;
        addMark(tokenFrom, tokenTo, 'cm-hybrid-strikethrough');
        replaceUncovered(tokenFrom, contentFrom, Decoration.replace({ inclusive: false }));
        replaceUncovered(contentTo, tokenTo, Decoration.replace({ inclusive: false }));
        if (Array.isArray(token.tokens)) processTokens(token.tokens, raw.slice(2, -2), contentFrom);
        continue;
      }

      if (token.type === 'escape' && raw.startsWith('\\') && raw.length >= 2) {
        replaceUncovered(tokenFrom, tokenFrom + 1, Decoration.replace({ inclusive: false }));
        continue;
      }

      if (token.type === 'codespan') {
        const opening = raw.match(/^`+/)?.[0] || '';
        const closing = opening && raw.endsWith(opening) ? opening : '';
        if (opening && closing && raw.length >= opening.length + closing.length) {
          const contentFrom = tokenFrom + opening.length;
          const contentTo = tokenTo - closing.length;
          addMark(tokenFrom, tokenTo, 'cm-hybrid-inline-code');
          replaceUncovered(tokenFrom, contentFrom, Decoration.replace({ inclusive: false }));
          replaceUncovered(contentTo, tokenTo, Decoration.replace({ inclusive: false }));
          continue;
        }
      }

      if (applyFallbackLinkToken({
        token,
        raw,
        tokenFrom,
        tokenTo,
        addMark,
        replaceUncovered,
        Decoration,
        processTokens
      })) continue;

      if (Array.isArray(token.tokens) && token.tokens.length) {
        processTokens(token.tokens, raw, tokenFrom);
      }
    }
  };

  processTokens(tokens, line.text, line.from);
  applyFallbackReferenceLinks({
    line,
    referenceDefinitions,
    addMark,
    replaceUncovered,
    Decoration
  });
}

export function addExactHybridSelectionPresentation({ view, ranges, blockRanges, overlapsRanges, Decoration }) {
  for (const selection of view.state.selection.ranges) {
    const from = Math.min(selection.anchor, selection.head);
    const to = Math.max(selection.anchor, selection.head);
    if (to <= from) continue;
    let line = view.state.doc.lineAt(from);
    while (line.from < to) {
      const rangeFrom = Math.max(from, line.from);
      const rangeTo = Math.min(to, line.to);
      if (rangeTo > rangeFrom && !overlapsRanges(blockRanges, rangeFrom, rangeTo)) {
        ranges.push(Decoration.mark({ class: 'cm-hybrid-selection-exact' }).range(rangeFrom, rangeTo));
      }
      if (line.number >= view.state.doc.lines || line.to >= to) break;
      line = view.state.doc.line(line.number + 1);
    }
  }
}
