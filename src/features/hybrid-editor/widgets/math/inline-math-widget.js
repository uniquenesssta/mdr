/**
 * Atomic 8.11 inline Math presentation and source-activation lifecycle.
 * Preview formula rendering is supplied explicitly by the editor integration boundary.
 * Allowed imports: Hybrid shared source-action primitive only.
 * Forbidden imports: CodeMirror packages, Preview internals, frozen model modules and application globals.
 * API: createInlineMathWidgetType(). State: widget descriptor snapshot plus element-scoped cleanup only.
 */
import { bindWidgetSourceAction } from '../shared/widget-source-action.js';

export function createInlineMathWidgetType(WidgetType, options = {}) {
  if (typeof WidgetType !== 'function') throw new TypeError('WidgetType base is required');
  if (typeof options.renderFormula !== 'function') throw new TypeError('Math presentation renderer is required');
  const renderFormula = options.renderFormula;
  const recordInteraction = typeof options.recordInteraction === 'function'
    ? options.recordInteraction
    : () => {};
  const reportRenderFailure = typeof options.reportRenderFailure === 'function'
    ? options.reportRenderFailure
    : () => {};

  return class InlineMathWidget extends WidgetType {
    constructor(descriptor) {
      super();
      this.from = descriptor.from;
      this.to = descriptor.to;
      this.contentFrom = descriptor.contentFrom;
      this.contentTo = descriptor.contentTo;
      this.formula = String(descriptor.formula || '');
      this.delimiter = descriptor.delimiter || '$';
    }

    eq(other) {
      return other.from === this.from
        && other.to === this.to
        && other.formula === this.formula
        && other.delimiter === this.delimiter;
    }

    toDOM(view) {
      const span = document.createElement('span');
      span.className = 'cm-hybrid-inline-math';
      span.dataset.hybridInlineMath = 'true';
      span.dataset.hybridMathFrom = String(this.from);
      renderFormula(span, this.formula, {
        displayMode: false,
        fallbackToSource: true,
        errorClass: 'is-error',
        onError: error => reportRenderFailure(error, { displayMode: false })
      });

      const disposeSourceAction = bindWidgetSourceAction(span, view, {
        from: this.from,
        to: this.to,
        editFrom: this.contentFrom,
        editTo: this.contentTo,
        preferredPosition: this.contentFrom
      }, {
        sourceKeys: [],
        title: '双击编辑公式源码',
        onOpen: (trigger, gesture = {}) => recordInteraction('hybrid.math-source-open', {
          mathFrom: this.from,
          displayMode: false,
          trigger,
          intervalMs: gesture.intervalMs ?? null,
          distancePx: gesture.distancePx ?? null
        })
      });
      span.dataset.hybridDoubleZone = 'inline-math';
      span.title = span.classList.contains('is-error')
        ? `${span.title || '公式语法错误'}；双击编辑源码`
        : '双击编辑公式源码';

      let cleaned = false;
      span.__markdownEditorInlineMathCleanup = () => {
        if (cleaned) return;
        cleaned = true;
        disposeSourceAction();
      };
      return span;
    }

    destroy(dom) {
      dom?.__markdownEditorInlineMathCleanup?.();
      if (dom) delete dom.__markdownEditorInlineMathCleanup;
    }

    ignoreEvent() {
      return true;
    }
  };
}
