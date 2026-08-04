import { highlightCode, getNormalizedCodeLanguage } from '../editor/hybrid/code-highlighter.js';
import { renderHighlightedCodeRows } from '../editor/hybrid/code-presentation.js';
import { createMathPresentationApi } from './math-presentation.js';
import { createMermaidPresentationApi } from './mermaid-presentation.js';

export function createMarkdownPresentationApi() {
  const code = Object.freeze({
    highlightCode,
    getNormalizedCodeLanguage,
    renderHighlightedCodeRows
  });
  return Object.freeze({
    code,
    math: createMathPresentationApi(),
    mermaid: createMermaidPresentationApi()
  });
}
