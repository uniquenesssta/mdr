/**
 * Atomic 8.12 Mermaid WidgetType composition, presentation orchestration and interactive lifecycle.
 * Allowed imports: Mermaid actions/render-state, canonical Code Block direct editor, Hybrid Session/Activation/Lifecycle/Shared SOURCE primitives.
 * Forbidden imports: CodeMirror packages, frozen model kernel, Preview modules and application globals; WidgetType/history/presentation capabilities are injected by editor composition.
 * API: createMermaidBlockWidgetType(). State: render request state plus widget-local DOM/closer references; authoritative interaction mode remains in HybridComponentSession. Lifecycle: destroy invalidates async work and tears down observer, direct editor, activation, SOURCE and geometry resources.
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
import { createCodeBlockDirectEditor } from '../code-block/code-block-direct-editor.js';
import { createMermaidToolbar } from './mermaid-actions.js';
import { createMermaidRenderState } from './mermaid-render-state.js';

function createMermaidStatus(documentRef, message, className = '') {
  const status = documentRef.createElement('div');
  status.className = `cm-hybrid-mermaid-status${className ? ` ${className}` : ''}`;
  status.textContent = message;
  return status;
}

export function createMermaidBlockWidgetType(WidgetType, options = {}) {
  if (typeof WidgetType !== 'function') throw new TypeError('WidgetType base is required');
  if (typeof options.renderDiagram !== 'function') throw new TypeError('Mermaid presentation renderer is required');
  if (typeof options.getTheme !== 'function') throw new TypeError('Mermaid theme reader is required');
  const scheduleFrame = typeof options.scheduleFrame === 'function'
    ? options.scheduleFrame
    : callback => globalThis.requestAnimationFrame(callback);
  const recordInteraction = typeof options.recordInteraction === 'function'
    ? options.recordInteraction
    : () => {};
  const notify = typeof options.notify === 'function' ? options.notify : () => {};
  const reportRenderFailure = typeof options.reportRenderFailure === 'function'
    ? options.reportRenderFailure
    : () => {};
  const reportEditFailure = typeof options.reportEditFailure === 'function'
    ? options.reportEditFailure
    : () => {};

  return class MermaidBlockWidget extends WidgetType {
    constructor(descriptor, widgetOptions = {}) {
      super();
      this.from = descriptor.from;
      this.to = descriptor.to;
      this.editFrom = descriptor.contentFrom ?? descriptor.from;
      this.editTo = descriptor.contentTo ?? this.editFrom;
      this.code = String(descriptor.code || '');
      this.fingerprint = descriptor.fingerprint || '';
      this.fenceCharacter = descriptor.fenceCharacter || '`';
      this.fenceLength = descriptor.fenceLength || 3;
      this.infoRaw = String(descriptor.infoRaw || 'mermaid');
      this.visualEditing = Boolean(widgetOptions.visualEditing);
    }

    eq(other) {
      return other.from === this.from
        && other.to === this.to
        && other.editFrom === this.editFrom
        && other.editTo === this.editTo
        && other.code === this.code
        && other.fingerprint === this.fingerprint
        && other.visualEditing === this.visualEditing;
    }

    toDOM(view) {
      const documentRef = globalThis.document;
      const section = documentRef.createElement('section');
      section.className = 'cm-hybrid-block-widget cm-hybrid-mermaid-widget';
      section.classList.toggle('is-code-editing-enabled', this.visualEditing);
      section.dataset.hybridBlockType = 'mermaid';
      section.dataset.hybridMermaidFrom = String(this.from);

      const editDescriptor = {
        componentType: 'mermaid',
        from: this.from,
        to: this.to,
        editFrom: this.editFrom,
        editTo: this.editTo,
        preferredPosition: this.editFrom
      };
      const disposeSourceAction = bindWidgetSourceAction(section, view, editDescriptor, {
        sourceKeys: [],
        title: this.visualEditing
          ? '双击直接编辑 Mermaid；点击“编辑源码”编辑 Markdown 源码'
          : '双击编辑 Mermaid 源码',
        exclude: event => this.visualEditing
          && event.target instanceof Element
          && Boolean(event.target.closest('.cm-hybrid-mermaid-body')),
        onOpen: (trigger, gesture = {}) => recordInteraction('hybrid.mermaid-source-open', {
          sourceFrom: this.from,
          trigger,
          intervalMs: gesture.intervalMs ?? null,
          distancePx: gesture.distancePx ?? null
        })
      });

      const openMermaidSource = (activeEditor = null) => {
        const anchorRect = section.getBoundingClientRect();
        const committedDescriptor = activeEditor?.__markdownEditorCommitCodeBlock?.();
        scheduleFrame(() => {
          openWidgetSource(view, { ...(committedDescriptor || editDescriptor), componentType: 'mermaid' }, {
            getBoundingClientRect: () => anchorRect
          });
        });
      };

      const renderState = createMermaidRenderState({ sourceFrom: this.from, source: this.code });
      const renderPresentation = async (container, sourceValue) => {
        const sourceText = String(sourceValue || '');
        const theme = options.getTheme();
        const request = renderState.begin(sourceText, theme);
        if (!request) return;
        container.dataset.renderState = 'loading';
        container.replaceChildren(createMermaidStatus(documentRef, '正在渲染 Mermaid 图表…'));
        scheduleHybridWidgetGeometry(view, 'mermaid-loading');

        try {
          const diagram = documentRef.createElement('div');
          diagram.className = 'cm-hybrid-mermaid-diagram';
          const result = await options.renderDiagram(diagram, sourceText, {
            theme,
            cacheKey: request.cacheKey,
            renderIdPrefix: 'markdown-editor-hybrid-mermaid',
            ariaLabel: 'Mermaid 图表',
            isCancelled: () => !renderState.isCurrent(request) || !container.isConnected
          });
          if (result.status === 'cancelled' || !container.isConnected) return;
          renderState.commit(request, () => {
            container.replaceChildren(diagram);
            container.dataset.renderState = 'ready';
            recordInteraction('hybrid.mermaid-render-result', {
              sourceFrom: request.sourceFrom,
              sourceChars: sourceText.length,
              theme,
              status: result.status
            });
            scheduleFrame(() => scheduleHybridWidgetGeometry(
              view,
              result.status === 'cached' ? 'mermaid-cache-restored' : 'mermaid-rendered'
            ));
          });
        } catch (error) {
          if (!container.isConnected) return;
          renderState.commit(request, () => {
            container.dataset.renderState = 'error';
            const errorBox = createMermaidStatus(
              documentRef,
              error?.message || 'Mermaid 图表渲染失败',
              'is-error'
            );
            const hint = documentRef.createElement('small');
            hint.textContent = '双击编辑图表源码，或点击右上角“编辑源码”。';
            errorBox.appendChild(hint);
            container.replaceChildren(errorBox);
            reportRenderFailure(error, {
              sourceFrom: request.sourceFrom,
              sourceChars: sourceText.length
            });
            recordInteraction('hybrid.mermaid-render-result', {
              sourceFrom: request.sourceFrom,
              sourceChars: sourceText.length,
              theme,
              status: 'failed'
            });
            scheduleFrame(() => scheduleHybridWidgetGeometry(view, 'mermaid-render-failed'));
          });
        }
      };

      const componentKey = createHybridComponentKey('mermaid', this.from);
      let unregisterDirectCloser = () => {};

      const cleanupDirectActivation = body => {
        body?.__markdownEditorMermaidDirectActivationCleanup?.();
        if (body) delete body.__markdownEditorMermaidDirectActivationCleanup;
      };

      const createPresentation = (codeValue = this.code) => {
        renderState.setSource(codeValue);
        const body = documentRef.createElement('div');
        body.className = 'cm-hybrid-mermaid-body';
        body.dataset.hybridDoubleZone = 'mermaid-body';
        body.tabIndex = 0;
        body.setAttribute('aria-label', 'Mermaid 图表');
        body.title = this.visualEditing
          ? '双击直接编辑 Mermaid；点击“编辑源码”编辑 Markdown 源码'
          : '双击编辑 Mermaid 源码';
        scheduleFrame(() => {
          if (!body.isConnected) return;
          void renderPresentation(body, codeValue);
        });
        if (this.visualEditing) {
          body.__markdownEditorMermaidDirectActivationCleanup = bindStrictDoubleActivation(body, (event, gesture) => {
            recordInteraction('hybrid.mermaid-direct-edit-open', {
              sourceFrom: this.from,
              trigger: 'doubleclick',
              intervalMs: gesture.intervalMs,
              distancePx: gesture.distancePx
            });
            activateDirectEditor();
          }, {
            exclude: event => event.target instanceof Element
              && Boolean(event.target.closest('button, a, input, textarea, select')),
            getTargetKey: () => 'mermaid-body'
          });
        }
        return body;
      };

      const restorePresentation = (activeEditor, codeValue = this.code, reason = 'direct-closed') => {
        unregisterDirectCloser();
        unregisterDirectCloser = () => {};
        closeHybridComponent(view, componentKey, reason, { componentType: 'mermaid' }, HYBRID_COMPONENT_MODES.DIRECT);
        if (!activeEditor?.isConnected || !section.contains(activeEditor)) return;
        const body = createPresentation(codeValue);
        activeEditor.replaceWith(body);
        section.classList.remove('is-code-editor-active');
        scheduleFrame(() => scheduleHybridWidgetGeometry(view, 'mermaid-direct-edit-closed'));
      };

      const activateDirectEditor = () => {
        if (!this.visualEditing || section.querySelector('[data-hybrid-code-editor]')) return;
        const body = section.querySelector('.cm-hybrid-mermaid-body');
        if (!(body instanceof HTMLElement)) return;
        transitionHybridComponent(view, {
          key: componentKey,
          type: 'mermaid',
          from: this.from,
          mode: HYBRID_COMPONENT_MODES.DIRECT,
          reason: 'doubleclick'
        });
        renderState.invalidate();
        let editor = null;
        editor = createCodeBlockDirectEditor(view, {
          from: this.from,
          to: this.to,
          language: 'mermaid',
          code: this.code,
          writebackMode: 'fenced',
          fenceCharacter: this.fenceCharacter,
          fenceLength: this.fenceLength,
          infoRaw: this.infoRaw || 'mermaid'
        }, {
          createHistoryAnnotation: options.createHistoryAnnotation,
          onFailure: reportEditFailure,
          onClose: result => {
            recordInteraction('hybrid.mermaid-direct-edit-close', {
              sourceFrom: this.from,
              reason: result?.reason || 'unknown'
            });
            restorePresentation(editor, result?.value ?? this.code, result?.reason || 'direct-closed');
          }
        });
        editor.setAttribute('aria-label', 'Mermaid 图表源码');
        unregisterDirectCloser = registerHybridComponentCloser(view, componentKey, () => {
          if (editor?.isConnected) editor.blur();
        });
        cleanupDirectActivation(body);
        body.replaceWith(editor);
        section.classList.add('is-code-editor-active');
        scheduleFrame(() => {
          if (!editor.isConnected) return;
          editor.focus({ preventScroll: true });
          editor.setSelectionRange(0, 0);
          scheduleHybridWidgetGeometry(view, 'mermaid-direct-edit-opened');
        });
      };

      const header = createMermaidToolbar({
        visualEditing: this.visualEditing,
        getSource: () => {
          const activeEditor = section.querySelector('[data-hybrid-code-editor]');
          return activeEditor instanceof HTMLTextAreaElement ? activeEditor.value : this.code;
        },
        notify,
        onSourceEdit: () => {
          const activeEditor = section.querySelector('[data-hybrid-code-editor]');
          recordInteraction('hybrid.mermaid-source-open', {
            sourceFrom: this.from,
            trigger: 'button'
          });
          openMermaidSource(activeEditor instanceof HTMLTextAreaElement ? activeEditor : null);
        }
      });
      section.appendChild(header);
      section.appendChild(createPresentation());

      const MutationObserverCtor = options.MutationObserverCtor || globalThis.MutationObserver;
      const themeObserver = typeof MutationObserverCtor === 'function'
        ? new MutationObserverCtor(() => {
          const body = section.querySelector('.cm-hybrid-mermaid-body');
          if (body instanceof HTMLElement) void renderPresentation(body, renderState.source);
        })
        : null;
      themeObserver?.observe(documentRef.body, { attributes: true, attributeFilter: ['data-theme'] });

      const lifecycleCleanup = attachHybridWidgetLifecycle(section, view, 'mermaid');
      let cleaned = false;
      section.__markdownEditorMermaidBlockCleanup = () => {
        if (cleaned) return;
        cleaned = true;
        disposeSourceAction();
        unregisterDirectCloser();
        unregisterDirectCloser = () => {};
        const editor = section.querySelector('[data-hybrid-code-editor]');
        editor?.__markdownEditorDestroyCodeBlock?.();
        cleanupDirectActivation(section.querySelector('.cm-hybrid-mermaid-body'));
        renderState.destroy();
        themeObserver?.disconnect();
        lifecycleCleanup();
      };
      return section;
    }

    destroy(dom) {
      dom?.__markdownEditorMermaidBlockCleanup?.();
      if (dom) delete dom.__markdownEditorMermaidBlockCleanup;
      destroyHybridWidgetLifecycle(dom);
    }

    ignoreEvent() {
      return true;
    }
  };
}
