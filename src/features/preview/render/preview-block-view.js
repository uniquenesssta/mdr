/**
 * Responsibility: Materialize one preview model block into DOM nodes and project its source range metadata.
 * Imports: None.
 * Exports: createPreviewBlockView().
 * State/side effects: Creates detached nodes only; never mounts, measures, scrolls or schedules work.
 * Lifecycle: create/apply operations reject after destroy().
 */
function defaultParseHtml(documentRef, html) {
  const template = documentRef.createElement('template');
  template.innerHTML = String(html || '');
  return Array.from(template.content?.childNodes || []);
}

export function createPreviewBlockView({ documentRef, parseHtml } = {}) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('Preview Block View requires documentRef.');
  }
  const parse = typeof parseHtml === 'function'
    ? parseHtml
    : html => defaultParseHtml(documentRef, html);
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Preview Block View is destroyed.');
  };

  return Object.freeze({
    createNodes(block, renderFallback) {
      assertActive();
      const html = typeof block?.html === 'string'
        ? block.html
        : typeof renderFallback === 'function'
          ? renderFallback(String(block?.raw || ''))
          : '';
      const elementNodeType = documentRef.defaultView?.Node?.ELEMENT_NODE ?? 1;
      const nodes = parse(html).map(node => {
        if (node?.nodeType === elementNodeType) return node;
        if (!node?.textContent?.trim()) return null;
        const span = documentRef.createElement('span');
        span.textContent = node.textContent;
        return span;
      }).filter(Boolean);
      nodes.forEach((node, index) => {
        node.dataset ??= {};
        node.dataset.previewBlockId = String(block?.id || '');
        node.dataset.previewNodeIndex = String(index);
        node.dataset.renderKey = String(block?.id || '') + ':' + index;
      });
      return nodes;
    },
    applySourceRange(nodes, block) {
      assertActive();
      for (const node of Array.from(nodes || [])) {
        node.dataset ??= {};
        node.dataset.sourceLine = String(block?.startLine ?? 1);
        node.dataset.sourceEndLine = String(block?.endLine ?? block?.startLine ?? 1);
        node.dataset.sourceStartIndex = String(block?.start ?? 0);
        node.dataset.sourceEndIndex = String(block?.end ?? block?.start ?? 0);
      }
      return nodes;
    },
    destroy() {
      destroyed = true;
    }
  });
}
