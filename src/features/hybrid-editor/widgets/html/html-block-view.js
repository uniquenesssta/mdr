/**
 * Atomic 8.13 HTML block presentation.
 * Owns HTML block DOM projection through the shared passive document HTML boundary.
 * No markup-policy, Session, source-edit, CodeMirror or lifecycle authority belongs here.
 */
import { createWidgetButton } from '../shared/widget-button.js';
import { createWidgetToolbar } from '../shared/widget-toolbar.js';
import { createDocumentHtmlFragment } from '../../../../shared/security/document-html.js';

export function renderHtmlBlockSource(element, source, documentRef = globalThis.document) {
  element.replaceChildren(createDocumentHtmlFragment(source, documentRef));
}

export function createHtmlBlockView(options = {}) {
  const documentRef = options.documentRef || globalThis.document;
  const section = documentRef.createElement('section');
  section.className = 'cm-hybrid-block-widget cm-hybrid-html-widget';
  section.dataset.hybridBlockType = 'html';
  section.dataset.hybridHtmlFrom = String(options.from ?? 0);

  const toolbar = createWidgetToolbar({ doubleZone: 'html-toolbar' });
  const label = documentRef.createElement('span');
  label.textContent = 'HTML';
  toolbar.appendChild(label);
  toolbar.appendChild(createWidgetButton('编辑源码', 'cm-hybrid-widget-action', () => {
    options.onSourceEdit?.();
  }));
  section.appendChild(toolbar);

  const body = documentRef.createElement('div');
  body.className = 'cm-hybrid-html-body markdown-body';
  body.dataset.hybridDoubleZone = 'html-body';
  renderHtmlBlockSource(body, options.source, documentRef);
  section.appendChild(body);

  return section;
}
