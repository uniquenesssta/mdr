
function getNodeChildren(node) {
  const children = [];
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
  return children;
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

export function normalizeReferenceLabel(value) {
  return String(value || '')
    .replace(/^\[|\]$/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function parseReferenceDefinitionSource(source) {
  const match = String(source || '').match(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/);
  if (!match) return null;
  const label = normalizeReferenceLabel(match[1]);
  const url = String(match[2] || match[3] || '').trim();
  if (!label || !url) return null;
  return { label, url };
}

export function collectReferenceDefinitions({ view, tree, visibleLines }) {
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

export function applyReferenceDefinitionPresentation({
  view,
  referenceData,
  editableRanges,
  blockRanges,
  visibleLineStarts,
  intersectsRevealRanges,
  overlapsRanges,
  addLineClass,
  lineClasses,
  replaceUncovered,
  Decoration
}) {
  for (const definition of referenceData.ranges) {
    if (intersectsRevealRanges(editableRanges, definition.from, definition.to)
      || overlapsRanges(blockRanges, definition.from, definition.to)) continue;
    const line = view.state.doc.lineAt(definition.from);
    if (!visibleLineStarts.has(line.from)) continue;
    addLineClass(lineClasses, line.from, 'cm-hybrid-reference-definition-line');
    replaceUncovered(definition.from, definition.to, Decoration.replace({ inclusive: false }));
  }
}

export function applyLinkPresentation({
  view,
  node,
  replace,
  addMark,
  referenceDefinitions,
  Decoration
}) {
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

export function applyFallbackLinkToken({
  token,
  raw,
  tokenFrom,
  tokenTo,
  addMark,
  replaceUncovered,
  Decoration,
  processTokens
}) {
  if (token?.type !== 'link') return false;
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
      return true;
    }
  }
  if (raw.startsWith('<') && raw.endsWith('>') && raw.length > 2) {
    addMark(tokenFrom + 1, tokenTo - 1, 'cm-hybrid-link', attributes);
    replaceUncovered(tokenFrom, tokenFrom + 1, Decoration.replace({ inclusive: false }));
    replaceUncovered(tokenTo - 1, tokenTo, Decoration.replace({ inclusive: false }));
    return true;
  }
  addMark(tokenFrom, tokenTo, 'cm-hybrid-link', attributes);
  return true;
}

export function applyFallbackReferenceLinks({
  line,
  referenceDefinitions,
  addMark,
  replaceUncovered,
  Decoration
}) {
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
