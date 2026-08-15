import { WidgetType } from '@codemirror/view';
import {
  bindWidgetSourceAction,
  attachHybridWidgetLifecycle,
  destroyHybridWidgetLifecycle,
  createWidgetButton,
  createWidgetToolbar,
  openWidgetSource
} from '../../features/hybrid-editor/index.js';

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
  element?.__markdownEditorHybridCleanup ();
  if (element) delete element.__markdownEditorHybridCleanup;
  destroyHybridWidgetLifecycle(element);
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
