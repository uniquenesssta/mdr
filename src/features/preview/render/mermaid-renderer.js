/**
 * Responsibility: Replace preview Mermaid code fences with diagrams through the shared presentation port.
 * Imports: None.
 * Exports: createMermaidRenderer().
 * State/side effects: Owns only async render cancellation state and Mermaid error/result presentation for supplied roots.
 * Lifecycle: destroy() invalidates in-flight work so destroyed renderers cannot commit DOM.
 */
function normalizeRoots(roots, fallbackRoot) {
  return Array.isArray(roots) && roots.length ? roots.filter(Boolean) : [fallbackRoot];
}

function collectMermaidBlocks(roots) {
  const blocks = [];
  const seen = new Set();
  const add = code => {
    if (!code || seen.has(code)) return;
    const pre = code.closest?.('pre') || code.parentElement;
    if (!pre || pre.dataset?.mermaidRendering === 'true') return;
    seen.add(code);
    blocks.push(code);
  };
  for (const root of roots) {
    if (!root) continue;
    if (root.matches?.('code.language-mermaid')) add(root);
    if (root.matches?.('pre')) add(root.querySelector?.(':scope > code.language-mermaid'));
    root.querySelectorAll?.('pre > code.language-mermaid').forEach(add);
  }
  return blocks;
}

export function createMermaidRenderer({
  root,
  documentRef,
  presentation,
  record = () => {},
  reportError = (message, error) => console.error(message, error)
} = {}) {
  const mermaid = presentation?.mermaid;
  if (!root || typeof root.querySelectorAll !== 'function') {
    throw new TypeError('Mermaid Renderer requires a preview root.');
  }
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('Mermaid Renderer requires documentRef.');
  }
  if (!mermaid || typeof mermaid.renderDiagram !== 'function') {
    throw new TypeError('Mermaid Renderer requires presentation.mermaid.renderDiagram.');
  }
  if (typeof record !== 'function' || typeof reportError !== 'function') {
    throw new TypeError('Mermaid Renderer diagnostics must be functions.');
  }
  let destroyed = false;
  let generation = 0;
  const assertActive = () => {
    if (destroyed) throw new Error('Mermaid Renderer is destroyed.');
  };

  return Object.freeze({
    async render(roots = null, isCancelled = () => false) {
      assertActive();
      const requestGeneration = generation;
      const cancelled = pre => destroyed
        || requestGeneration !== generation
        || Boolean(isCancelled?.())
        || pre?.isConnected === false;
      if (cancelled()) return { requested: 0, rendered: 0, failed: 0, cancelled: 1 };

      const theme = mermaid.getTheme?.(documentRef.body) || 'default';
      const blocks = collectMermaidBlocks(normalizeRoots(roots, root));
      let rendered = 0;
      let failed = 0;
      let cancelledCount = 0;

      for (const code of blocks) {
        const pre = code.closest?.('pre') || code.parentElement;
        const source = String(code.textContent || '').trim();
        if (!pre || !source) continue;
        if (cancelled(pre)) {
          cancelledCount += 1;
          break;
        }
        pre.dataset.mermaidRendering = 'true';
        pre.classList?.remove?.('preview-mermaid-error');
        delete pre.dataset.mermaidError;

        const container = documentRef.createElement('div');
        container.className = 'mermaid';
        for (const attribute of Array.from(pre.attributes || [])) {
          if (attribute.name?.startsWith('data-') && attribute.name !== 'data-mermaid-rendering') {
            container.setAttribute?.(attribute.name, attribute.value);
          }
        }

        try {
          const sourceIdentity = Number(pre.dataset.sourceStartIndex);
          const cacheKey = Number.isFinite(sourceIdentity)
            ? `preview:${sourceIdentity}`
            : `preview-line:${Number(pre.dataset.sourceLine) || 0}`;
          const result = await mermaid.renderDiagram(container, source, {
            theme,
            cacheKey,
            renderIdPrefix: 'markdown-editor-preview-mermaid',
            ariaLabel: 'Mermaid 图表',
            isCancelled: () => cancelled(pre)
          });
          if (result?.status === 'cancelled' || cancelled(pre)) {
            delete pre.dataset.mermaidRendering;
            cancelledCount += 1;
            continue;
          }
          pre.replaceWith?.(container);
          rendered += 1;
        } catch (error) {
          delete pre.dataset.mermaidRendering;
          pre.classList?.add?.('preview-mermaid-error');
          pre.dataset.mermaidError = 'true';
          failed += 1;
          reportError('Mermaid render error:', error);
          record('preview.mermaid-render-failure', {
            category: 'render.pipeline',
            status: 'error',
            details: {
              message: error?.message || String(error),
              sourceChars: source.length,
              sourceLine: Number(pre.dataset.sourceLine) || null
            }
          });
        }
      }

      const stats = { requested: blocks.length, rendered, failed, cancelled: cancelledCount };
      record('preview.mermaid-render-result', {
        category: 'render.pipeline',
        durationMs: null,
        aggregate: true,
        details: { ...stats, renderer: 'shared' }
      });
      return stats;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
    }
  });
}
