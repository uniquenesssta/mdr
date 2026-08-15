import { marked } from 'marked';
import {
  getNormalizedCodeLanguage,
  highlightCode,
  renderHighlightedCodeRows
} from '../../../hybrid-editor/index.js';
import { createMathPresentationApi } from './math-presentation.js';
import { createMermaidPresentationApi } from './mermaid-presentation.js';

marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false });

function createMarkdownApi() {
  return Object.freeze({
    parse(source) {
      return marked.parse(String(source || ''));
    },
    lexer(source) {
      return marked.lexer(String(source || ''));
    },
    parser(tokens) {
      return marked.parser(tokens || []);
    }
  });
}

export function createMarkdownPresentationApi() {
  const code = Object.freeze({
    highlightCode,
    getNormalizedCodeLanguage,
    renderHighlightedCodeRows
  });
  return Object.freeze({
    markdown: createMarkdownApi(),
    code,
    math: createMathPresentationApi(),
    mermaid: createMermaidPresentationApi()
  });
}
