import { isolateHistory } from '@codemirror/commands';
import { EditorView, WidgetType } from '@codemirror/view';
import { renderMathFormula } from '../../features/preview/render/presentation/math-presentation.js';
import { getMermaidTheme, renderMermaidDiagram } from '../../features/preview/render/presentation/mermaid-presentation.js';
import { resolveHybridImageSource, invalidateHybridImageSource } from './image-source.js';
import {
  HYBRID_COMPONENT_MODES,
  bindWidgetSourceAction,
  bindStrictDoubleActivation,
  attachHybridWidgetLifecycle,
  destroyHybridWidgetLifecycle,
  scheduleHybridWidgetGeometry,
  closeHybridComponent,
  createHybridComponentKey,
  createCodeBlockDirectEditor,
  createWidgetActionGroup,
  createWidgetButton,
  createWidgetToolbar,
  openWidgetSource,
  registerHybridComponentCloser,
  transitionHybridComponent
} from '../../features/hybrid-editor/index.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

async function copyText(value) {
  const text = String(value ?? '');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.className = 'c-clipboard-buffer';
  textarea.setAttribute('readonly', '');
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('无法复制代码');
}

function showToast(message) {
  if (typeof window.showToast === 'function') window.showToast(String(message || ''));
}

function recordHybridInteraction(operation, details = {}) {
  globalThis.window?.markdownEditorPerf?.record?.(operation, {
    category: 'editor.hybrid',
    details
  });
}

function attachBlockLifecycle(element, view, type, extraCleanup = null) {
  const lifecycleCleanup = attachHybridWidgetLifecycle(element, view, type);
  element.__markdownEditorHybridCleanup = () => {
    extraCleanup?.();
    lifecycleCleanup();
  };
}

function destroyBlockLifecycle(element) {
  element?.__markdownEditorHybridCleanup?.();
  if (element) delete element.__markdownEditorHybridCleanup;
  destroyHybridWidgetLifecycle(element);
}

function reportLegacyFencedEditorFailure(error, details = {}) {
  globalThis.window?.markdownEditorPerf?.diagnostic?.('hybrid.code-edit-failure', {
    category: 'editor.hybrid',
    status: 'error',
    dedupeKey: `hybrid.code-edit-failure:${error?.name || 'Error'}`,
    minIntervalMs: 5000,
    details: {
      ...details,
      message: error?.message || String(error || '代码块写回失败')
    }
  });
  showToast(error?.message || '代码块写回失败');
}

function reportMermaidRenderFailure(error, details = {}) {
  globalThis.window?.markdownEditorPerf?.diagnostic?.('hybrid.mermaid-render-failure', {
    category: 'editor.hybrid',
    status: 'warning',
    dedupeKey: `hybrid.mermaid-render-failure:${error?.name || 'Error'}`,
    minIntervalMs: 5000,
    details: {
      ...details,
      message: error?.message || String(error || 'Mermaid 图表渲染失败')
    }
  });
}

function createMermaidStatus(message, className = '') {
  const status = document.createElement('div');
  status.className = `cm-hybrid-mermaid-status${className ? ` ${className}` : ''}`;
  status.textContent = message;
  return status;
}

async function renderHybridMermaid(container, source, view, renderState) {
  const serial = ++renderState.serial;
  const sourceText = String(source || '');
  const theme = getMermaidTheme();
  container.dataset.renderState = 'loading';
  container.replaceChildren(createMermaidStatus('正在渲染 Mermaid 图表…'));
  scheduleHybridWidgetGeometry(view, 'mermaid-loading');

  try {
    const diagram = document.createElement('div');
    diagram.className = 'cm-hybrid-mermaid-diagram';
    const result = await renderMermaidDiagram(diagram, sourceText, {
      theme,
      cacheKey: `hybrid:${Math.max(0, Number(renderState.sourceFrom) || 0)}`,
      renderIdPrefix: 'markdown-editor-hybrid-mermaid',
      ariaLabel: 'Mermaid 图表',
      isCancelled: () => renderState.cancelled
        || serial !== renderState.serial
        || !container.isConnected
    });
    if (result.status === 'cancelled'
      || renderState.cancelled
      || serial !== renderState.serial
      || !container.isConnected) return;

    container.replaceChildren(diagram);
    container.dataset.renderState = 'ready';
    recordHybridInteraction('hybrid.mermaid-render-result', {
      sourceFrom: renderState.sourceFrom,
      sourceChars: sourceText.length,
      theme,
      status: result.status
    });
    requestAnimationFrame(() => scheduleHybridWidgetGeometry(
      view,
      result.status === 'cached' ? 'mermaid-cache-restored' : 'mermaid-rendered'
    ));
  } catch (error) {
    if (renderState.cancelled || serial !== renderState.serial || !container.isConnected) return;
    container.dataset.renderState = 'error';
    const errorBox = createMermaidStatus(error?.message || 'Mermaid 图表渲染失败', 'is-error');
    const hint = document.createElement('small');
    hint.textContent = '双击编辑图表源码，或点击右上角“编辑源码”。';
    errorBox.appendChild(hint);
    container.replaceChildren(errorBox);
    reportMermaidRenderFailure(error, {
      sourceFrom: renderState.sourceFrom,
      sourceChars: sourceText.length
    });
    recordHybridInteraction('hybrid.mermaid-render-result', {
      sourceFrom: renderState.sourceFrom,
      sourceChars: sourceText.length,
      theme,
      status: 'failed'
    });
    requestAnimationFrame(() => scheduleHybridWidgetGeometry(view, 'mermaid-render-failed'));
  }
}

export class MermaidBlockWidget extends WidgetType {
  constructor(descriptor, options = {}) {
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
    this.visualEditing = Boolean(options.visualEditing);
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
    const section = document.createElement('section');
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
    bindWidgetSourceAction(section, view, editDescriptor, {
      sourceKeys: [],
      title: this.visualEditing
        ? '双击直接编辑 Mermaid；点击“编辑源码”编辑 Markdown 源码'
        : '双击编辑 Mermaid 源码',
      exclude: event => this.visualEditing
        && event.target instanceof Element
        && Boolean(event.target.closest('.cm-hybrid-mermaid-body')),
      onOpen: (trigger, gesture = {}) => recordHybridInteraction('hybrid.mermaid-source-open', {
        sourceFrom: this.from,
        trigger,
        intervalMs: gesture.intervalMs ?? null,
        distancePx: gesture.distancePx ?? null
      })
    });

    const openMermaidSource = (activeEditor = null) => {
      const anchorRect = section.getBoundingClientRect();
      const committedDescriptor = activeEditor?.__markdownEditorCommitCodeBlock?.();
      requestAnimationFrame(() => {
        openWidgetSource(view, { ...(committedDescriptor || editDescriptor), componentType: 'mermaid' }, {
          getBoundingClientRect: () => anchorRect
        });
      });
    };

    const header = createWidgetToolbar({ doubleZone: 'mermaid-toolbar' });
    const labelGroup = document.createElement('span');
    labelGroup.className = 'cm-hybrid-code-label-group';
    const label = document.createElement('span');
    label.className = 'cm-hybrid-code-language';
    label.textContent = 'mermaid';
    labelGroup.appendChild(label);
    if (this.visualEditing) {
      const badge = document.createElement('span');
      badge.className = 'cm-hybrid-code-editing-badge';
      badge.textContent = '双击编辑';
      labelGroup.appendChild(badge);
    }
    header.appendChild(labelGroup);

    const actions = createWidgetActionGroup();
    actions.appendChild(createWidgetButton('复制源码', 'cm-hybrid-widget-action', async () => {
      try {
        const activeEditor = section.querySelector('[data-hybrid-code-editor]');
        await copyText(activeEditor instanceof HTMLTextAreaElement ? activeEditor.value : this.code);
        showToast('Mermaid 源码已复制');
      } catch (error) {
        showToast(error?.message || '复制失败');
      }
    }));
    actions.appendChild(createWidgetButton('编辑源码', 'cm-hybrid-widget-action', () => {
      const activeEditor = section.querySelector('[data-hybrid-code-editor]');
      recordHybridInteraction('hybrid.mermaid-source-open', {
        sourceFrom: this.from,
        trigger: 'button'
      });
      openMermaidSource(activeEditor instanceof HTMLTextAreaElement ? activeEditor : null);
    }));
    header.appendChild(actions);
    section.appendChild(header);

    const renderState = {
      cancelled: false,
      serial: 0,
      sourceFrom: this.from,
      source: this.code
    };

    const createPresentation = (codeValue = this.code) => {
      renderState.source = String(codeValue ?? '');
      const body = document.createElement('div');
      body.className = 'cm-hybrid-mermaid-body';
      body.dataset.hybridDoubleZone = 'mermaid-body';
      body.tabIndex = 0;
      body.setAttribute('aria-label', 'Mermaid 图表');
      body.title = this.visualEditing
        ? '双击直接编辑 Mermaid；点击“编辑源码”编辑 Markdown 源码'
        : '双击编辑 Mermaid 源码';
      requestAnimationFrame(() => {
        if (!body.isConnected) return;
        void renderHybridMermaid(body, codeValue, view, renderState);
      });
      if (this.visualEditing) {
        bindStrictDoubleActivation(body, (event, gesture) => {
          recordHybridInteraction('hybrid.mermaid-direct-edit-open', {
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

    const componentKey = createHybridComponentKey('mermaid', this.from);
    let unregisterDirectCloser = () => {};
    const restorePresentation = (activeEditor, codeValue = this.code, reason = 'direct-closed') => {
      unregisterDirectCloser();
      unregisterDirectCloser = () => {};
      closeHybridComponent(view, componentKey, reason, { componentType: 'mermaid' }, HYBRID_COMPONENT_MODES.DIRECT);
      if (!activeEditor?.isConnected || !section.contains(activeEditor)) return;
      const body = createPresentation(codeValue);
      activeEditor.replaceWith(body);
      section.classList.remove('is-code-editor-active');
      requestAnimationFrame(() => scheduleHybridWidgetGeometry(view, 'mermaid-direct-edit-closed'));
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
      renderState.serial += 1;
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
        createHistoryAnnotation: () => isolateHistory.of('full'),
        onFailure: reportLegacyFencedEditorFailure,
        onClose: result => {
          recordHybridInteraction('hybrid.mermaid-direct-edit-close', {
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
      body.replaceWith(editor);
      section.classList.add('is-code-editor-active');
      requestAnimationFrame(() => {
        if (!editor.isConnected) return;
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(0, 0);
        scheduleHybridWidgetGeometry(view, 'mermaid-direct-edit-opened');
      });
    };

    section.appendChild(createPresentation());

    const themeObserver = new MutationObserver(() => {
      const body = section.querySelector('.cm-hybrid-mermaid-body');
      if (body instanceof HTMLElement) void renderHybridMermaid(body, renderState.source, view, renderState);
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    attachBlockLifecycle(section, view, 'mermaid', () => {
      renderState.cancelled = true;
      renderState.serial += 1;
      themeObserver.disconnect();
    });
    return section;
  }

  destroy(dom) {
    destroyBlockLifecycle(dom);
  }

  ignoreEvent() {
    return true;
  }
}

function reportMathRenderFailure(error, details = {}) {
  globalThis.window?.markdownEditorPerf?.diagnostic?.('hybrid.math-render-failure', {
    category: 'editor.hybrid',
    status: 'warning',
    dedupeKey: `hybrid.math-render-failure:${error?.name || 'ParseError'}`,
    minIntervalMs: 5000,
    details: {
      ...details,
      message: error?.message || String(error || '公式渲染失败')
    }
  });
}

function renderMathInto(element, formula, displayMode) {
  const result = renderMathFormula(element, formula, {
    displayMode: Boolean(displayMode),
    fallbackToSource: true,
    errorClass: 'is-error',
    onError: error => reportMathRenderFailure(error, { displayMode: Boolean(displayMode) })
  });
  return result.ok;
}

export class InlineMathWidget extends WidgetType {
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
    renderMathInto(span, this.formula, false);
    bindWidgetSourceAction(span, view, {
      from: this.from,
      to: this.to,
      editFrom: this.contentFrom,
      editTo: this.contentTo,
      preferredPosition: this.contentFrom
    }, {
      sourceKeys: [],
      title: '双击编辑公式源码',
      onOpen: (trigger, gesture = {}) => recordHybridInteraction('hybrid.math-source-open', {
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
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

export class MathBlockWidget extends WidgetType {
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
    bindWidgetSourceAction(section, view, editDescriptor, {
      sourceKeys: [],
      title: '双击编辑 LaTeX 源码；也可点击“编辑源码”',
      onOpen: (trigger, gesture = {}) => recordHybridInteraction('hybrid.math-source-open', {
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
      recordHybridInteraction('hybrid.math-source-open', {
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
    renderMathInto(body, this.formula, true);
    section.appendChild(body);
    attachBlockLifecycle(section, view, 'math');
    return section;
  }

  destroy(dom) {
    destroyBlockLifecycle(dom);
  }

  ignoreEvent() {
    return true;
  }
}

function renderHtmlBlockSource(element, source) {
  const template = document.createElement('template');
  template.innerHTML = String(source || '');
  element.replaceChildren(template.content.cloneNode(true));
}

export class HtmlBlockWidget extends WidgetType {
  constructor(descriptor) {
    super();
    this.from = descriptor.from;
    this.to = descriptor.to;
    this.source = String(descriptor.source || '');
    this.fingerprint = descriptor.fingerprint || this.source;
  }

  eq(other) {
    return other.from === this.from
      && other.to === this.to
      && other.fingerprint === this.fingerprint;
  }

  toDOM(view) {
    const section = document.createElement('section');
    section.className = 'cm-hybrid-block-widget cm-hybrid-html-widget';
    section.dataset.hybridBlockType = 'html';
    section.dataset.hybridHtmlFrom = String(this.from);
    const editDescriptor = {
      componentType: 'html',
      from: this.from,
      to: this.to,
      editFrom: this.from,
      editTo: this.to,
      preferredPosition: this.from
    };
    bindWidgetSourceAction(section, view, editDescriptor, {
      sourceKeys: [],
      title: '双击编辑 HTML 源码；也可点击“编辑源码”',
      exclude: event => event.target instanceof Element
        && Boolean(event.target.closest('summary, button, a, input, textarea, select, option, label')),
      onOpen: (trigger, gesture = {}) => recordHybridInteraction('hybrid.html-source-open', {
        htmlFrom: this.from,
        trigger,
        intervalMs: gesture.intervalMs ?? null,
        distancePx: gesture.distancePx ?? null
      })
    });

    const toolbar = createWidgetToolbar({ doubleZone: 'html-toolbar' });
    const label = document.createElement('span');
    label.textContent = 'HTML';
    toolbar.appendChild(label);
    toolbar.appendChild(createWidgetButton('编辑源码', 'cm-hybrid-widget-action', () => {
      recordHybridInteraction('hybrid.html-source-open', {
        htmlFrom: this.from,
        trigger: 'button'
      });
      openWidgetSource(view, editDescriptor, section);
    }));
    section.appendChild(toolbar);

    const body = document.createElement('div');
    body.className = 'cm-hybrid-html-body markdown-body';
    body.dataset.hybridDoubleZone = 'html-body';
    renderHtmlBlockSource(body, this.source);
    section.appendChild(body);
    attachBlockLifecycle(section, view, 'html');
    return section;
  }

  destroy(dom) {
    destroyBlockLifecycle(dom);
  }

  ignoreEvent() {
    return true;
  }
}


export class ImageBlockWidget extends WidgetType {
  constructor(descriptor) {
    super();
    this.from = descriptor.from;
    this.to = descriptor.to;
    this.urlFrom = descriptor.urlFrom ?? descriptor.from;
    this.urlTo = descriptor.urlTo ?? this.urlFrom;
    this.source = String(descriptor.source || '');
    this.alt = String(descriptor.alt || '');
    this.title = String(descriptor.title || '');
  }

  eq(other) {
    return other.from === this.from
      && other.to === this.to
      && other.urlFrom === this.urlFrom
      && other.urlTo === this.urlTo
      && other.source === this.source
      && other.alt === this.alt
      && other.title === this.title;
  }

  toDOM(view) {
    let disposed = false;
    let loadGeneration = 0;
    const figure = document.createElement('figure');
    figure.className = 'cm-hybrid-block-widget cm-hybrid-image-widget is-loading';
    figure.dataset.hybridBlockType = 'image';
    const editDescriptor = {
      componentType: 'image',
      from: this.from,
      to: this.to,
      editFrom: this.urlFrom,
      editTo: this.urlTo,
      preferredPosition: this.urlFrom
    };
    bindWidgetSourceAction(figure, view, editDescriptor);

    const toolbar = createWidgetToolbar({ className: 'cm-hybrid-image-toolbar' });
    const labelGroup = document.createElement('span');
    labelGroup.className = 'cm-hybrid-image-label';
    const label = document.createElement('span');
    label.textContent = this.alt || '图片';
    labelGroup.appendChild(label);
    toolbar.appendChild(labelGroup);
    toolbar.appendChild(createWidgetButton('编辑源码', 'cm-hybrid-widget-action', () => openWidgetSource(view, editDescriptor, figure)));
    figure.appendChild(toolbar);

    const frame = document.createElement('div');
    frame.className = 'cm-hybrid-image-frame';
    figure.appendChild(frame);

    const renderError = (error) => {
      if (disposed) return;
      figure.classList.remove('is-loading');
      figure.classList.add('is-error');
      frame.textContent = '';
      const wrapper = document.createElement('div');
      wrapper.className = 'cm-hybrid-image-error';
      const message = document.createElement('strong');
      message.textContent = error?.message || '图片加载失败';
      const source = document.createElement('code');
      source.textContent = this.source;
      const retry = createWidgetButton('重新加载', 'cm-hybrid-widget-action cm-hybrid-image-retry', () => {
        invalidateHybridImageSource(this.source);
        loadImage();
      });
      wrapper.append(message, source, retry);
      frame.appendChild(wrapper);
      scheduleHybridWidgetGeometry(view, 'image-error');
    };

    const loadImage = async () => {
      const generation = ++loadGeneration;
      figure.classList.add('is-loading');
      figure.classList.remove('is-error');
      labelGroup.querySelector('.cm-hybrid-image-source-badge')?.remove();
      frame.textContent = '';
      try {
        const resolved = await resolveHybridImageSource(this.source);
        if (disposed || generation !== loadGeneration) return;
        const image = document.createElement('img');
        image.alt = this.alt;
        image.title = this.title;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('load', () => {
          if (disposed || generation !== loadGeneration) return;
          figure.classList.remove('is-loading', 'is-error');
          scheduleHybridWidgetGeometry(view, 'image-loaded');
        }, { once: true });
        image.addEventListener('error', () => {
          if (generation === loadGeneration) renderError(new Error(`图片加载失败：${this.source}`));
        }, { once: true });
        if (resolved.kind === 'local') {
          const badge = document.createElement('small');
          badge.className = 'cm-hybrid-image-source-badge';
          badge.textContent = '本地';
          badge.title = resolved.resolvedPath || this.source;
          labelGroup.appendChild(badge);
        }
        image.src = resolved.url;
        frame.appendChild(image);
      } catch (error) {
        if (generation === loadGeneration) renderError(error);
      }
    };

    if (this.title && this.title !== this.alt) {
      const caption = document.createElement('figcaption');
      caption.textContent = this.title;
      figure.appendChild(caption);
    }

    attachBlockLifecycle(figure, view, 'image', () => {
      disposed = true;
      loadGeneration += 1;
    });
    loadImage();
    return figure;
  }

  destroy(dom) {
    destroyBlockLifecycle(dom);
  }

  ignoreEvent() {
    return false;
  }
}
