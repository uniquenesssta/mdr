/**
 * Atomic 8.8 Code Block widget composition and interactive lifecycle.
 * Allowed imports: Code Block view/direct-editor/actions plus Hybrid Session/Activation/Lifecycle/Shared source primitives.
 * Forbidden imports: CodeMirror packages, frozen model kernel, Preview and application globals; CodeMirror WidgetType/history annotation are injected by editor composition.
 * API: createCodeBlockWidgetType(). State: only widget DOM/closer references; authoritative interaction mode remains in HybridComponentSession. Lifecycle: WidgetType destroy tears down direct editor, activation and geometry resources.
 */
import { bindStrictDoubleActivation } from '../../activation/strict-double-activation.js';
import {
  HYBRID_COMPONENT_MODES,
  closeHybridComponent,
  createHybridComponentKey,
  registerHybridComponentCloser,
  transitionHybridComponent
} from '../../state/hybrid-component-session.js';
import {
  attachHybridWidgetLifecycle,
  destroyHybridWidgetLifecycle
} from '../../lifecycle/widget-lifecycle.js';
import { scheduleHybridWidgetGeometry } from '../../lifecycle/widget-geometry-scheduler.js';
import { bindWidgetSourceAction, openWidgetSource } from '../shared/widget-source-action.js';
import { createCodeBlockToolbar } from './code-block-actions.js';
import { createCodeBlockDirectEditor } from './code-block-direct-editor.js';
import { createCodeBlockPresentationBody, resolveCodePointerOffset } from './code-block-view.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function createCodeBlockWidgetType(WidgetType, options = {}) {
  if (typeof WidgetType !== 'function') throw new TypeError('WidgetType base is required');
  const scheduleFrame = typeof options.scheduleFrame === 'function'
    ? options.scheduleFrame
    : callback => globalThis.requestAnimationFrame(callback);
  const recordInteraction = typeof options.recordInteraction === 'function'
    ? options.recordInteraction
    : () => {};
  const notify = typeof options.notify === 'function' ? options.notify : () => {};
  const reportEditFailure = typeof options.reportEditFailure === 'function'
    ? options.reportEditFailure
    : () => {};

  return class CodeBlockWidget extends WidgetType {
    constructor(descriptor, widgetOptions = {}) {
      super();
      this.from = descriptor.from;
      this.to = descriptor.to;
      this.editFrom = descriptor.contentFrom ?? descriptor.from;
      this.editTo = descriptor.contentTo ?? this.editFrom;
      this.language = String(descriptor.language || '');
      this.code = String(descriptor.code || '');
      this.writebackMode = descriptor.writebackMode || 'fenced';
      this.fenceCharacter = descriptor.fenceCharacter || '`';
      this.fenceLength = descriptor.fenceLength || 3;
      this.infoRaw = String(descriptor.infoRaw || '');
      this.fingerprint = descriptor.fingerprint || '';
      this.visualEditing = Boolean(widgetOptions.visualEditing);
    }

    eq(other) {
      return other.from === this.from
        && other.to === this.to
        && other.editFrom === this.editFrom
        && other.editTo === this.editTo
        && other.language === this.language
        && other.code === this.code
        && other.fingerprint === this.fingerprint
        && other.visualEditing === this.visualEditing;
    }

    toDOM(view) {
      const section = document.createElement('section');
      section.className = 'cm-hybrid-block-widget cm-hybrid-code-widget';
      section.classList.toggle('is-code-editing-enabled', this.visualEditing);
      section.dataset.hybridBlockType = 'code';
      section.dataset.hybridCodeFrom = String(this.from);
      const editDescriptor = {
        componentType: 'code',
        from: this.from,
        to: this.to,
        editFrom: this.editFrom,
        editTo: this.editTo,
        preferredPosition: this.editFrom
      };

      const disposeSourceAction = bindWidgetSourceAction(section, view, editDescriptor, {
        sourceKeys: [],
        title: '双击直接编辑代码；点击“编辑源码”编辑 Markdown 源码',
        exclude: event => this.visualEditing
          && event.target instanceof Element
          && Boolean(event.target.closest('.cm-hybrid-code-body')),
        onOpen: (trigger, gesture = {}) => recordInteraction('hybrid.code-source-open', {
          codeFrom: this.from,
          trigger,
          intervalMs: gesture.intervalMs ?? null,
          distancePx: gesture.distancePx ?? null
        })
      });

      const openCodeSource = (activeEditor = null) => {
        const anchorRect = section.getBoundingClientRect();
        const committedDescriptor = activeEditor?.__markdownEditorCommitCodeBlock?.();
        scheduleFrame(() => {
          openWidgetSource(view, { ...(committedDescriptor || editDescriptor), componentType: 'code' }, {
            getBoundingClientRect: () => anchorRect
          });
        });
      };

      const header = createCodeBlockToolbar({
        language: this.language,
        visualEditing: this.visualEditing,
        getCode: () => {
          const activeEditor = section.querySelector('[data-hybrid-code-editor]');
          return activeEditor instanceof HTMLTextAreaElement ? activeEditor.value : this.code;
        },
        notify,
        onSourceEdit: () => {
          const activeEditor = section.querySelector('[data-hybrid-code-editor]');
          recordInteraction('hybrid.code-source-open', {
            codeFrom: this.from,
            trigger: 'button'
          });
          openCodeSource(activeEditor instanceof HTMLTextAreaElement ? activeEditor : null);
        }
      });
      section.appendChild(header);

      const componentKey = createHybridComponentKey('code', this.from);
      let unregisterDirectCloser = () => {};

      const cleanupDirectActivation = body => {
        body?.__markdownEditorCodeDirectActivationCleanup?.();
        if (body) delete body.__markdownEditorCodeDirectActivationCleanup;
      };

      const createPresentation = (codeValue = this.code) => {
        const body = createCodeBlockPresentationBody(codeValue, this.language);
        body.dataset.hybridDoubleZone = 'code-body';
        if (!this.visualEditing) return body;
        body.classList.add('is-direct-edit-trigger');
        body.tabIndex = 0;
        body.title = '双击直接编辑代码；点击“编辑源码”编辑 Markdown 源码';
        body.setAttribute('aria-label', `${this.language || '无语言'}代码块，双击直接编辑`);
        body.__markdownEditorCodeDirectActivationCleanup = bindStrictDoubleActivation(body, (event, gesture) => {
          recordInteraction('hybrid.code-direct-edit-open', {
            codeFrom: this.from,
            trigger: 'doubleclick',
            line: Number(event.target?.closest?.('[data-line-number]')?.getAttribute?.('data-line-number')) || null,
            intervalMs: gesture.intervalMs,
            distancePx: gesture.distancePx
          });
          activateDirectEditor(resolveCodePointerOffset(body, event, this.code));
        }, {
          exclude: event => event.target instanceof Element
            && Boolean(event.target.closest('button, a, input, textarea, select')),
          getTargetKey: event => event.target?.closest?.('[data-line-number]')?.getAttribute?.('data-line-number')
            ? `code-line:${event.target.closest('[data-line-number]').getAttribute('data-line-number')}`
            : 'code-body'
        });
        return body;
      };

      const restorePresentation = (activeEditor, codeValue = this.code, reason = 'direct-closed') => {
        unregisterDirectCloser();
        unregisterDirectCloser = () => {};
        closeHybridComponent(view, componentKey, reason, { componentType: 'code' }, HYBRID_COMPONENT_MODES.DIRECT);
        if (!activeEditor?.isConnected || !section.contains(activeEditor)) return;
        const body = createPresentation(codeValue);
        activeEditor.replaceWith(body);
        section.classList.remove('is-code-editor-active');
        scheduleFrame(() => scheduleHybridWidgetGeometry(view, 'code-direct-edit-closed'));
      };

      const activateDirectEditor = (selectionOffset = 0) => {
        if (!this.visualEditing || section.querySelector('[data-hybrid-code-editor]')) return;
        const body = section.querySelector('.cm-hybrid-code-body');
        if (!(body instanceof HTMLElement)) return;
        transitionHybridComponent(view, {
          key: componentKey,
          type: 'code',
          from: this.from,
          mode: HYBRID_COMPONENT_MODES.DIRECT,
          reason: 'doubleclick'
        });
        let editor = null;
        editor = createCodeBlockDirectEditor(view, {
          from: this.from,
          to: this.to,
          language: this.language,
          code: this.code,
          writebackMode: this.writebackMode,
          fenceCharacter: this.fenceCharacter,
          fenceLength: this.fenceLength,
          infoRaw: this.infoRaw
        }, {
          createHistoryAnnotation: options.createHistoryAnnotation,
          onFailure: reportEditFailure,
          onClose: result => {
            recordInteraction('hybrid.code-direct-edit-close', {
              codeFrom: this.from,
              reason: result?.reason || 'unknown'
            });
            restorePresentation(editor, result?.value ?? this.code, result?.reason || 'direct-closed');
          }
        });
        unregisterDirectCloser = registerHybridComponentCloser(view, componentKey, () => {
          if (editor?.isConnected) editor.blur();
        });
        cleanupDirectActivation(body);
        body.replaceWith(editor);
        section.classList.add('is-code-editor-active');
        const caret = clamp(selectionOffset, 0, editor.value.length);
        scheduleFrame(() => {
          if (!editor.isConnected) return;
          editor.focus({ preventScroll: true });
          editor.setSelectionRange(caret, caret);
          scheduleHybridWidgetGeometry(view, 'code-direct-edit-opened');
        });
      };

      section.appendChild(createPresentation());
      const lifecycleCleanup = attachHybridWidgetLifecycle(section, view, 'code');
      let cleaned = false;
      section.__markdownEditorCodeBlockCleanup = () => {
        if (cleaned) return;
        cleaned = true;
        disposeSourceAction();
        unregisterDirectCloser();
        unregisterDirectCloser = () => {};
        const editor = section.querySelector('[data-hybrid-code-editor]');
        editor?.__markdownEditorDestroyCodeBlock?.();
        cleanupDirectActivation(section.querySelector('.cm-hybrid-code-body'));
        lifecycleCleanup();
      };
      return section;
    }

    destroy(dom) {
      dom?.__markdownEditorCodeBlockCleanup?.();
      if (dom) delete dom.__markdownEditorCodeBlockCleanup;
      destroyHybridWidgetLifecycle(dom);
    }

    ignoreEvent() {
      return true;
    }
  };
}
