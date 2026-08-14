/**
 * Responsibility: Compose the Stage 7 preview DOM renderer family behind one explicit PreviewRendererPort.
 * Imports: Preview render modules only.
 * Exports: createPreviewRendererPort().
 * State/side effects: Owns renderer lifecycle and delegates presentation-only DOM work; owns no scheduling, geometry, sync or virtual-window policy.
 * Lifecycle: Explicit idempotent start/destroy; all operational methods reject after destroy or before start.
 */
import { createPreviewBlockView } from './preview-block-view.js';
import { createPreviewDomRenderer } from './preview-dom-renderer.js';
import { createTaskListRenderer } from './task-list-renderer.js';
import { createCodeRenderer } from './code-renderer.js';
import { createMathRenderer } from './math-renderer.js';
import { createMermaidRenderer } from './mermaid-renderer.js';

export function createPreviewRendererPort({
  root,
  documentRef,
  documentModel,
  presentation,
  copyText,
  notify = () => {},
  record = () => {},
  reportError = (message, error) => console.error(message, error)
} = {}) {
  if (!presentation?.code || !presentation?.math || !presentation?.mermaid) {
    throw new TypeError('PreviewRendererPort requires the shared Markdown presentation port.');
  }
  const blockView = createPreviewBlockView({ documentRef });
  const domRenderer = createPreviewDomRenderer({ root, documentRef, blockView });
  const taskListRenderer = createTaskListRenderer({ root });
  const codeRenderer = createCodeRenderer({ root, documentRef, documentModel, presentation, copyText, notify });
  const mathRenderer = createMathRenderer({ presentation });
  const mermaidRenderer = createMermaidRenderer({ root, documentRef, presentation, record, reportError });
  let started = false;
  let destroyed = false;

  const assertOperational = () => {
    if (destroyed) throw new Error('PreviewRendererPort is destroyed.');
    if (!started) throw new Error('PreviewRendererPort is not started.');
  };

  return Object.freeze({
    start() {
      if (destroyed) throw new Error('PreviewRendererPort is destroyed.');
      if (started) return false;
      codeRenderer.start();
      started = true;
      return true;
    },
    patchHtml(html, options) {
      assertOperational();
      return domRenderer.patchHtml(html, options);
    },
    patchBlocks(result, options) {
      assertOperational();
      return domRenderer.patchBlocks(result, options);
    },
    createBlockNodes(block, renderFallback) {
      assertOperational();
      return blockView.createNodes(block, renderFallback);
    },
    applyBlockSourceRange(nodes, block) {
      assertOperational();
      return blockView.applySourceRange(nodes, block);
    },
    renderTaskLists(roots) {
      assertOperational();
      return taskListRenderer.render(roots);
    },
    renderCode(roots) {
      assertOperational();
      return codeRenderer.render(roots);
    },
    renderMath(roots) {
      assertOperational();
      return mathRenderer.render(roots);
    },
    renderMermaid(roots, isCancelled) {
      assertOperational();
      return mermaidRenderer.render(roots, isCancelled);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      started = false;
      mermaidRenderer.destroy();
      mathRenderer.destroy();
      codeRenderer.destroy();
      taskListRenderer.destroy();
      domRenderer.destroy();
      blockView.destroy();
    }
  });
}
