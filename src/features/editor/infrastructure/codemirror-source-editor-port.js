/**
 * Responsibility: Adapt one CodeMirror view to the Hybrid source editor capability contract.
 * Imports: CodeMirror state/view primitives and the Editor's shared pointer resolver; Hybrid controllers stay vendor-neutral.
 * Exports: createCodeMirrorSourceEditorPort and revealHybridSourceRangeEffect for Editor integration.
 * State/side effects: View capability calls and one terminal destroyed flag; no application state.
 * Lifecycle: Explicit port construction with idempotent destroy; all subsequent capabilities reject.
 */
import { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getHybridParagraphBoundary, prepareHybridParagraphSelection, resolvePrecisePointerPosition } from './pointer-selection/precise-pointer-selection.js';

export const revealHybridSourceRangeEffect = StateEffect.define();

function assertView(view) {
  if (!view?.state?.doc || typeof view.dispatch !== 'function') {
    throw new TypeError('CodeMirror source editor port requires an EditorView-like value');
  }
  return view;
}

export function createCodeMirrorSourceEditorPort(view, options = {}) {
  const editorView = assertView(view);
  const markProgrammaticScroll = typeof options.markProgrammaticScroll === 'function'
    ? options.markProgrammaticScroll
    : () => {};
  let destroyed = false;

  const assertAlive = () => {
    if (destroyed) throw new Error('CodeMirrorSourceEditorPort is destroyed');
  };

  return Object.freeze({
    getDocumentLength() {
      assertAlive();
      return editorView.state.doc.length;
    },

    getScrollViewportMetrics() {
      assertAlive();
      const rect = editorView.scrollDOM.getBoundingClientRect();
      return {
        top: Number(rect.top) || 0,
        height: Number(rect.height) || 0,
        clientHeight: Number(editorView.scrollDOM.clientHeight) || 0
      };
    },

    markProgrammaticScroll(surface, durationMs) {
      assertAlive();
      markProgrammaticScroll(surface, durationMs);
    },

    focus() {
      assertAlive();
      editorView.focus();
    },

    revealSourceRange(request = {}) {
      assertAlive();
      editorView.dispatch({
        selection: {
          anchor: Number(request.selectionFrom) || 0,
          head: Number(request.selectionTo) || 0
        },
        effects: [
          revealHybridSourceRangeEffect.of({
            from: Number(request.sourceFrom) || 0,
            to: Number(request.sourceTo) || 0
          }),
          ...(!request.preserveViewport ? [EditorView.scrollIntoView(Number(request.position) || 0, {
            y: 'start',
            yMargin: Math.max(0, Number(request.yMargin) || 0)
          })] : [])
        ]
      });
    },

    inspectUpdate(update, range) {
      assertAlive();
      let mapped = range ? { ...range } : null;
      if (mapped && update?.docChanged) {
        for (const transaction of update.transactions || []) {
          if (!transaction.docChanged) continue;
          mapped = {
            ...mapped,
            from: transaction.changes.mapPos(mapped.from, -1),
            to: transaction.changes.mapPos(mapped.to, 1)
          };
        }
      }
      const selection = update?.state?.selection?.main;
      return {
        range: mapped,
        selectionSet: Boolean(update?.selectionSet),
        selection: selection
          ? { anchor: selection.anchor, head: selection.head }
          : null
      };
    },

    positionAtCoordinates(coords) {
      assertAlive();
      const clientX = Number(coords?.x) || 0, clientY = Number(coords?.y) || 0;
      return resolvePrecisePointerPosition(editorView, {
        clientX, clientY, target: editorView.dom.ownerDocument.elementFromPoint?.(clientX, clientY)
      })?.pos ?? null;
    },

    setSelection(position, { sourceRange, appendAfterSource = false } = {}) {
      assertAlive();
      const doc = editorView.state.doc;
      let anchor = Math.max(0, Math.min(doc.length, Number(position) || 0));
      let changes;
      let normalized = false;
      const line = doc.lineAt(anchor);
      const skipTableSeparator = sourceRange?.componentType === 'table'
        && anchor === sourceRange.to + 1 && line.from === anchor && line.to === anchor;
      if (appendAfterSource && sourceRange?.to === doc.length && !editorView.state.readOnly) {
        const required = ['code', 'mermaid'].includes(sourceRange.componentType) ? 1 : 2;
        const trailing = doc.sliceString(Math.max(0, doc.length - 2), doc.length).match(/\n*$/)[0].length;
        const insert = '\n'.repeat(Math.max(0, required - trailing));
        if (insert) changes = { from: doc.length, insert };
        anchor = doc.length + insert.length;
        normalized = true;
      } else if (skipTableSeparator) {
        if (line.number < doc.lines) { anchor = doc.line(line.number + 1).from; normalized = true; }
        else if (!editorView.state.readOnly) { changes = { from: doc.length, insert: '\n' }; anchor = doc.length + 1; normalized = true; }
      }
      const paragraph = !changes && !normalized ? getHybridParagraphBoundary(editorView, anchor,
        anchor === sourceRange?.to + 1 ? sourceRange.componentType : '') : null;
      if (paragraph) { changes = paragraph.changes; anchor = paragraph.anchor; }
      const prepared = prepareHybridParagraphSelection(anchor, changes ? { changes, anchor,
        beforeComposition: ['code', 'mermaid', 'table', 'image', 'math', 'html'].includes(sourceRange?.componentType) } : null);
      editorView.dispatch({ selection: { anchor: prepared.anchor }, effects: prepared.effects,
        ...(paragraph || normalized ? { userEvent: 'select.pointer.normalized' } : {}) });
      return prepared.anchor;
    },

    blur() {
      assertAlive();
      editorView.contentDOM.blur();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
    }
  });
}
