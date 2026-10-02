import { isSafeDocumentUrl } from '../../../shared/security/document-html.js';

// Text is data, never raw HTML or caller-supplied Markdown syntax.
function escapeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]{}()#+.!|~-]/g, '\\$&');
}
function destination(value, image = false) {
  if (!isSafeDocumentUrl(value, image)) return '';
  return value.trim().replace(/[\s<>()[\]"']/g, char => encodeURIComponent(char).replace(/[()']/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()));
}
function ticks(text, minimum) {
  return '`'.repeat(Math.max(minimum, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
}
function render(node) {
  if (node.nodeType === 3) return escapeText(node.textContent);
  if (node.nodeType === 11) return children(node);
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  // Only understood formatting is projected; scripts, embeds and unknown elements emit nothing.
  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return '#'.repeat(Number(tag[1])) + ' ' + children(node).trim() + '\n\n';
    case 'p': case 'div': case 'section': case 'article': case 'main': case 'figure':
    case 'details': case 'summary': case 'dl': case 'dt': case 'dd':
      return children(node).trim() + '\n\n';
    case 'br': return '  \n';
    case 'strong': case 'b': return '**' + children(node) + '**';
    case 'em': case 'i': return '*' + children(node) + '*';
    case 'del': case 's': return '~~' + children(node) + '~~';
    case 'a': {
      const label = children(node);
      const url = destination(node.getAttribute('href') || '');
      return url ? '[' + label + '](' + url + ')' : label;
    }
    case 'img': {
      const label = escapeText(node.getAttribute('alt') || '');
      const url = destination(node.getAttribute('src') || '', true);
      return url ? '![' + label + '](' + url + ')' : label;
    }
    case 'code': {
      const text = node.textContent.replace(/\r\n?/g, '\n').replace(/\n/g, ' ');
      if (!text) return '';
      const fence = ticks(text, 1);
      const pad = /^[` ]|[` ]$/.test(text) ? ' ' : '';
      return fence + pad + text + pad + fence;
    }
    case 'pre': {
      const code = node.querySelector('code');
      const text = (code || node).textContent.replace(/\r\n?/g, '\n');
      const language = code?.className?.match(/(?:^|\s)language-([a-z0-9_-]+)(?:\s|$)/i)?.[1] || '';
      const fence = ticks(text, 3);
      return fence + language + '\n' + text + (text.endsWith('\n') ? '' : '\n') + fence + '\n\n';
    }
    case 'ul': case 'ol': {
      const start = Number.parseInt(node.getAttribute('start'), 10);
      return [...node.children].filter(child => child.tagName.toLowerCase() === 'li').map((item, index) => {
        const marker = tag === 'ul' ? '- ' : String((Number.isSafeInteger(start) ? start : 1) + index) + '. ';
        return marker + children(item).trim().replace(/\n/g, '\n' + ' '.repeat(marker.length));
      }).join('\n') + '\n\n';
    }
    case 'blockquote': return children(node).trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    case 'hr': return '---\n\n';
    case 'table': return table(node);
    case 'span': case 'li': case 'td': case 'th': case 'caption': case 'time':
    case 'abbr': case 'cite': case 'q': case 'small': case 'mark': case 'u':
    case 'sub': case 'sup': case 'kbd': case 'samp': case 'var': case 'ins': case 'button':
      return children(node);
    default: return '';
  }
}
function children(node) {
  return [...node.childNodes].map(child => {
    const output = render(child);
    // A nested list needs its own indented line after the parent item's text.
    return node.tagName?.toLowerCase() === 'li' && ['UL', 'OL'].includes(child.tagName) ? '\n' + output : output;
  }).join('');
}
function table(node) {
  const rows = [...node.querySelectorAll('tr')].filter(row => row.closest('table') === node)
    .map(row => [...row.children].filter(cell => ['TD', 'TH'].includes(cell.tagName))
      .map(cell => children(cell).trim().replace(/\n+/g, ' ').replace(/(?<!\\)\|/g, '\\|'))).filter(row => row.length);
  if (!rows.length) return '';
  const width = Math.max(...rows.map(row => row.length));
  const line = row => '| ' + Array.from({ length: width }, (_, i) => row[i] || '').join(' | ') + ' |';
  return [line(rows[0]), '|' + Array(width).fill('---').join('|') + '|', ...rows.slice(1).map(line)].join('\n') + '\n\n';
}

/** Convert a detached DOM node into Markdown; no DOM insertion, fetching or mutable state. */
export function htmlToMarkdown(node) {
  if (!node || ![1, 3, 11].includes(node.nodeType)) throw new TypeError('HTML conversion requires a DOM node.');
  // Do not collapse newlines globally: they may be intentional inside fenced code.
  return render(node).trim();
}

/** Metadata and body form one Markdown document; metadata remains literal text. */
export function convertExtractedHtml({ content, meta = {} } = {}) {
  let body = htmlToMarkdown(content);
  const title = escapeText(meta.title).trim();
  const heading = '# ' + title;
  if (title && (body.toLowerCase() === heading.toLowerCase() || body.toLowerCase().startsWith(heading.toLowerCase() + '\n'))) {
    body = body.slice(heading.length).trimStart();
  }
  const metadata = [];
  if (meta.author) metadata.push('作者：' + escapeText(meta.author).trim());
  if (meta.published) metadata.push('发布时间：' + escapeText(meta.published).trim());
  return [title ? heading : '', metadata.length ? '> ' + metadata.join(' | ') : '', body].filter(Boolean).join('\n\n');
}
