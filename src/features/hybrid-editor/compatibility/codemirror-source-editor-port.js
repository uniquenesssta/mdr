import { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

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
          EditorView.scrollIntoView(Number(request.position) || 0, {
            y: 'start',
            yMargin: Math.max(0, Number(request.yMargin) || 0)
          })
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
      return editorView.posAtCoords({ x: Number(coords?.x) || 0, y: Number(coords?.y) || 0 });
    },

    setSelection(position) {
      assertAlive();
      editorView.dispatch({ selection: { anchor: Math.max(0, Number(position) || 0) } });
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
