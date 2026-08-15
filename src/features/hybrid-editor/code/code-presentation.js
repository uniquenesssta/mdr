/**
 * Atomic 8.8 code row DOM projection shared by Hybrid and Preview presentation.
 * Allowed imports: sibling pure code highlighter only. Forbidden imports: CodeMirror, model-kernel and application state.
 * API: renderHighlightedCodeRows(). State: none. Side effects: replaces children of the supplied container. Lifecycle: pure view build.
 */
import { getNormalizedCodeLanguage, highlightCode } from './code-highlighter.js';

function appendToken(documentRef, parent, token, extraTokenClass = '') {
  if (!token.className) {
    parent.appendChild(documentRef.createTextNode(token.text));
    return;
  }
  const span = documentRef.createElement('span');
  span.className = [
    'markdown-code-token',
    `markdown-code-token-${token.className}`,
    extraTokenClass ? `${extraTokenClass} ${extraTokenClass}-${token.className}` : ''
  ].filter(Boolean).join(' ');
  span.textContent = token.text;
  parent.appendChild(span);
}

export function renderHighlightedCodeRows(container, code, language, options = {}) {
  if (!container?.ownerDocument) throw new Error('代码高亮容器不可用');
  const documentRef = container.ownerDocument;
  const source = String(code ?? '');
  const sourceLines = source.split('\n');
  const highlightedLines = highlightCode(source, language);
  const variant = options.variant === 'preview' ? 'preview' : 'hybrid';
  const includeSourceNewlines = Boolean(options.includeSourceNewlines);
  const fragment = documentRef.createDocumentFragment();
  let sourceOffset = 0;

  highlightedLines.forEach((line, lineIndex) => {
    const row = documentRef.createElement(variant === 'preview' ? 'span' : 'div');
    row.className = `markdown-code-row ${variant === 'preview' ? 'preview-code-row' : 'cm-hybrid-code-row'}`;
    row.dataset.lineNumber = String(line.number);
    row.dataset.codeOffsetStart = String(sourceOffset);

    if (variant === 'hybrid') {
      const lineNumber = documentRef.createElement('span');
      lineNumber.className = 'markdown-code-line-number cm-hybrid-code-line-number';
      lineNumber.textContent = String(line.number);
      lineNumber.setAttribute('aria-hidden', 'true');
      row.appendChild(lineNumber);
    }

    const lineContent = documentRef.createElement(variant === 'preview' ? 'span' : 'code');
    lineContent.className = `markdown-code-line ${variant === 'preview' ? 'preview-code-line' : 'cm-hybrid-code-line'}`;
    if (variant === 'hybrid' && !line.tokens.length) {
      lineContent.appendChild(documentRef.createTextNode('\u200b'));
    } else {
      for (const token of line.tokens) {
        appendToken(documentRef, lineContent, token, variant === 'hybrid' ? 'cm-hybrid-token' : '');
      }
    }
    row.appendChild(lineContent);
    fragment.appendChild(row);

    sourceOffset += sourceLines[lineIndex]?.length || 0;
    if (includeSourceNewlines && lineIndex < highlightedLines.length - 1) {
      const sourceNewline = documentRef.createElement('span');
      sourceNewline.className = 'markdown-code-source-newline preview-code-source-newline';
      sourceNewline.textContent = '\n';
      fragment.appendChild(sourceNewline);
      sourceOffset += 1;
    }
  });

  container.replaceChildren(fragment);
  return {
    normalizedLanguage: getNormalizedCodeLanguage(language),
    lineCount: highlightedLines.length
  };
}
