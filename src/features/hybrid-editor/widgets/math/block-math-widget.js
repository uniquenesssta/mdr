/**
 * Atomic 8.11 block Math presentation, source action and Widget lifecycle.
 * Allowed imports: Hybrid lifecycle and shared widget primitives only.
 * Forbidden imports: CodeMirror packages, Preview internals, frozen model modules and application globals.
 * API: createMathBlockWidgetType(). State: widget descriptor snapshot plus idempotent DOM cleanup only.
 */
import {
  attachHybridWidgetLifecycle,
  destroyHybridWidgetLifecycle
} from '../../lifecycle/widget-lifecycle.js';
import { createWidgetButton } from '../shared/widget-button.js';
import { createWidgetToolbar } from '../shared/widget-toolbar.js';
import { bindWidgetSourceAction, openWidgetSource } from '../shared/widget-source-action.js';

export function createMathBlockWidgetType(WidgetType, options = {}) {
  if (typeof WidgetType !== 'function') throw new TypeError('WidgetType base is required');
  if (typeof options.renderFormula !== 'function') throw new TypeError('Math presentation renderer is required');
  const renderFormula = options.renderFormula;
  const recordInteraction = typeof options.recordInteraction === 'function'
    ? options.recordInteraction
    : () => {};
  const reportRenderFailure = typeof options.reportRenderFailure === 'function'
    ? options.reportRenderFailure
    : () => {};

  return class MathBlockWidget extends WidgetType {
    constructor(descriptor) {
      super();
      this.from = descriptor.from;
      this.to = descriptor.to;
      this.contentFrom = descriptor.contentFrom;
      this.contentTo = descriptor.contentTo;
      this.formula = String(descriptor.formula || '');
      this.delimiter = descriptor.delimiter || '$$';
      this.fingerprint = descriptor.fingerprint || '';
    }

    eq(other) {
      return other.from === this.from
        && other.to === this.to
        && other.formula === this.formula
        && other.delimiter === this.delimiter
        && other.fingerprint === this.fingerprint;
    }

    toDOM(view) {
      const section = document.createElement('section');
      section.className = 'cm-hybrid-block-widget cm-hybrid-math-widget';
      section.dataset.hybridBlockType = 'math';
      section.dataset.hybridMathFrom = String(this.from);
      const editDescriptor = {
        componentType: 'math',
        from: this.from,
        to: this.to,
        editFrom: this.contentFrom,
        editTo: this.contentTo,
        preferredPosition: this.contentFrom
      };
      const disposeSourceAction = bindWidgetSourceAction(section, view, editDescriptor, {
        sourceKeys: [],
        title: '双击编辑 LaTeX 源码；也可点击“编辑源码”',
        onOpen: (trigger, gesture = {}) => recordInteraction('hybrid.math-source-open', {
          mathFrom: this.from,
          displayMode: true,
          trigger,
          intervalMs: gesture.intervalMs ?? null,
          distancePx: gesture.distancePx ?? null
        })
      });

      const toolbar = createWidgetToolbar({ doubleZone: 'math-toolbar' });
      const label = document.createElement('span');
      label.textContent = 'LaTeX 块级公式';
      toolbar.appendChild(label);
      toolbar.appendChild(createWidgetButton('编辑源码', 'cm-hybrid-widget-action', () => {
        recordInteraction('hybrid.math-source-open', {
          mathFrom: this.from,
          displayMode: true,
          trigger: 'button'
        });
        openWidgetSource(view, editDescriptor, section);
      }));
      section.appendChild(toolbar);

      const body = document.createElement('div');
      body.className = 'cm-hybrid-math-body';
      body.dataset.hybridDoubleZone = 'math-body';
      renderFormula(body, this.formula, {
        displayMode: true,
        fallbackToSource: true,
        errorClass: 'is-error',
        onError: error => reportRenderFailure(error, { displayMode: true })
      });
      section.appendChild(body);

      const lifecycleCleanup = attachHybridWidgetLifecycle(section, view, 'math');
      let cleaned = false;
      section.__markdownEditorMathBlockCleanup = () => {
        if (cleaned) return;
        cleaned = true;
        disposeSourceAction();
        lifecycleCleanup();
      };
      return section;
    }

    destroy(dom) {
      dom?.__markdownEditorMathBlockCleanup?.();
      if (dom) delete dom.__markdownEditorMathBlockCleanup;
      destroyHybridWidgetLifecycle(dom);
    }

    ignoreEvent() {
      return true;
    }
  };
}
