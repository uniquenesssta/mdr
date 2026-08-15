import { syntaxTree } from '@codemirror/language';
import { Facet, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import {
  collectHybridBlocks,
  getEditableRanges
} from '../../model-kernel/index.js';
import { buildInlinePresentation } from './inline-presentation.js';
import {
  destroyHybridComponentSession,
  getHybridComponentSession
} from '../../features/hybrid-editor/index.js';
import { scheduleHybridWidgetGeometry } from './widget-lifecycle.js';
import {
  CodeBlockWidget,
  clearActiveHybridSourceRange,
  getActiveHybridSourceRange,
  HtmlBlockWidget,
  ImageBlockWidget,
  MathBlockWidget,
  MermaidBlockWidget,
  setActiveHybridSourceRange,
  TableBlockWidget,
  revealHybridSourceRangeEffect
} from './widgets.js';

const setHybridBlockDecorations = StateEffect.define();

export const hybridTableVisualEditingFacet = Facet.define({
  combine(values) {
    return values.length ? Boolean(values[values.length - 1]) : false;
  }
});

export const hybridCodeVisualEditingFacet = Facet.define({
  combine(values) {
    return values.length ? Boolean(values[values.length - 1]) : false;
  }
});
const EMPTY_HYBRID_STATS = Object.freeze({
  visibleLines: 0,
  decoratedLines: 0,
  headingLines: 0,
  sourceActiveLines: 0,
  hiddenMarkers: 0,
  renderedBlocks: 0,
  codeBlocks: 0,
  tableBlocks: 0,
  imageBlocks: 0,
  mathBlocks: 0,
  mermaidBlocks: 0,
  htmlBlocks: 0,
  htmlFallbackBlocks: 0
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

function selectionIntersectsRange(selection, range) {
  if (!selection || !range) return false;
  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  return to >= range.from && from <= range.to;
}

function recordSourceEditingClose(details = {}) {
  globalThis.window?.markdownEditorPerf?.record?.('hybrid.source-edit-close', {
    category: 'editor.hybrid',
    details
  });
}

function mapActiveSourceRange(update) {
  let range = getActiveHybridSourceRange(update.view);
  if (!range || !update.docChanged) return range;
  for (const transaction of update.transactions) {
    if (!transaction.docChanged) continue;
    range = {
      ...range,
      from: transaction.changes.mapPos(range.from, -1),
      to: transaction.changes.mapPos(range.to, 1)
    };
  }
  setActiveHybridSourceRange(update.view, range);
  return range;
}

function closeActiveSourceFromPointer(view, event, range) {
  const clickedPosition = view.posAtCoords({ x: event.clientX, y: event.clientY });
  const target = event.target instanceof Element ? event.target : null;
  const clickedSourceLine = Boolean(target?.closest?.('.cm-line'))
    && Number.isInteger(clickedPosition)
    && clickedPosition >= range.from
    && clickedPosition <= range.to;
  if (clickedSourceLine) return false;

  let fallbackPosition = Number.isInteger(clickedPosition) ? clickedPosition : null;
  if (fallbackPosition !== null
    && fallbackPosition >= range.from
    && fallbackPosition <= range.to) {
    fallbackPosition = null;
  }
  if (fallbackPosition === null) {
    if (range.to < view.state.doc.length) fallbackPosition = range.to + 1;
    else if (range.from > 0) fallbackPosition = range.from - 1;
  }

  // Close the explicit source range during pointerdown, before CodeMirror resolves
  // the same pointer against a layout that is about to change from source to widget.
  // Deferring this to requestAnimationFrame caused one stale editable frame and could
  // place the caret back inside the just-closed Mermaid block.
  clearActiveHybridSourceRange(view, 'pointer-outside-source', { trigger: 'pointer-outside-source' });
  event.preventDefault();
  event.stopPropagation();
  if (fallbackPosition !== null) {
    view.dispatch({ selection: { anchor: fallbackPosition } });
  } else {
    view.contentDOM.blur();
  }
  recordSourceEditingClose({
    trigger: 'pointer-outside-source',
    sourceFrom: range.from,
    sourceTo: range.to,
    fallbackPosition,
    immediate: true
  });
  requestAnimationFrame(() => scheduleHybridWidgetGeometry(view, 'source-closed-immediate'));
  return true;
}

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
        next = next.update({
          filter: (rangeFrom, rangeTo) => rangeTo <= from || rangeFrom >= to
        });
      }
      if (effect.is(setHybridBlockDecorations)) next = effect.value;
    }
    return next;
  },
  provide: field => EditorView.decorations.from(field)
});

function getBlockPresentationRange(view, descriptor) {
  const from = Math.max(0, Number(descriptor?.from) || 0);
  let to = Math.max(from, Number(descriptor?.to) || from);
  const type = String(descriptor?.type || '');
  if ((type === 'code' || type === 'mermaid')
    && to === view.state.doc.length
    && to > from
    && view.state.doc.sliceString(Math.max(from, to - 2), to) === '\n\n') {
    to -= 1;
  }
  return { from, to };
}

function createBlockDecoration(view, descriptor) {
  let widget = null;
  if (descriptor.type === 'code') {
    widget = new CodeBlockWidget(descriptor, {
      visualEditing: view.state.facet(hybridCodeVisualEditingFacet)
    });
  } else if (descriptor.type === 'mermaid') {
    widget = new MermaidBlockWidget(descriptor, {
      visualEditing: view.state.facet(hybridCodeVisualEditingFacet)
    });
  } else if (descriptor.type === 'table') {
    widget = new TableBlockWidget(descriptor, {
      visualEditing: view.state.facet(hybridTableVisualEditingFacet)
    });
  } else if (descriptor.type === 'image') widget = new ImageBlockWidget(descriptor);
  else if (descriptor.type === 'math') widget = new MathBlockWidget(descriptor);
  else if (descriptor.type === 'html') widget = new HtmlBlockWidget(descriptor);
  if (!widget) return null;
  const presentationRange = getBlockPresentationRange(view, descriptor);
  return Decoration.replace({ widget, block: true, inclusive: false }).range(
    presentationRange.from,
    presentationRange.to
  );
}

function validateHybridBlocks(view, blocks) {
  const documentLength = view.state.doc.length;
  const valid = [];
  const invalid = [];
  let previousEnd = -1;
  for (const block of blocks) {
    const from = Number(block?.from);
    const to = Number(block?.to);
    const rangeValid = Number.isInteger(from)
      && Number.isInteger(to)
      && from >= 0
      && to > from
      && to <= documentLength
      && from >= previousEnd;
    if (!rangeValid) {
      invalid.push({ type: String(block?.type || ''), from, to });
      continue;
    }
    valid.push(block);
    previousEnd = to;
  }
  if (invalid.length) {
    reportHybridDiagnostic('hybrid.invalid-block-range', {
      status: 'warning',
      dedupeKey: 'hybrid.invalid-block-range',
      details: {
        ...getViewDiagnosticDetails(view),
        invalidCount: invalid.length,
        invalid: invalid.slice(0, 6)
      }
    });
  }
  return valid;
}

function countBlockTypes(blocks) {
  const counts = { code: 0, mermaid: 0, table: 0, image: 0, math: 0, html: 0 };
  for (const block of blocks) {
    if (Object.hasOwn(counts, block.type)) counts[block.type] += 1;
  }
  return counts;
}

function hashText(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getBlockSignature(blocks, options = {}) {
  return blocks.map(block => {
    let content = '';
    if (block.type === 'code' || block.type === 'mermaid') content = `${block.fingerprint || `${block.language}\0${block.code}`}\0visual-edit:${Boolean(options.codeVisualEditing)}`;
    else if (block.type === 'table') content = `${block.fingerprint}\0visual-edit:${Boolean(options.tableVisualEditing)}`;
    else if (block.type === 'image') content = `${block.source}\0${block.alt}\0${block.title}`;
    else if (block.type === 'math') content = `${block.fingerprint}\0${block.formula}`;
    else if (block.type === 'html') content = block.fingerprint || block.source || '';
    return `${block.type}:${block.from}:${block.to}:${hashText(content)}`;
  }).join('|');
}

function showOpenError(error) {
  const message = error?.message || String(error || '链接打开失败');
  if (typeof window.showToast === 'function') window.showToast(message);
  else console.warn(message);
}

export function buildHybridMarkdownDecorations(view) {
  const started = performance.now();
  try {
    const tree = syntaxTree(view.state);
    const editableRanges = getEditableRanges(view, tree);
    const activeSourceRange = getActiveHybridSourceRange(view);
    const protectedSourceRanges = activeSourceRange ? [activeSourceRange] : [];
    const blocks = validateHybridBlocks(view, collectHybridBlocks(view, tree, protectedSourceRanges));
    const blockRanges = blocks.map(block => getBlockPresentationRange(view, block));
    const blockDecorationRanges = [];
    for (const block of blocks) {
      try {
        const decoration = createBlockDecoration(view, block);
        if (decoration) blockDecorationRanges.push(decoration);
      } catch (error) {
        reportHybridDiagnostic('hybrid.widget-build-failure', {
          status: 'error',
          dedupeKey: `hybrid.widget-build-failure:${block.type}`,
          details: {
            ...getViewDiagnosticDetails(view),
            blockType: block.type,
            blockFrom: block.from,
            blockTo: block.to,
            message: error?.message || String(error)
          }
        });
      }
    }
    const inline = buildInlinePresentation(
      view,
      tree,
      editableRanges,
      blockRanges,
      protectedSourceRanges
    );
    const blockCounts = countBlockTypes(blocks);
    const fallbackHtmlBlocks = blocks.filter(block => block.type === 'html' && block.discovery === 'fallback');
    if (fallbackHtmlBlocks.length) {
      const fallbackChars = fallbackHtmlBlocks.reduce((total, block) => total + Math.max(0, block.to - block.from), 0);
      reportHybridDiagnostic('hybrid.html-range-fallback', {
        status: 'ok',
        dedupeKey: `hybrid.html-range-fallback:${fallbackHtmlBlocks.map(block => `${block.from}-${block.to}`).join(',')}`,
        details: {
          ...getViewDiagnosticDetails(view),
          fallbackCount: fallbackHtmlBlocks.length,
          fallbackChars,
          ranges: fallbackHtmlBlocks.slice(0, 8).map(block => ({ from: block.from, to: block.to }))
        }
      });
    }
    const result = {
      decorations: Decoration.set(inline.ranges, true),
      blockDecorations: Decoration.set(blockDecorationRanges, true),
      blockSignature: getBlockSignature(blocks, {
        tableVisualEditing: view.state.facet(hybridTableVisualEditingFacet),
        codeVisualEditing: view.state.facet(hybridCodeVisualEditingFacet)
      }),
      stats: {
        ...inline.stats,
        renderedBlocks: blocks.length,
        codeBlocks: blockCounts.code,
        mermaidBlocks: blockCounts.mermaid,
        tableBlocks: blockCounts.table,
        imageBlocks: blockCounts.image,
        mathBlocks: blockCounts.math,
        htmlBlocks: blockCounts.html,
        htmlFallbackBlocks: fallbackHtmlBlocks.length
      }
    };
    const durationMs = performance.now() - started;
    if (durationMs >= 24) {
      reportHybridDiagnostic('hybrid.slow-decoration-build', {
        status: 'warning',
        dedupeKey: 'hybrid.slow-decoration-build',
        fingerprint: `${Math.round(durationMs / 8)}:${view.state.doc.length}:${blocks.length}`,
        details: {
          ...getViewDiagnosticDetails(view),
          durationMs: Number(durationMs.toFixed(3)),
          editableRanges: editableRanges.length,
          renderedBlocks: blocks.length,
          decoratedLines: inline.stats.decoratedLines || 0
        }
      });
    }
    return result;
  } catch (error) {
    reportHybridDiagnostic('hybrid.decoration-build-failure', {
      status: 'error',
      dedupeKey: `hybrid.decoration-build-failure:${error?.name || 'Error'}`,
      details: {
        ...getViewDiagnosticDetails(view),
        message: error?.message || String(error)
      }
    });
    return {
      decorations: Decoration.none,
      blockDecorations: Decoration.none,
      blockSignature: '',
      stats: { ...EMPTY_HYBRID_STATS }
    };
  }
}

export const hybridMarkdownPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    getHybridComponentSession(view, { onTransition: recordHybridComponentTransition });
    this.destroyed = false;
    this.blockDispatchQueued = false;
    this.pendingBlockDecorations = Decoration.none;
    this.pendingBlockSignature = '';
    this.appliedBlockSignature = '';
    const built = buildHybridMarkdownDecorations(view);
    this.decorations = built.decorations;
    this.stats = built.stats;
    this.scheduleBlockUpdate(view, built.blockDecorations, built.blockSignature);
  }

  scheduleBlockUpdate(view, blockDecorations, signature) {
    this.pendingBlockDecorations = blockDecorations;
    this.pendingBlockSignature = signature;
    if (signature === this.appliedBlockSignature || this.blockDispatchQueued) return;
    this.blockDispatchQueued = true;
    queueMicrotask(() => {
      this.blockDispatchQueued = false;
      if (this.destroyed
        || view.destroyed
        || view.dom?.isConnected === false
        || this.pendingBlockSignature === this.appliedBlockSignature) {
        return;
      }
      const nextSignature = this.pendingBlockSignature;
      const nextDecorations = this.pendingBlockDecorations;
      try {
        view.dispatch({ effects: setHybridBlockDecorations.of(nextDecorations) });
        this.appliedBlockSignature = nextSignature;
      } catch (error) {
        reportHybridDiagnostic('hybrid.block-dispatch-failure', {
          status: 'error',
          dedupeKey: `hybrid.block-dispatch-failure:${error?.name || 'Error'}`,
          details: {
            ...getViewDiagnosticDetails(view),
            signatureLength: nextSignature.length,
            message: error?.message || String(error)
          }
        });
      }
    });
  }

  update(update) {
    const activeSourceRange = mapActiveSourceRange(update);
    if (activeSourceRange
      && update.selectionSet
      && !selectionIntersectsRange(update.state.selection.main, activeSourceRange)) {
      clearActiveHybridSourceRange(update.view, 'selection-left', { trigger: 'selection-left' });
      recordSourceEditingClose({
        trigger: 'selection-left',
        sourceFrom: activeSourceRange.from,
        sourceTo: activeSourceRange.to
      });
    }
    const blockEffectOnly = update.transactions.some(transaction =>
      transaction.effects.some(effect => effect.is(setHybridBlockDecorations))
    );
    // Widget ResizeObserver 会主动通知 CodeMirror 重新测量。单纯 geometryChanged
    // 不需要重新解析 Markdown，否则图片加载和窗口拖动会形成装饰重建循环。
    const configurationChanged = update.startState.facet(hybridTableVisualEditingFacet)
      !== update.state.facet(hybridTableVisualEditingFacet)
      || update.startState.facet(hybridCodeVisualEditingFacet)
      !== update.state.facet(hybridCodeVisualEditingFacet);
    const needsRebuild = update.docChanged
      || update.selectionSet
      || update.viewportChanged
      || update.focusChanged
      || configurationChanged;
    if (!needsRebuild || (blockEffectOnly && !update.docChanged && !update.selectionSet && !update.viewportChanged && !update.focusChanged)) {
      return;
    }
    const built = buildHybridMarkdownDecorations(update.view);
    this.decorations = built.decorations;
    this.stats = built.stats;
    this.scheduleBlockUpdate(update.view, built.blockDecorations, built.blockSignature);
  }

  destroy() {
    this.destroyed = true;
    this.blockDispatchQueued = false;
    destroyHybridComponentSession(this.view);
  }
}, {
  decorations: value => value.decorations,
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
      const activeSourceRange = getActiveHybridSourceRange(view);
      if (!activeSourceRange) return false;
      return closeActiveSourceFromPointer(view, event, activeSourceRange);
    },
    click(event) {
      const element = event.target instanceof Element
        ? event.target.closest('[data-hybrid-link-url]')
        : null;
      if (!element) return false;
      event.preventDefault();
      event.stopPropagation();
      const url = element.getAttribute('data-hybrid-link-url');
      const linkPreview = window.markdownEditorLinkPreview;
      if (!linkPreview) {
        showOpenError(new Error('链接预览尚未初始化'));
        return true;
      }
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        linkPreview.openExternal(url).catch(showOpenError);
      } else {
        linkPreview.open(url, {
          source: 'hybrid-markdown-link',
          sourceElement: element
        });
      }
      return true;
    }
  }
});

export function createHybridMarkdownControllerExtension() {
  return [hybridBlockDecorationField, hybridMarkdownPlugin];
}

export function getHybridMarkdownStats(view) {
  return view.plugin(hybridMarkdownPlugin)?.stats || { ...EMPTY_HYBRID_STATS };
}
