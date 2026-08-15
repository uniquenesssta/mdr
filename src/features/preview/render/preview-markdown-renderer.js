import { IncrementalPreviewModel } from '../../../model-kernel/index.js';

function escapeHtml(documentRef, text) {
  const node = documentRef.createElement('div');
  node.textContent = String(text || '');
  return node.innerHTML;
}

export function collectMarkedBlockTokens(tokens, out = []) {
  for (const token of tokens || []) {
    if (token?.raw && token.type !== 'space') out.push(token);
  }
  return out;
}

/**
 * Responsibility: Own Markdown parsing/protection fallback used by the Preview render pipeline.
 * Imports: Frozen IncrementalPreviewModel only; parser/presentation capability is injected.
 * Lifecycle: destroy() resets the local incremental model and rejects later renders.
 */
export function createPreviewMarkdownRenderer({ documentRef, presentation, reportError } = {}) {
  if (!documentRef?.createElement) throw new TypeError('Preview Markdown Renderer requires documentRef.');
  if (!presentation?.markdown?.parse || !presentation?.markdown?.lexer || !presentation?.math) {
    throw new TypeError('Preview Markdown Renderer requires markdown and math presentation APIs.');
  }
  const report = typeof reportError === 'function' ? reportError : (message, error) => console.error(message, error);
  let referenceDefinitions = '';
  let incrementalModel = null;
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Preview Markdown Renderer is destroyed.');
  };

  function protect(source) {
    const text = String(source || '');
    if (!presentation.math.containsMath(text)) return { text, placeholders: [], hasMath: false };
    const protectedMath = presentation.math.protectSource(text, 'PREVIEW_MATH');
    return { ...protectedMath, hasMath: true };
  }

  function parseProtected(source, { includeReferences = false } = {}) {
    const original = String(source || '');
    const protectedMath = protect(original);
    const input = includeReferences && referenceDefinitions
      ? `${referenceDefinitions}\n${protectedMath.text}`
      : protectedMath.text;
    try {
      const html = presentation.markdown.parse(input);
      return protectedMath.placeholders.length
        ? presentation.math.restoreSource(html, protectedMath.placeholders)
        : html;
    } catch (error) {
      report('Markdown preview render failed.', error);
      return `<pre class="f-raw-fallback">${escapeHtml(documentRef, original)}</pre>`;
    }
  }

  return Object.freeze({
    containsMath(source) {
      assertActive();
      return presentation.math.containsMath(String(source || ''));
    },
    setReferenceDefinitions(value) {
      assertActive();
      referenceDefinitions = String(value || '');
    },
    renderFragment(source) {
      assertActive();
      return parseProtected(source, { includeReferences: true });
    },
    renderWhole(source) {
      assertActive();
      const original = String(source || '');
      const protectedMath = protect(original);
      let tokens = [];
      let html = '';
      try {
        const tokenTree = presentation.markdown.lexer(protectedMath.text);
        tokens = protectedMath.hasMath ? [] : collectMarkedBlockTokens(tokenTree);
        html = presentation.markdown.parser(tokenTree);
      } catch (error) {
        report('Markdown preview whole-document render failed.', error);
        html = `<pre class="f-raw-fallback">${escapeHtml(documentRef, original)}</pre>`;
        tokens = [];
      }
      if (protectedMath.placeholders.length) {
        html = presentation.math.restoreSource(html, protectedMath.placeholders);
      }
      return Object.freeze({ html, tokens });
    },
    updateIncremental(source, options = {}) {
      assertActive();
      if (!incrementalModel) incrementalModel = new IncrementalPreviewModel(presentation.markdown.lexer);
      return incrementalModel.update(String(source || ''), options);
    },
    resetIncremental() {
      incrementalModel?.reset?.();
      incrementalModel = null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      incrementalModel?.reset?.();
      incrementalModel = null;
      referenceDefinitions = '';
    }
  });
}
