import katex from 'katex';
import renderMathInElement from 'katex/contrib/auto-render';
import {
  containsMarkdownMath,
  protectMarkdownMathSource,
  restoreMarkdownMathSource
} from '../model-kernel/index.js';

export const katexEngine = katex;
export const autoRenderMathInElement = renderMathInElement;

export const MARKDOWN_MATH_DELIMITERS = Object.freeze([
  Object.freeze({ left: '$$', right: '$$', display: true }),
  Object.freeze({ left: '\\[', right: '\\]', display: true }),
  Object.freeze({ left: '$', right: '$', display: false }),
  Object.freeze({ left: '\\(', right: '\\)', display: false })
]);

export function renderMathFormula(element, formula, options = {}) {
  if (!(element instanceof Element)) throw new TypeError('Math render target must be an Element');
  const source = String(formula || '');
  try {
    katex.render(source, element, {
      displayMode: Boolean(options.displayMode),
      throwOnError: true,
      strict: options.strict || 'ignore',
      trust: Boolean(options.trust)
    });
    element.dataset.mathRenderState = 'ready';
    return { ok: true, error: null };
  } catch (error) {
    element.dataset.mathRenderState = 'error';
    if (options.fallbackToSource !== false) element.textContent = source;
    if (options.errorClass) element.classList.add(options.errorClass);
    if (options.setErrorTitle !== false) element.title = error?.message || '公式语法错误';
    options.onError?.(error);
    return { ok: false, error };
  }
}

export function renderMathTree(root, options = {}) {
  if (!(root instanceof Element)) return false;
  const renderOptions = {
    delimiters: options.delimiters || MARKDOWN_MATH_DELIMITERS,
    throwOnError: false,
    strict: options.strict || 'ignore',
    trust: Boolean(options.trust)
  };
  if (Array.isArray(options.ignoredTags)) renderOptions.ignoredTags = options.ignoredTags;
  if (Array.isArray(options.ignoredClasses)) renderOptions.ignoredClasses = options.ignoredClasses;
  if (typeof options.onError === 'function') renderOptions.errorCallback = options.onError;
  renderMathInElement(root, renderOptions);
  return true;
}

export function createMathPresentationApi() {
  return Object.freeze({
    delimiters: MARKDOWN_MATH_DELIMITERS,
    containsMath: containsMarkdownMath,
    protectSource: protectMarkdownMathSource,
    restoreSource: restoreMarkdownMathSource,
    renderFormula: renderMathFormula,
    renderTree: renderMathTree
  });
}
