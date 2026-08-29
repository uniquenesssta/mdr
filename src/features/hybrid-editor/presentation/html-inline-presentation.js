
const INLINE_HTML_CLASSES = new Map([
  ['strong', 'cm-hybrid-strong'],
  ['b', 'cm-hybrid-strong'],
  ['em', 'cm-hybrid-emphasis'],
  ['i', 'cm-hybrid-emphasis'],
  ['del', 'cm-hybrid-strikethrough'],
  ['s', 'cm-hybrid-strikethrough'],
  ['strike', 'cm-hybrid-strikethrough'],
  ['code', 'cm-hybrid-inline-code'],
  ['mark', 'cm-hybrid-html-mark'],
  ['sub', 'cm-hybrid-html-sub'],
  ['sup', 'cm-hybrid-html-sup'],
  ['kbd', 'cm-hybrid-html-kbd'],
  ['u', 'cm-hybrid-html-underline'],
  ['small', 'cm-hybrid-html-small'],
  ['span', ''],
  ['abbr', ''],
  ['cite', ''],
  ['dfn', ''],
  ['ins', ''],
  ['q', ''],
  ['samp', 'cm-hybrid-inline-code'],
  ['time', ''],
  ['var', 'cm-hybrid-emphasis']
]);

export function parseInlineColorStyles(tag) {
  const attribute = String(tag || '').match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!attribute) return null;
  const styles = {};
  String(attribute[1] || attribute[2] || attribute[3] || '').split(';').forEach(declaration => {
    const separator = declaration.indexOf(':');
    if (separator < 0) return;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(value)) return;
    if (property === 'color') styles.color = value;
    if (property === 'background' || property === 'background-color') styles.backgroundColor = value;
  });
  return styles.color || styles.backgroundColor ? styles : null;
}

export function parseInlineHtmlTag(value) {
  const source = String(value || '');
  const match = source.match(/^<\s*(\/)?\s*([a-z][\w-]*)([\s\S]*?)>$/i);
  if (!match) return null;
  const name = match[2].toLowerCase();
  if (!INLINE_HTML_CLASSES.has(name) && name !== 'a') return null;
  const closing = Boolean(match[1]);
  const selfClosing = /\/\s*>$/.test(source);
  let url = '';
  if (!closing && name === 'a') {
    const href = source.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    url = String(href?.[1] || href?.[2] || href?.[3] || '').trim();
  }
  return { name, closing, selfClosing, url };
}

function collectInlineColorSpans(view) {
  const spans = [];
  const seen = new Set();
  const documentLength = view.state.doc.length;
  for (const visible of view.visibleRanges) {
    const firstLine = view.state.doc.lineAt(visible.from);
    const lastLine = view.state.doc.lineAt(visible.to);
    const from = Math.max(0, firstLine.from - 512);
    const to = Math.min(documentLength, lastLine.to + 512);
    const source = view.state.doc.sliceString(from, to);
    const stack = [];
    const tagPattern = /<span\b[^>]*>|<\/span>/gi;
    let match;
    while ((match = tagPattern.exec(source))) {
      const absoluteFrom = from + match.index;
      const absoluteTo = absoluteFrom + match[0].length;
      if (/^<\/span/i.test(match[0])) {
        const opening = stack.pop();
        if (!opening?.styles) continue;
        const key = `${opening.from}:${absoluteFrom}`;
        if (seen.has(key)) continue;
        seen.add(key);
        spans.push({
          openFrom: opening.from,
          openTo: opening.to,
          contentFrom: opening.to,
          contentTo: absoluteFrom,
          closeFrom: absoluteFrom,
          closeTo: absoluteTo,
          styles: opening.styles
        });
      } else {
        stack.push({ from: absoluteFrom, to: absoluteTo, styles: parseInlineColorStyles(match[0]) });
      }
    }
  }
  return spans;
}

function collectInlineCodeRanges(source, absoluteFrom) {
  const ranges = [];
  let opening = null;
  const pattern = /`+/g;
  let match;
  while ((match = pattern.exec(source))) {
    const length = match[0].length;
    if (!opening) {
      opening = { from: absoluteFrom + match.index, length };
      continue;
    }
    if (opening.length !== length) continue;
    ranges.push({ from: opening.from, to: absoluteFrom + match.index + length });
    opening = null;
  }
  return ranges;
}

function collectInlineHtmlSpans({ view, tree, blockRanges, overlapsRanges }) {
  const tags = [];
  const seen = new Set();
  for (const visible of view.visibleRanges) {
    const first = view.state.doc.lineAt(visible.from);
    const last = view.state.doc.lineAt(visible.to);
    tree.iterate({
      from: first.from,
      to: last.to,
      enter(nodeRef) {
        if (nodeRef.name !== 'HTMLTag') return;
        const key = `${nodeRef.from}:${nodeRef.to}`;
        if (seen.has(key) || overlapsRanges(blockRanges, nodeRef.from, nodeRef.to)) return;
        const parsed = parseInlineHtmlTag(view.state.doc.sliceString(nodeRef.from, nodeRef.to));
        if (!parsed || parsed.selfClosing) return;
        seen.add(key);
        tags.push({ from: nodeRef.from, to: nodeRef.to, ...parsed });
      }
    });
  }

  for (const visible of view.visibleRanges) {
    const first = view.state.doc.lineAt(visible.from);
    const last = view.state.doc.lineAt(visible.to);
    const from = first.from;
    const to = last.to;
    const source = view.state.doc.sliceString(from, to);
    const inlineCodeRanges = collectInlineCodeRanges(source, from);
    const tagPattern = /<\/?[A-Za-z][^<>]*?>/g;
    let match;
    while ((match = tagPattern.exec(source))) {
      const absoluteFrom = from + match.index;
      const absoluteTo = absoluteFrom + match[0].length;
      const key = `${absoluteFrom}:${absoluteTo}`;
      if (seen.has(key)
        || overlapsRanges(blockRanges, absoluteFrom, absoluteTo)
        || overlapsRanges(inlineCodeRanges, absoluteFrom, absoluteTo)
        || (match.index > 0 && source[match.index - 1] === '\\')) continue;
      const parsed = parseInlineHtmlTag(match[0]);
      if (!parsed || parsed.selfClosing) continue;
      seen.add(key);
      tags.push({ from: absoluteFrom, to: absoluteTo, ...parsed });
    }
  }

  tags.sort((left, right) => left.from - right.from || left.to - right.to);
  const stacks = new Map();
  const spans = [];
  for (const tag of tags) {
    const stack = stacks.get(tag.name) || [];
    if (!tag.closing) {
      stack.push(tag);
      stacks.set(tag.name, stack);
      continue;
    }
    const opening = stack.pop();
    if (!opening || tag.from < opening.to) continue;
    spans.push({
      name: tag.name,
      openFrom: opening.from,
      openTo: opening.to,
      contentFrom: opening.to,
      contentTo: tag.from,
      closeFrom: tag.from,
      closeTo: tag.to,
      url: opening.url
    });
  }
  return spans;
}

export function applyHtmlInlinePresentation({
  view,
  tree,
  blockRanges,
  editableRanges,
  ranges,
  replacements,
  addSemanticMark,
  replace,
  overlapsRanges,
  intersectsRevealRanges,
  Decoration
}) {
  const replaceInlineColorTag = (from, to) => {
    const selected = view.hasFocus !== false && view.state.selection.ranges.some(selection => {
      const selectionFrom = Math.min(selection.anchor, selection.head);
      const selectionTo = Math.max(selection.anchor, selection.head);
      return selectionFrom === selectionTo && selectionFrom > from && selectionFrom < to;
    });
    if (to <= from || selected || overlapsRanges(blockRanges, from, to) || overlapsRanges(replacements, from, to)) return false;
    replacements.push({ from, to });
    ranges.push(Decoration.replace({ inclusive: false }).range(from, to));
    return true;
  };

  for (const span of collectInlineColorSpans(view)) {
    if (overlapsRanges(blockRanges, span.openFrom, span.closeTo)) continue;
    const style = [
      span.styles.color ? `color:${span.styles.color}` : '',
      span.styles.backgroundColor ? `background-color:${span.styles.backgroundColor}` : ''
    ].filter(Boolean).join(';');
    if (style && span.contentTo > span.contentFrom) {
      ranges.push(Decoration.mark({ class: 'cm-hybrid-inline-color', attributes: { style } }).range(span.contentFrom, span.contentTo));
    }
    replaceInlineColorTag(span.openFrom, span.openTo);
    replaceInlineColorTag(span.closeFrom, span.closeTo);
  }

  for (const span of collectInlineHtmlSpans({ view, tree, blockRanges, overlapsRanges })) {
    if (intersectsRevealRanges(editableRanges, span.openFrom, span.closeTo)) continue;
    const className = span.name === 'a' ? 'cm-hybrid-link' : INLINE_HTML_CLASSES.get(span.name);
    if (span.contentTo > span.contentFrom && className) {
      const attributes = span.name === 'a' && /^(?:https?:|mailto:|tel:)/i.test(span.url)
        ? {
            'data-hybrid-link-url': span.url,
            title: `${span.url}（点击预览；Ctrl/⌘ + 点击在浏览器打开）`,
            role: 'link'
          }
        : undefined;
      addSemanticMark(span.contentFrom, span.contentTo, className, attributes);
    }
    replace(span.openFrom, span.openTo, Decoration.replace({ inclusive: false }));
    replace(span.closeFrom, span.closeTo, Decoration.replace({ inclusive: false }));
  }
}
