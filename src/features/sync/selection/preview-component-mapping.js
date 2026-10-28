/** Map rendered components by source identity; null leaves ordinary text to the separately injected frozen kernel. */
function isRenderedDiagram(root, source) {
  return Boolean(root?.matches?.('.mermaid') && root.querySelector?.('svg')
    && /^\s*(`{3,}|~{3,})mermaid(?:[ \t]*\r?\n)/i.test(source));
}

export function createPreviewComponentMapping() {
  return Object.freeze({
    createPreviewRangesForSourceSelection(root, source, absoluteStart, from, to) {
      if (!isRenderedDiagram(root, source)) return null;
      const count = Math.max(0, Math.min(Math.max(from, to), absoluteStart + source.length) - Math.max(Math.min(from, to), absoluteStart));
      return { ranges: [], atomicElements: count ? [root] : [], sourceCharacters: count,
        mappedCharacters: count, projectionCoverage: 1, componentMapping: true };
    },
    mapPreviewDomPointToSource(root, source, absoluteStart, node, offset, affinity) {
      if (!isRenderedDiagram(root, source)) return null;
      if (!root.contains?.(node)) return null;
      const end = absoluteStart + source.length;
      return { position: affinity === 'end' ? end : absoluteStart, from: absoluteStart, to: end,
        projectionCoverage: 1, atomic: true, componentMapping: true };
    }
  });
}
