import { getExpandedVisibleRanges, intersectsRanges } from './ranges.js';
import { parseTableRow } from './table-model.js';
import { collectMathBlocks } from './math-ranges.js';

function childNodes(node) {
  const children = [];
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
  return children;
}

function getChild(node, name) {
  return childNodes(node).find(child => child.name === name) || null;
}

function stripWrappedValue(value) {
  const text = String(value || '').trim();
  if ((text.startsWith('<') && text.endsWith('>'))
    || (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function parseStandaloneImage(view, paragraphNode) {
  const children = childNodes(paragraphNode);
  if (children.length !== 1 || children[0].name !== 'Image') return null;
  const imageNode = children[0];
  const source = view.state.doc.sliceString(imageNode.from, imageNode.to);
  const urlNode = getChild(imageNode, 'URL');
  if (!urlNode) return null;
  const titleNode = getChild(imageNode, 'LinkTitle');
  const url = stripWrappedValue(view.state.doc.sliceString(urlNode.from, urlNode.to));
  if (!url || /^(?:javascript|vbscript):/i.test(url)) return null;
  const altMatch = source.match(/^!\[([\s\S]*?)\]/);
  return {
    type: 'image',
    from: paragraphNode.from,
    to: paragraphNode.to,
    source: url,
    urlFrom: urlNode.from,
    urlTo: urlNode.to,
    alt: altMatch?.[1]?.replace(/\\([\[\]])/g, '$1') || '',
    title: titleNode ? stripWrappedValue(view.state.doc.sliceString(titleNode.from, titleNode.to)) : ''
  };
}

function createHtmlDescriptor(view, from, to, discovery = 'syntax') {
  const source = view.state.doc.sliceString(from, to);
  if (!source.trim()) return null;
  return {
    type: 'html',
    from,
    to,
    source,
    fingerprint: source,
    contentFrom: from,
    contentTo: to,
    discovery
  };
}

function parseHtmlBlock(view, node) {
  return createHtmlDescriptor(view, node.from, node.to, 'syntax');
}

const HTML_VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

const HTML_RAW_TEXT_TAGS = new Set(['pre', 'script', 'style', 'textarea']);

function rangeContainsPosition(range, position) {
  return Number(range?.from) <= position && position < Number(range?.to);
}

function overlapsAnyRange(ranges, from, to) {
  return Array.from(ranges || []).some(range => Number(range?.from) < to && from < Number(range?.to));
}

function parseHtmlBlockStart(lineText) {
  const source = String(lineText || '');
  const prefix = source.match(/^ {0,3}(<!--|<\?|<!\[CDATA\[|<![A-Z]|<([A-Za-z][\w-]*)\b[^>]*>)/);
  if (!prefix) return null;
  const token = prefix[1];
  if (token === '<!--') return { kind: 'comment', terminator: '-->' };
  if (token === '<?') return { kind: 'processing', terminator: '?>' };
  if (token === '<![CDATA[') return { kind: 'cdata', terminator: ']]>' };
  if (/^<![A-Z]/.test(token)) return { kind: 'declaration', terminator: '>' };
  const name = String(prefix[2] || '').toLowerCase();
  if (!name) return null;
  return {
    kind: 'tag',
    name,
    selfClosing: HTML_VOID_TAGS.has(name) || /\/\s*>\s*$/.test(token)
  };
}

function countRootTagBalance(text, tagName) {
  const pattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  let depth = 0;
  let sawOpening = false;
  let match;
  while ((match = pattern.exec(String(text || '')))) {
    const token = match[0];
    if (/^<\//.test(token)) depth -= 1;
    else if (!/\/\s*>$/.test(token) && !HTML_VOID_TAGS.has(tagName)) {
      depth += 1;
      sawOpening = true;
    }
  }
  return { depth, sawOpening };
}

function findFallbackHtmlEnd(view, startLine, parsedStart, scanLimit = 120000) {
  const document = view.state.doc;
  const firstText = startLine.text;
  if (parsedStart.kind !== 'tag') {
    if (firstText.includes(parsedStart.terminator)) return startLine.to;
    let lineNumber = startLine.number + 1;
    const maximumPosition = Math.min(document.length, startLine.from + scanLimit);
    while (lineNumber <= document.lines) {
      const line = document.line(lineNumber);
      if (line.from > maximumPosition) return null;
      if (line.text.includes(parsedStart.terminator)) return line.to;
      lineNumber += 1;
    }
    return null;
  }

  if (parsedStart.selfClosing) return startLine.to;
  const tagName = parsedStart.name;
  let balance = countRootTagBalance(firstText, tagName);
  if (balance.sawOpening && balance.depth <= 0) return startLine.to;

  let lineNumber = startLine.number + 1;
  const maximumPosition = Math.min(document.length, startLine.from + scanLimit);
  while (lineNumber <= document.lines) {
    const line = document.line(lineNumber);
    if (line.from > maximumPosition) return null;
    const current = countRootTagBalance(line.text, tagName);
    if (current.sawOpening || current.depth < 0) {
      balance = {
        sawOpening: balance.sawOpening || current.sawOpening,
        depth: balance.depth + current.depth
      };
      if (balance.sawOpening && balance.depth <= 0) return line.to;
    }
    // Raw-text elements require their explicit closing tag. Other CommonMark HTML
    // blocks may legally end at the first blank line when no closing tag exists.
    if (!HTML_RAW_TEXT_TAGS.has(tagName) && !line.text.trim()) {
      return document.line(Math.max(startLine.number, line.number - 1)).to;
    }
    lineNumber += 1;
  }
  return null;
}

function collectFallbackHtmlBlocks(view, expandedRanges, existingBlocks, activeSourceRanges) {
  const blocks = [];
  const occupied = existingBlocks.map(block => ({ from: block.from, to: block.to }));
  const seenLineStarts = new Set();
  for (const visible of expandedRanges) {
    let line = view.state.doc.lineAt(visible.from);
    while (line.from <= visible.to) {
      if (!seenLineStarts.has(line.from)) {
        seenLineStarts.add(line.from);
        const alreadyCovered = occupied.some(range => rangeContainsPosition(range, line.from));
        if (!alreadyCovered && !activeSourceRanges.some(range => rangeContainsPosition(range, line.from))) {
          const start = parseHtmlBlockStart(line.text);
          if (start) {
            const to = findFallbackHtmlEnd(view, line, start);
            if (Number.isInteger(to)
              && to > line.from
              && !overlapsAnyRange(occupied, line.from, to)
              && !overlapsAnyRange(activeSourceRanges, line.from, to)) {
              const descriptor = createHtmlDescriptor(view, line.from, to, 'fallback');
              if (descriptor) {
                blocks.push(descriptor);
                occupied.push({ from: descriptor.from, to: descriptor.to });
              }
            }
          }
        }
      }
      if (line.number >= view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }
  return blocks;
}

function parseTable(view, node) {
  const source = view.state.doc.sliceString(node.from, node.to);
  const lines = source.split('\n');
  if (lines.length < 2) return null;

  const lineOffsets = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(node.from + offset);
    offset += line.length + 1;
  }

  const headerRow = parseTableRow(lines[0], lineOffsets[0]);
  const delimiterRow = parseTableRow(lines[1], lineOffsets[1]);
  const headerCells = headerRow.cells;
  const delimiterCells = delimiterRow.cells;
  if (!headerCells.length || delimiterCells.length !== headerCells.length) return null;

  const alignments = delimiterCells.map(cell => {
    const value = cell.raw.replace(/\s/g, '');
    if (!/^:?-{3,}:?$/.test(value)) return null;
    if (value.startsWith(':') && value.endsWith(':')) return 'center';
    if (value.endsWith(':')) return 'right';
    return 'left';
  });
  if (alignments.some(value => !value)) return null;

  const rowCells = [];
  for (let index = 2; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    rowCells.push(parseTableRow(lines[index], lineOffsets[index]).cells);
  }

  return {
    type: 'table',
    from: node.from,
    to: node.to,
    headers: headerCells.map(cell => cell.value),
    headerCells,
    alignments,
    rows: rowCells.map(cells => cells.map(cell => cell.value)),
    rowCells,
    fingerprint: source,
    contentFrom: node.from + Math.min(source.length, Math.max(0, lines[0].search(/\S|$/)))
  };
}

function parseCodeBlock(view, node) {
  const source = view.state.doc.sliceString(node.from, node.to);
  if (node.name === 'IndentedCode' || node.name === 'CodeBlock') {
    const blockFrom = view.state.doc.lineAt(node.from).from;
    const blockSource = view.state.doc.sliceString(blockFrom, node.to);
    return {
      type: 'code',
      from: blockFrom,
      to: node.to,
      language: '',
      code: blockSource.split('\n').map(line => line.replace(/^(?: {4}|\t)/, '')).join('\n'),
      contentFrom: blockFrom,
      contentTo: node.to,
      writebackMode: 'indented',
      fingerprint: blockSource
    };
  }
  const infoNode = getChild(node, 'CodeInfo');
  const codeNode = getChild(node, 'CodeText');
  const firstLineEnd = source.indexOf('\n');
  const lastLineStart = source.lastIndexOf('\n');
  const openingLine = firstLineEnd >= 0 ? source.slice(0, firstLineEnd) : source;
  const fenceMatch = openingLine.match(/^\s{0,3}(`{3,}|~{3,})([\s\S]*)$/);
  const contentFrom = codeNode?.from
    ?? (firstLineEnd >= 0 ? node.from + firstLineEnd + 1 : node.to);
  const contentTo = codeNode?.to
    ?? (lastLineStart > firstLineEnd ? node.from + lastLineStart : contentFrom);
  const infoRaw = infoNode
    ? view.state.doc.sliceString(infoNode.from, infoNode.to)
    : String(fenceMatch?.[2] || '').trim();
  const language = infoRaw.trim().split(/\s+/)[0] || '';
  return {
    type: language.toLowerCase() === 'mermaid' ? 'mermaid' : 'code',
    from: node.from,
    to: node.to,
    language,
    code: view.state.doc.sliceString(contentFrom, contentTo),
    contentFrom,
    contentTo,
    writebackMode: 'fenced',
    fenceCharacter: fenceMatch?.[1]?.[0] || '`',
    fenceLength: fenceMatch?.[1]?.length || 3,
    infoRaw,
    fingerprint: source
  };
}

const BLOCK_DEFINITIONS = [
  {
    names: new Set(['FencedCode', 'IndentedCode', 'CodeBlock']),
    create: parseCodeBlock
  },
  {
    names: new Set(['Table']),
    create: parseTable
  },
  {
    names: new Set(['HTMLBlock']),
    create: parseHtmlBlock
  },
  {
    names: new Set(['Paragraph']),
    create: parseStandaloneImage
  }
];

export function collectHybridBlocks(view, tree, activeSourceRanges = []) {
  const blocks = [];
  const seen = new Set();
  const expandedRanges = getExpandedVisibleRanges(view);
  for (const visible of expandedRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(nodeRef) {
        const definition = BLOCK_DEFINITIONS.find(item => item.names.has(nodeRef.name));
        if (!definition) return;
        const node = nodeRef.node;
        if (!node || intersectsRanges(activeSourceRanges, node.from, node.to)) return false;
        const key = `${node.name}:${node.from}:${node.to}`;
        if (seen.has(key)) return false;
        const descriptor = definition.create(view, node);
        if (descriptor) {
          seen.add(key);
          blocks.push(descriptor);
          return false;
        }
      }
    });
  }
  blocks.push(...collectFallbackHtmlBlocks(view, expandedRanges, blocks, activeSourceRanges));
  blocks.push(...collectMathBlocks(view, activeSourceRanges, blocks));
  return blocks.sort((left, right) => left.from - right.from || left.to - right.to);
}
