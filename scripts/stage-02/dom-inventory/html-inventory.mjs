import { createHash } from 'node:crypto';

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

function createLineLocator(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return offset => {
    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (starts[middle] <= offset) low = middle + 1;
      else high = middle - 1;
    }
    return high + 1;
  };
}

function readTagToken(source, start) {
  let quote = null;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return { text: source.slice(start, index + 1), end: index + 1 };
  }
  throw new Error(`Unterminated HTML tag at offset ${start}.`);
}

function tokenizeHtml(source) {
  const tokens = [];
  for (let index = 0; index < source.length;) {
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      if (end < 0) throw new Error(`Unterminated HTML comment at offset ${index}.`);
      index = end + 3;
      continue;
    }
    if (source[index] !== '<') {
      index += 1;
      continue;
    }
    const token = readTagToken(source, index);
    const trimmed = token.text.trim();
    if (/^<!/i.test(trimmed) || /^<\?/i.test(trimmed)) {
      index = token.end;
      continue;
    }
    tokens.push({ ...token, start: index });
    index = token.end;
  }
  return tokens;
}

function parseAttributes(source) {
  const attributes = {};
  let index = 0;
  while (index < source.length) {
    while (/\s/.test(source[index] || '')) index += 1;
    if (index >= source.length) break;
    const nameStart = index;
    while (index < source.length && !/[\s=]/.test(source[index])) index += 1;
    const name = source.slice(nameStart, index).trim();
    if (!name) break;
    while (/\s/.test(source[index] || '')) index += 1;
    let value = '';
    if (source[index] === '=') {
      index += 1;
      while (/\s/.test(source[index] || '')) index += 1;
      const quote = source[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < source.length && source[index] !== quote) index += 1;
        value = source.slice(valueStart, index);
        if (source[index] === quote) index += 1;
      } else {
        const valueStart = index;
        while (index < source.length && !/\s/.test(source[index])) index += 1;
        value = source.slice(valueStart, index);
      }
    }
    attributes[name] = value;
  }
  return Object.fromEntries(Object.entries(attributes).sort(([left], [right]) => left.localeCompare(right)));
}

function parseTag(token) {
  const body = token.text.slice(1, -1).trim();
  const closing = body.startsWith('/');
  const normalized = closing ? body.slice(1).trim() : body;
  const selfClosing = !closing && normalized.endsWith('/');
  const content = selfClosing ? normalized.slice(0, -1).trim() : normalized;
  const nameMatch = /^([^\s/>]+)/.exec(content);
  if (!nameMatch) throw new Error(`Invalid HTML tag token: ${token.text.slice(0, 120)}`);
  const tag = nameMatch[1].toLowerCase();
  const attributeSource = content.slice(nameMatch[0].length).trim();
  return {
    tag,
    closing,
    selfClosing: selfClosing || VOID_TAGS.has(tag),
    attributes: closing ? {} : parseAttributes(attributeSource)
  };
}

function collectNodeFacts(attributes) {
  const classes = String(attributes.class || '').split(/\s+/).filter(Boolean);
  const aria = {};
  const dataAttributes = {};
  const inlineEvents = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'role' || name.startsWith('aria-')) aria[name] = value;
    if (name.startsWith('data-')) dataAttributes[name] = value;
    if (/^on[a-z]+$/i.test(name)) inlineEvents[name] = value;
  }
  return {
    id: attributes.id || null,
    classes,
    aria,
    dataAttributes,
    inlineEvents,
    inlineStyle: attributes.style || null
  };
}

export function buildHtmlInventory(source, path = 'index.html') {
  if (typeof source !== 'string') throw new TypeError('HTML source must be a string.');
  const lineAt = createLineLocator(source);
  const nodes = [];
  const stack = [];
  const childCounts = new Map();

  for (const token of tokenizeHtml(source)) {
    const parsed = parseTag(token);
    if (parsed.closing) {
      let match = -1;
      for (let position = stack.length - 1; position >= 0; position -= 1) {
        if (nodes[stack[position]].tag === parsed.tag) {
          match = position;
          break;
        }
      }
      if (match < 0) throw new Error(`Unexpected closing tag </${parsed.tag}> at line ${lineAt(token.start)}.`);
      nodes[stack[match]].endLine = lineAt(token.start);
      stack.splice(match);
      continue;
    }

    const parentIndex = stack.at(-1) ?? null;
    const parentPath = parentIndex === null ? null : nodes[parentIndex].path;
    const siblingKey = parentPath || '__root__';
    if (!childCounts.has(siblingKey)) childCounts.set(siblingKey, new Map());
    const tagCounts = childCounts.get(siblingKey);
    const ordinal = (tagCounts.get(parsed.tag) || 0) + 1;
    tagCounts.set(parsed.tag, ordinal);
    const nodePath = parentPath ? `${parentPath}/${parsed.tag}[${ordinal}]` : `/${parsed.tag}[${ordinal}]`;
    const facts = collectNodeFacts(parsed.attributes);
    const node = {
      index: nodes.length,
      path: nodePath,
      parentPath,
      depth: stack.length,
      tag: parsed.tag,
      startLine: lineAt(token.start),
      endLine: parsed.selfClosing ? lineAt(token.start) : null,
      selfClosing: parsed.selfClosing,
      ...facts,
      attributes: parsed.attributes
    };
    nodes.push(node);
    if (!parsed.selfClosing) stack.push(node.index);
  }

  if (stack.length > 0) {
    const open = stack.map(index => `${nodes[index].tag}@${nodes[index].startLine}`).join(', ');
    throw new Error(`Unclosed HTML tags: ${open}`);
  }

  const ids = [...new Set(nodes.map(node => node.id).filter(Boolean))].sort();
  const classes = [...new Set(nodes.flatMap(node => node.classes))].sort();
  const inlineEvents = nodes.flatMap(node => Object.entries(node.inlineEvents).map(([attribute, handler]) => ({
    path: node.path,
    line: node.startLine,
    tag: node.tag,
    id: node.id,
    attribute,
    handler
  })));

  return {
    source: {
      path,
      sha256: createHash('sha256').update(source).digest('hex'),
      lineCount: source.split(/\r?\n/).length
    },
    summary: {
      elementCount: nodes.length,
      idCount: ids.length,
      classCount: classes.length,
      inlineEventCount: inlineEvents.length,
      inlineStyleCount: nodes.filter(node => node.inlineStyle).length,
      ariaNodeCount: nodes.filter(node => Object.keys(node.aria).length > 0).length,
      dataAttributeNodeCount: nodes.filter(node => Object.keys(node.dataAttributes).length > 0).length,
      scriptCount: nodes.filter(node => node.tag === 'script').length,
      stylesheetLinkCount: nodes.filter(node => node.tag === 'link' && node.attributes.rel === 'stylesheet').length
    },
    nodes,
    ids,
    classes,
    inlineEvents,
    scripts: nodes.filter(node => node.tag === 'script').map(node => ({
      path: node.path,
      line: node.startLine,
      src: node.attributes.src || null,
      type: node.attributes.type || null,
      defer: Object.hasOwn(node.attributes, 'defer')
    }))
  };
}
