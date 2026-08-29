/**
 * Responsibility: Render mathematical notation inside preview roots through the shared presentation port.
 * Imports: None.
 * Exports: createMathRenderer().
 * State/side effects: Delegates DOM mutation only to presentation.math.renderTree; owns no geometry or scheduling.
 * Lifecycle: render() rejects after destroy().
 */
export function createMathRenderer({ presentation } = {}) {
  const math = presentation?.math;
  if (!math || typeof math.renderTree !== 'function') {
    throw new TypeError('Math Renderer requires presentation.math.renderTree.');
  }
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Math Renderer is destroyed.');
  };

  return Object.freeze({
    render(roots) {
      assertActive();
      const nodes = Array.from(roots || []).filter(Boolean);
      for (const node of nodes) {
        math.renderTree(node, { delimiters: math.delimiters });
      }
      return nodes.length;
    },
    destroy() {
      destroyed = true;
    }
  });
}
