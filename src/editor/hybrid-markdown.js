
/**
 * Responsibility: Final CodeMirror integration facade for the Stage 8 Hybrid Editor feature; compose editor/vendor/model/Preview capabilities into the public Hybrid feature without owning feature policy.
 * Imports: CodeMirror, Marked, frozen model facade, canonical Preview presentation APIs and only the Hybrid Editor public entry.
 * Exports: buildHybridMarkdownDecorations, getHybridMarkdownStats, createHybridMarkdownExtension and createHybridMarkdownConfiguration.
 * State/side effects: Defines CodeMirror facets/effects/plugin integration only; Hybrid runtime and decoration state are owned by feature application controllers.
 * Lifecycle: CodeMirror ViewPlugin creates one HybridEditorController and delegates terminal cleanup to it.
 */
import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { Facet, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { marked } from 'marked';
import {
  collectHybridBlocks,
  collectInlineMathRanges,
  collectVisibleLines,
  encodeTableCell,
  getEditableRanges,
  intersectsRanges,
  intersectsRevealRanges,
  overlapsRanges,
  shouldDecorateSourceActiveLine
} from '../model-kernel/index.js';
import { renderMathFormula } from '../features/preview/render/presentation/math-presentation.js';
import { getMermaidTheme, renderMermaidDiagram } from '../features/preview/render/presentation/mermaid-presentation.js';
import {
  createCodeBlockWidgetType,
  createHtmlBlockWidgetType,
  createHybridDecorationCoordinator,
  createHybridEditorController,
  createHybridSourceEditController,
  createImageBlockWidgetType,
  createInlinePresentationCoordinator,
  getHybridSyncCapabilities,
  createMathBlockWidgetType,
  createMermaidBlockWidgetType,
  createTableBlockWidgetType,
  destroyHybridComponentSession,
  destroyHybridWidgetGeometryScheduler,
  getClassicHybridSourceEditControllerPort,
  getHybridComponentSession,
  mountClassicHybridSourceEditControllerPort,
  scheduleHybridWidgetGeometry
} from '../features/hybrid-editor/index.js';
import {
  createCodeMirrorSourceEditorPort,
  revealHybridSourceRangeEffect
} from '../features/hybrid-editor/compatibility/codemirror-source-editor-port.js';

const setHybridBlockDecorations = StateEffect.define();

const hybridTableVisualEditingFacet = Facet.define({
  combine(values) {
    return values.length ? Boolean(values[values.length - 1]) : false;
  }
});

const hybridCodeVisualEditingFacet = Facet.define({
  combine(values) {
    return values.length ? Boolean(values[values.length - 1]) : false;
  }
});

function recordHybridComponentTransition({ previous, current }) {
  globalThis.window?.markdownEditorPerf?.record?.('hybrid.component-state-transition', {
    category: 'editor.hybrid',
    details: {
      key: current.key,
      componentType: current.type,
      componentFrom: current.from,
      previousMode: previous?.mode || null,
      mode: current.mode,
      reason: current.reason,
      revision: current.revision,
      version: current.version,
      ...current.details
    }
  });
}

function reportHybridDiagnostic(operation, options = {}) {
  globalThis.window?.markdownEditorPerf?.diagnostic?.(operation, {
    category: 'editor.hybrid',
    minIntervalMs: 5000,
    ...options
  });
}

function getViewDiagnosticDetails(view) {
  const selection = view?.state?.selection?.main;
  return {
    documentChars: view?.state?.doc?.length || 0,
    documentLines: view?.state?.doc?.lines || 1,
    viewportRanges: Array.from(view?.visibleRanges || [], range => `${range.from}-${range.to}`),
    selectionFrom: selection ? Math.min(selection.anchor, selection.head) : 0,
    selectionTo: selection ? Math.max(selection.anchor, selection.head) : 0,
    hasFocus: Boolean(view?.hasFocus)
  };
}

function recordInteraction(operation, details = {}) {
  globalThis.window?.markdownEditorPerf?.record?.(operation, {
    category: 'editor.hybrid',
    details
  });
}

function showToast(message) {
  const notify = globalThis.window?.showToast;
  if (typeof notify === 'function') notify(String(message || ''));
}

function reportCodeEditFailure(error, details = {}) {
  reportHybridDiagnostic('hybrid.code-edit-failure', {
    status: 'error',
    dedupeKey: `hybrid.code-edit-failure:${error?.name || 'Error'}`,
    details: { ...details, message: error?.message || String(error || '代码块写回失败') }
  });
  showToast(error?.message || '代码块写回失败');
}

function reportTableEditFailure(error, details = {}) {
  reportHybridDiagnostic('hybrid.table-cell-edit-failure', {
    status: 'error',
    dedupeKey: `hybrid.table-cell-edit-failure:${error?.name || 'Error'}`,
    details: { ...details, message: error?.message || String(error || '表格单元格写回失败') }
  });
  showToast(error?.message || '表格单元格写回失败');
}

function reportMathRenderFailure(error, details = {}) {
  reportHybridDiagnostic('hybrid.math-render-failure', {
    status: 'warning',
    dedupeKey: `hybrid.math-render-failure:${error?.name || 'ParseError'}`,
    details: { ...details, message: error?.message || String(error || '公式渲染失败') }
  });
}

function reportMermaidRenderFailure(error, details = {}) {
  reportHybridDiagnostic('hybrid.mermaid-render-failure', {
    status: 'warning',
    dedupeKey: `hybrid.mermaid-render-failure:${error?.name || 'Error'}`,
    details: { ...details, message: error?.message || String(error || 'Mermaid 图表渲染失败') }
  });
}

const CodeBlockWidget = createCodeBlockWidgetType(WidgetType, {
  createHistoryAnnotation: () => isolateHistory.of('full'),
  recordInteraction,
  notify: showToast,
  reportEditFailure: reportCodeEditFailure
});
const TableBlockWidget = createTableBlockWidgetType(WidgetType, {
  encodeTableCell,
  createHistoryAnnotation: () => isolateHistory.of('full'),
  recordInteraction,
  reportEditFailure: reportTableEditFailure
});
const ImageBlockWidget = createImageBlockWidgetType(WidgetType);
const MathBlockWidget = createMathBlockWidgetType(WidgetType, {
  renderFormula: renderMathFormula,
  recordInteraction,
  reportRenderFailure: reportMathRenderFailure
});
const MermaidBlockWidget = createMermaidBlockWidgetType(WidgetType, {
  renderDiagram: renderMermaidDiagram,
  getTheme: getMermaidTheme,
  createHistoryAnnotation: () => isolateHistory.of('full'),
  recordInteraction,
  notify: showToast,
  reportRenderFailure: reportMermaidRenderFailure,
  reportEditFailure: reportCodeEditFailure
});
const HtmlBlockWidget = createHtmlBlockWidgetType(WidgetType, { recordInteraction });

const buildInlinePresentation = createInlinePresentationCoordinator({
  Decoration,
  WidgetType,
  lexInline: source => marked.Lexer.lexInline(source),
  renderFormula: renderMathFormula,
  recordMathInteraction: recordInteraction,
  reportMathRenderFailure,
  collectInlineMathRanges,
  collectVisibleLines,
  intersectsRanges,
  intersectsRevealRanges,
  overlapsRanges,
  shouldDecorateSourceActiveLine
});

const hybridBlockDecorationField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    let next = transaction.docChanged ? decorations.map(transaction.changes) : decorations;
    for (const effect of transaction.effects) {
      if (effect.is(revealHybridSourceRangeEffect)) {
        const from = Math.max(0, Number(effect.value?.from) || 0);
        const to = Math.max(from + 1, Number(effect.value?.to) || from + 1);
        next = next.update({ filter: (rangeFrom, rangeTo) => rangeTo <= from || rangeFrom >= to });
      }
      if (effect.is(setHybridBlockDecorations)) next = effect.value;
    }
    return next;
  },
  provide: field => EditorView.decorations.from(field)
});

function createBlockDecoration(view, descriptor, presentationRange) {
  let widget = null;
  if (descriptor.type === 'code') {
    widget = new CodeBlockWidget(descriptor, { visualEditing: view.state.facet(hybridCodeVisualEditingFacet) });
  } else if (descriptor.type === 'mermaid') {
    widget = new MermaidBlockWidget(descriptor, { visualEditing: view.state.facet(hybridCodeVisualEditingFacet) });
  } else if (descriptor.type === 'table') {
    widget = new TableBlockWidget(descriptor, { visualEditing: view.state.facet(hybridTableVisualEditingFacet) });
  } else if (descriptor.type === 'image') widget = new ImageBlockWidget(descriptor);
  else if (descriptor.type === 'math') widget = new MathBlockWidget(descriptor);
  else if (descriptor.type === 'html') widget = new HtmlBlockWidget(descriptor);
  if (!widget) return null;
  return Decoration.replace({ widget, block: true, inclusive: false }).range(
    presentationRange.from,
    presentationRange.to
  );
}

const decorationCoordinator = createHybridDecorationCoordinator({
  getSyntaxTree: view => syntaxTree(view.state),
  getEditableRanges,
  getActiveSourceRange: view => getClassicHybridSourceEditControllerPort(view)?.getActiveRange() || null,
  collectHybridBlocks,
  buildInlinePresentation,
  createBlockDecoration,
  createDecorationSet: ranges => Decoration.set(ranges, true),
  emptyDecorations: Decoration.none,
  getTableVisualEditing: view => view.state.facet(hybridTableVisualEditingFacet),
  getCodeVisualEditing: view => view.state.facet(hybridCodeVisualEditingFacet),
  reportDiagnostic: reportHybridDiagnostic,
  getViewDiagnosticDetails,
  now: () => performance.now()
});

export function buildHybridMarkdownDecorations(view) {
  return decorationCoordinator.build(view);
}

function recordSourceEditingClose(details = {}) {
  globalThis.window?.markdownEditorPerf?.record?.('hybrid.source-edit-close', {
    category: 'editor.hybrid',
    details
  });
}

function showOpenError(error) {
  const message = error?.message || String(error || '链接打开失败');
  const notify = globalThis.window?.showToast;
  if (typeof notify === 'function') notify(message);
  else console.warn(message);
}

const hybridMarkdownPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    const hybridSession = getHybridComponentSession(view, { onTransition: recordHybridComponentTransition });
    const sourceEditorPort = createCodeMirrorSourceEditorPort(view, {
      markProgrammaticScroll: (surface, durationMs) => {
        getHybridSyncCapabilities()?.markProgrammaticScroll(surface, durationMs);
      }
    });
    const sourceEditController = createHybridSourceEditController({
      editorPort: sourceEditorPort,
      session: hybridSession,
      requestFrame: callback => {
        const requestFrame = globalThis.requestAnimationFrame;
        if (typeof requestFrame === 'function') return requestFrame(callback);
        callback();
        return null;
      },
      scheduleGeometry: reason => scheduleHybridWidgetGeometry(view, reason),
      recordClose: recordSourceEditingClose
    });
    const sourceEditPortMount = mountClassicHybridSourceEditControllerPort(view, sourceEditController);
    this.controller = createHybridEditorController({
      view,
      decorationCoordinator,
      sourceEditorPort,
      sourceEditController,
      sourceEditPortMount,
      dispatchBlockDecorations: (editorView, blockDecorations) => {
        editorView.dispatch({ effects: setHybridBlockDecorations.of(blockDecorations) });
      },
      isBlockDecorationUpdate: update => update.transactions.some(transaction =>
        transaction.effects.some(effect => effect.is(setHybridBlockDecorations))
      ),
      configurationChanged: update => update.startState.facet(hybridTableVisualEditingFacet)
        !== update.state.facet(hybridTableVisualEditingFacet)
        || update.startState.facet(hybridCodeVisualEditingFacet)
          !== update.state.facet(hybridCodeVisualEditingFacet),
      destroyGeometry: () => destroyHybridWidgetGeometryScheduler(view),
      destroySession: () => destroyHybridComponentSession(view),
      reportDiagnostic: reportHybridDiagnostic,
      getViewDiagnosticDetails
    });
  }

  update(update) {
    this.controller.update(update);
  }

  destroy() {
    this.controller.destroy();
  }
}, {
  decorations: value => value.controller.getDecorations(),
  eventHandlers: {
    mousedown(event, view) {
      if (event.button !== 0) return false;
      const linkElement = event.target instanceof Element
        ? event.target.closest('[data-hybrid-link-url], a[href]')
        : null;
      if (linkElement && linkElement.closest('#editor')) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      return view.plugin(hybridMarkdownPlugin)?.controller?.closeSourceFromPointer({
        button: event.button,
        x: event.clientX,
        y: event.clientY,
        targetIsEditorLine: event.target instanceof Element && Boolean(event.target.closest('.cm-line')),
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation()
      }) || false;
    },
    click(event) {
      const element = event.target instanceof Element ? event.target.closest('[data-hybrid-link-url]') : null;
      if (!element) return false;
      event.preventDefault();
      event.stopPropagation();
      const url = element.getAttribute('data-hybrid-link-url');
      const linkPreview = globalThis.window?.markdownEditorLinkPreview;
      if (!linkPreview) {
        showOpenError(new Error('链接预览尚未初始化'));
        return true;
      }
      if (event.ctrlKey || event.metaKey || event.shiftKey) linkPreview.openExternal(url).catch(showOpenError);
      else linkPreview.open(url, { source: 'hybrid-markdown-link', sourceElement: element });
      return true;
    }
  }
});

export function createHybridMarkdownExtension() {
  return [hybridBlockDecorationField, hybridMarkdownPlugin];
}

export function createHybridMarkdownConfiguration(options = {}) {
  return [
    hybridTableVisualEditingFacet.of(Boolean(options.tableVisualEditing)),
    hybridCodeVisualEditingFacet.of(Boolean(options.codeVisualEditing))
  ];
}

export function getHybridMarkdownStats(view) {
  return view.plugin(hybridMarkdownPlugin)?.controller?.getStats() || decorationCoordinator.getEmptyStats();
}
