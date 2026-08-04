import { Decoration } from '@codemirror/view';
import { marked } from 'marked';
import { HybridPrefixWidget, HorizontalRuleWidget, InlineMathWidget } from './widgets.js';
import { collectInlineMathRanges } from './math-ranges.js';
import {
  collectVisibleLines,
  intersectsRanges,
  intersectsRevealRanges,
  overlapsRanges,
  shouldDecorateSourceActiveLine
} from './ranges.js';

const HEADING_FONT_SCALES = new Map([
  [1, '190%'], [2, '155%'], [3, '130%'], [4, '114%'], [5, '104%'], [6, '100%']
]);

const INLINE_CLASSES = new Map([
  ['StrongEmphasis', 'cm-hybrid-strong'],
  ['Emphasis', 'cm-hybrid-emphasis'],
  ['Strikethrough', 'cm-hybrid-strikethrough'],
  ['InlineCode', 'cm-hybrid-inline-code'],
  ['Image', 'cm-hybrid-image']
]);

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


function isFullyInsideRevealRange(ranges, from, to) {
  return Array.from(ranges || []).some(range => Boolean(range?.revealBlock)
    && Number(range.from) <= from
    && to <= Number(range.to));
}

function addLineClass(lineClasses, lineFrom, className) {
  const classes = lineClasses.get(lineFrom) || new Set();
  classes.add(className);
  lineClasses.set(lineFrom, classes);
}

function addLineStyle(lineStyles, lineFrom, property, value) {
  const styles = lineStyles.get(lineFrom) || new Map();
  styles.set(property, value);
  lineStyles.set(lineFrom, styles);
}

function addHeadingLinePresentation(lineClasses, lineStyles, lineFrom, level) {
  addLineClass(lineClasses, lineFrom, `cm-hybrid-heading cm-hybrid-heading-${level}`);
  addLineStyle(lineStyles, lineFrom, 'font-size', HEADING_FONT_SCALES.get(level) || '100%');
}

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

function addQuoteLinePresentation(view, line, quote, lineClasses, lineStyles, replace) {
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

function addBlockLineClasses(view, lineClasses, editableRanges, blockRanges, from, to, className) {
  let line = view.state.doc.lineAt(Math.max(0, Math.min(view.state.doc.length, from)));
  while (line.from <= to) {
    if (!intersectsRevealRanges(editableRanges, line.from, line.to)
      && !overlapsRanges(blockRanges, line.from, Math.max(line.from + 1, line.to))) {
      addLineClass(lineClasses, line.from, className);
    }
    if (line.number >= view.state.doc.lines) break;
    line = view.state.doc.line(line.number + 1);
  }
}

function parseInlineColorStyles(tag) {
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

function parseInlineHtmlTag(value) {
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

function collectInlineHtmlSpans(view, tree, blockRanges) {
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

  // CodeMirror may expose a temporarily incomplete syntax tree immediately after
  // loading or jumping through a document. Scan the visible source as a bounded
  // fallback so supported inline HTML does not remain raw until another update.
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

function locateInlineTokenRaw(source, raw, cursor = 0) {
  const value = String(source || '');
  const tokenRaw = String(raw || '');
  if (!tokenRaw) return Math.max(0, Math.min(value.length, cursor));
  let index = value.indexOf(tokenRaw, Math.max(0, cursor));
  if (index < 0) index = value.indexOf(tokenRaw);
  return index < 0 ? Math.max(0, Math.min(value.length, cursor)) : index;
}

function findLinkLabelEnd(raw) {
  const source = String(raw || '');
  if (!source.startsWith('[')) return -1;
  let depth = 0;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '[') depth += 1;
    else if (character === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function normalizeReferenceLabel(value) {
  return String(value || '')
    .replace(/^\[|\]$/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function parseReferenceDefinitionSource(source) {
  const match = String(source || '').match(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/);
  if (!match) return null;
  const label = normalizeReferenceLabel(match[1]);
  const url = String(match[2] || match[3] || '').trim();
  if (!label || !url) return null;
  return { label, url };
}

function collectReferenceDefinitions(view, tree, visibleLines) {
  const definitions = new Map();
  const ranges = [];
  const seenRanges = new Set();
  const add = (from, to, label, url) => {
    const normalized = normalizeReferenceLabel(label);
    const href = String(url || '').trim();
    if (!normalized || !href) return;
    if (!definitions.has(normalized)) definitions.set(normalized, href);
    const key = `${from}:${to}`;
    if (!seenRanges.has(key)) {
      seenRanges.add(key);
      ranges.push({ from, to });
    }
  };

  for (const visible of view.visibleRanges) {
    const first = view.state.doc.lineAt(visible.from);
    const last = view.state.doc.lineAt(visible.to);
    tree.iterate({
      from: first.from,
      to: last.to,
      enter(nodeRef) {
        if (nodeRef.name !== 'LinkReference') return;
        const children = getNodeChildren(nodeRef.node);
        const labelNode = children.find(child => child.name === 'LinkLabel');
        const urlNode = children.find(child => child.name === 'URL');
        if (!labelNode || !urlNode) return;
        add(
          nodeRef.from,
          nodeRef.to,
          view.state.doc.sliceString(labelNode.from, labelNode.to),
          view.state.doc.sliceString(urlNode.from, urlNode.to)
        );
      }
    });
  }

  // A partially parsed document can expose a reference link before its
  // definition enters the Lezer tree. For ordinary documents, scan lines only
  // when the current viewport actually contains bracket syntax. The iterator
  // avoids materializing another full document string, while very large files
  // stay on the incremental syntax-tree path.
  const needsReferenceLookup = Array.from(visibleLines || []).some(line => line.text.includes('['));
  if (needsReferenceLookup && view.state.doc.length <= 250000) {
    for (let number = 1; number <= view.state.doc.lines; number += 1) {
      const line = view.state.doc.line(number);
      const parsed = parseReferenceDefinitionSource(line.text);
      if (parsed) add(line.from, line.to, parsed.label, parsed.url);
    }
  }

  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  return { definitions, ranges };
}

function addFallbackInlinePresentation(view, line, replace, replaceUncovered, blockRanges, editableRanges, addMark, referenceDefinitions) {
  if (!line?.text
    || overlapsRanges(blockRanges, line.from, Math.max(line.from + 1, line.to))
    || intersectsRevealRanges(editableRanges, line.from, line.to)) return;

  let tokens = [];
  try {
    tokens = marked.Lexer.lexInline(line.text) || [];
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
        // Marked exposes Markdown punctuation escapes as a dedicated token. In
        // hybrid presentation the escaped character remains visible while only
        // the source backslash is hidden, matching the full preview renderer.
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

      if (token.type === 'link') {
        const href = String(token.href || '').trim();
        const attributes = /^(?:https?:|mailto:|tel:)/i.test(href)
          ? {
              'data-hybrid-link-url': href,
              title: `${href}（点击预览；Ctrl/⌘ + 点击在浏览器打开）`,
              role: 'link'
            }
          : undefined;
        if (raw.startsWith('[')) {
          const labelEnd = findLinkLabelEnd(raw);
          if (labelEnd > 0) {
            const labelFrom = tokenFrom + 1;
            const labelTo = tokenFrom + labelEnd;
            addMark(labelFrom, labelTo, 'cm-hybrid-link', attributes);
            replaceUncovered(tokenFrom, labelFrom, Decoration.replace({ inclusive: false }));
            replaceUncovered(labelTo, tokenTo, Decoration.replace({ inclusive: false }));
            if (Array.isArray(token.tokens)) processTokens(token.tokens, raw.slice(1, labelEnd), labelFrom);
            continue;
          }
        }
        if (raw.startsWith('<') && raw.endsWith('>') && raw.length > 2) {
          addMark(tokenFrom + 1, tokenTo - 1, 'cm-hybrid-link', attributes);
          replaceUncovered(tokenFrom, tokenFrom + 1, Decoration.replace({ inclusive: false }));
          replaceUncovered(tokenTo - 1, tokenTo, Decoration.replace({ inclusive: false }));
          continue;
        }
        addMark(tokenFrom, tokenTo, 'cm-hybrid-link', attributes);
        continue;
      }

      if (Array.isArray(token.tokens) && token.tokens.length) {
        processTokens(token.tokens, raw, tokenFrom);
      }
    }
  };

  processTokens(tokens, line.text, line.from);

  // Marked's standalone inline lexer intentionally does not resolve reference
  // definitions without the surrounding document link table. Preserve the
  // rendered label for explicit reference links even while the background
  // Lezer tree is incomplete; the normal syntax-tree path still supplies the
  // URL when it is available.
  const referencePattern = /(^|[^!\\])\[([^\]\n]+)\]\[([^\]\n]*)\]/g;
  let referenceMatch;
  while ((referenceMatch = referencePattern.exec(line.text))) {
    const prefixLength = referenceMatch[1]?.length || 0;
    const tokenLocalFrom = referenceMatch.index + prefixLength;
    const tokenFrom = line.from + tokenLocalFrom;
    const labelFrom = tokenFrom + 1;
    const labelTo = labelFrom + referenceMatch[2].length;
    const tokenTo = tokenFrom + referenceMatch[0].length - prefixLength;
    const referenceKey = normalizeReferenceLabel(referenceMatch[3] || referenceMatch[2]);
    const referenceUrl = referenceDefinitions?.get(referenceKey) || '';
    const referenceAttributes = /^(?:https?:|mailto:|tel:)/i.test(referenceUrl)
      ? {
          'data-hybrid-link-url': referenceUrl,
          title: `${referenceUrl}（点击预览；Ctrl/⌘ + 点击在浏览器打开）`,
          role: 'link'
        }
      : undefined;
    addMark(labelFrom, labelTo, 'cm-hybrid-link', referenceAttributes);
    replaceUncovered(tokenFrom, labelFrom, Decoration.replace({ inclusive: false }));
    replaceUncovered(labelTo, tokenTo, Decoration.replace({ inclusive: false }));
  }
}

function addExactHybridSelectionPresentation(view, ranges, blockRanges) {
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

function getNodeChildren(node) {
  const children = [];
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
  return children;
}

function addLinkPresentation(view, node, replace, addMark, referenceDefinitions) {
  const children = getNodeChildren(node);
  const urlNode = children.find(child => child.name === 'URL');
  const referenceNode = children.find(child => child.name === 'LinkLabel');
  const marks = children.filter(child => child.name === 'LinkMark');
  if (marks.length < 2) return false;
  const labelFrom = marks[0].to;
  const labelTo = marks[1].from;
  const visibleLabel = view.state.doc.sliceString(labelFrom, labelTo);
  const referenceLabel = referenceNode
    ? view.state.doc.sliceString(referenceNode.from, referenceNode.to)
    : visibleLabel;
  const url = urlNode
    ? view.state.doc.sliceString(urlNode.from, urlNode.to).trim()
    : referenceDefinitions?.get(normalizeReferenceLabel(referenceLabel)) || '';
  if (!/^(?:https?:|mailto:|tel:)/i.test(url)) return false;
  if (labelTo > labelFrom) {
    addMark(labelFrom, labelTo, 'cm-hybrid-link', {
      'data-hybrid-link-url': url,
      title: `${url}（点击预览；Ctrl/⌘ + 点击在浏览器打开）`,
      role: 'link'
    });
  }
  for (const child of children) {
    if (child.name === 'LinkMark' || child.name === 'URL' || child.name === 'LinkTitle' || child.name === 'LinkLabel') {
      replace(child.from, child.to, Decoration.replace({ inclusive: false }));
    }
  }
  return true;
}

export function buildInlinePresentation(view, tree, editableRanges, blockRanges, activeSourceRanges = []) {
  const ranges = [];
  const replacements = [];
  const lineClasses = new Map();
  const lineStyles = new Map();
  const visibleLines = collectVisibleLines(view);
  const referenceData = collectReferenceDefinitions(view, tree, visibleLines);
  const visibleLineStarts = new Set(visibleLines.map(line => line.from));
  const semanticMarkKeys = new Set();
  const addSemanticMark = (from, to, className, attributes) => {
    if (to <= from || !className || overlapsRanges(blockRanges, from, to)) return false;
    const attributeKey = attributes ? JSON.stringify(attributes) : '';
    const key = `${from}:${to}:${className}:${attributeKey}`;
    if (semanticMarkKeys.has(key)) return false;
    semanticMarkKeys.add(key);
    ranges.push(Decoration.mark({ class: className, attributes }).range(from, to));
    return true;
  };

  const replace = (from, to, decoration) => {
    if (to <= from
      || intersectsRanges(editableRanges, from, to)
      || overlapsRanges(blockRanges, from, to)
      || overlapsRanges(replacements, from, to)) return false;
    replacements.push({ from, to });
    ranges.push(decoration.range(from, to));
    return true;
  };

  const replaceUncovered = (from, to, decoration) => {
    if (to <= from) return false;
    const covered = replacements
      .filter(range => range.from < to && from < range.to)
      .sort((left, right) => left.from - right.from || left.to - right.to);
    let cursor = from;
    let changed = false;
    for (const range of covered) {
      if (range.from > cursor) changed = replace(cursor, Math.min(to, range.from), decoration) || changed;
      cursor = Math.max(cursor, range.to);
      if (cursor >= to) break;
    }
    if (cursor < to) changed = replace(cursor, to, decoration) || changed;
    return changed;
  };

  const replaceProtectedWidget = (from, to, decoration) => {
    if (to <= from
      || intersectsRanges(activeSourceRanges, from, to)
      || overlapsRanges(blockRanges, from, to)
      || overlapsRanges(replacements, from, to)) return false;
    replacements.push({ from, to });
    ranges.push(decoration.range(from, to));
    return true;
  };

  const replaceInlineColorTag = (from, to) => {
    const selected = view.hasFocus !== false && view.state.selection.ranges.some(selection => {
      const selectionFrom = Math.min(selection.anchor, selection.head);
      const selectionTo = Math.max(selection.anchor, selection.head);
      // Drag selections keep the rendered HTML presentation. Only a collapsed
      // caret placed inside the tag reveals it for direct source editing.
      return selectionFrom === selectionTo && selectionFrom > from && selectionFrom < to;
    });
    if (to <= from || selected || overlapsRanges(blockRanges, from, to) || overlapsRanges(replacements, from, to)) return false;
    replacements.push({ from, to });
    ranges.push(Decoration.replace({ inclusive: false }).range(from, to));
    return true;
  };

  for (const math of collectInlineMathRanges(view, tree, activeSourceRanges, blockRanges)) {
    replaceProtectedWidget(
      math.from,
      math.to,
      Decoration.replace({
        widget: new InlineMathWidget(math),
        inclusive: false
      })
    );
  }

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

  for (const span of collectInlineHtmlSpans(view, tree, blockRanges)) {
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

  for (const definition of referenceData.ranges) {
    if (intersectsRevealRanges(editableRanges, definition.from, definition.to)
      || overlapsRanges(blockRanges, definition.from, definition.to)) continue;
    const line = view.state.doc.lineAt(definition.from);
    if (!visibleLineStarts.has(line.from)) continue;
    addLineClass(lineClasses, line.from, 'cm-hybrid-reference-definition-line');
    replaceUncovered(definition.from, definition.to, Decoration.replace({ inclusive: false }));
  }

  for (const line of visibleLines) {
    const text = line.text;
    if (overlapsRanges(blockRanges, line.from, Math.max(line.from + 1, line.to))) continue;
    if (shouldDecorateSourceActiveLine(editableRanges, blockRanges, line.from, line.to)) {
      addLineClass(lineClasses, line.from, 'cm-hybrid-source-active');
      continue;
    }

    const quote = parseQuotePrefix(text);
    const contentOffset = quote?.contentFrom || 0;
    const content = quote?.content ?? text;
    if (quote) addQuoteLinePresentation(view, line, quote, lineClasses, lineStyles, replace);

    const heading = content.match(/^(\s{0,3})(#{1,6})[\t ]+/);
    if (heading) {
      const level = heading[2].length;
      addHeadingLinePresentation(lineClasses, lineStyles, line.from, level);
      replace(
        line.from + contentOffset + heading[1].length,
        line.from + contentOffset + heading[0].length,
        Decoration.replace({ inclusive: false })
      );
    }

    const task = content.match(/^(\s*)([-+*])[\t ]+\[([ xX])\][\t ]+/);
    if (task) {
      addLineClass(lineClasses, line.from, 'cm-hybrid-list-line cm-hybrid-task-line');
      const markerFrom = line.from + contentOffset + task[0].indexOf('[') + 1;
      replace(
        line.from + contentOffset + task[1].length,
        line.from + contentOffset + task[0].length,
        Decoration.replace({
          widget: new HybridPrefixWidget('task', {
            checked: task[3].toLowerCase() === 'x',
            markerFrom
          })
        })
      );
      continue;
    }

    const unordered = content.match(/^(\s*)([-+*])[\t ]+/);
    if (unordered && !heading) {
      addLineClass(lineClasses, line.from, 'cm-hybrid-list-line');
      replace(
        line.from + contentOffset + unordered[1].length,
        line.from + contentOffset + unordered[0].length,
        Decoration.replace({ widget: new HybridPrefixWidget('bullet', { label: '•' }) })
      );
    }

    const ordered = content.match(/^(\s*)(\d+[.)])[\t ]+/);
    if (ordered) {
      addLineClass(lineClasses, line.from, 'cm-hybrid-list-line');
      replace(
        line.from + contentOffset + ordered[1].length,
        line.from + contentOffset + ordered[0].length,
        Decoration.replace({ widget: new HybridPrefixWidget('ordered', { label: ordered[2] }) })
      );
    }

    if (/^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(content)) {
      addLineClass(lineClasses, line.from, 'cm-hybrid-rule-line');
      replace(
        line.from + contentOffset,
        line.to,
        Decoration.replace({ widget: new HorizontalRuleWidget() })
      );
    }
  }

  for (const visible of view.visibleRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(nodeRef) {
        const { name, from, to } = nodeRef;
        if (overlapsRanges(blockRanges, from, to)) return false;
        // Do not skip an ancestor merely because it contains the active source block.
        // Otherwise one caret inside a list item prevents inline rendering for the
        // entire list. Only nodes wholly contained by the revealed block are skipped.
        if (isFullyInsideRevealRange(editableRanges, from, to)) return false;

        if (name === 'Link' && addLinkPresentation(view, nodeRef.node, replace, addSemanticMark, referenceData.definitions)) return false;

        const inlineClass = INLINE_CLASSES.get(name);
        if (inlineClass) addSemanticMark(from, to, inlineClass);

        if (name === 'SetextHeading1' || name === 'SetextHeading2') {
          const level = name === 'SetextHeading1' ? 1 : 2;
          const titleLine = view.state.doc.lineAt(from);
          addHeadingLinePresentation(lineClasses, lineStyles, titleLine.from, level);
          if (titleLine.number < view.state.doc.lines) {
            const markerLine = view.state.doc.line(titleLine.number + 1);
            addLineClass(lineClasses, markerLine.from, 'cm-hybrid-setext-marker-line');
          }
        }

        if (name === 'Blockquote') {
          addBlockLineClasses(view, lineClasses, editableRanges, blockRanges, from, to, 'cm-hybrid-blockquote');
        }

        const parentName = nodeRef.node?.parent?.name || '';
        const shouldHide = name === 'EmphasisMark'
          || name === 'StrikethroughMark'
          || name === 'LinkMark'
          || (name === 'HeaderMark' && (parentName === 'SetextHeading1' || parentName === 'SetextHeading2'))
          || (name === 'CodeMark' && parentName === 'InlineCode')
          || (name === 'URL' && parentName === 'Image');
        if (shouldHide) replace(from, to, Decoration.replace({ inclusive: false }));
      }
    });
  }

  // Lezer parses large documents incrementally. When the visible region is
  // ahead of the completed syntax tree, preserve the same inline presentation
  // with a bounded Marked scan instead of leaving raw **, links, or code marks.
  for (const line of visibleLines) {
    addFallbackInlinePresentation(view, line, replace, replaceUncovered, blockRanges, editableRanges, addSemanticMark, referenceData.definitions);
  }

  // CodeMirror's native multi-line selection paints the virtual newline to the
  // full content width. In hybrid mode that looks like a large rectangular
  // block and makes a tiny downward drag appear to select half of the next row.
  // Draw only the actual character intervals and keep Markdown markers hidden.
  addExactHybridSelectionPresentation(view, ranges, blockRanges);

  for (const range of editableRanges) {
    if (!range.revealBlock) continue;
    let line = view.state.doc.lineAt(Math.min(view.state.doc.length, range.from));
    while (line.from <= range.to) {
      if (shouldDecorateSourceActiveLine(editableRanges, blockRanges, line.from, line.to)) {
        addLineClass(lineClasses, line.from, 'cm-hybrid-source-active');
      }
      if (line.number >= view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }

  let headingLines = 0;
  let sourceActiveLines = 0;
  for (const [lineFrom, classes] of lineClasses) {
    if ([...classes].some(className => className.includes('cm-hybrid-heading'))) headingLines += 1;
    if (classes.has('cm-hybrid-source-active')) sourceActiveLines += 1;
    const styles = lineStyles.get(lineFrom);
    const attributes = { class: [...classes].join(' ') };
    if (styles?.size && !classes.has('cm-hybrid-source-active')) {
      attributes.style = [...styles].map(([property, value]) => `${property}:${value}`).join(';');
    }
    ranges.push(Decoration.line({ attributes }).range(lineFrom));
  }

  return {
    ranges,
    stats: {
      visibleLines: visibleLines.length,
      decoratedLines: lineClasses.size,
      headingLines,
      sourceActiveLines,
      hiddenMarkers: replacements.length
    }
  };
}
