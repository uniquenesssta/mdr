import { createIconView } from '../ui/components/icon-view.js';
import {
  createEventScope,
  createFocusScope,
  createSafeElement,
  createTransitionVisibility,
  isElementRef
} from '../ui/dom/index.js';

const SUPPORTED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const PREVIEWABLE_SCHEMES = new Set(['http:', 'https:']);

let overlay = null;
let frame = null;
let titleElement = null;
let urlElement = null;
let closeButton = null;
let externalButton = null;
let currentUrl = '';
let focusScope = null;
let visibility = null;
let focusGeneration = 0;
const documentEvents = createEventScope();

function report(event, details = {}, status = 'ok') {
  window.markdownEditorPerf?.record?.(event, {
    category: 'link.preview',
    status,
    details
  });
}

function showMessage(message) {
  if (typeof window.showToast === 'function') window.showToast(message);
  else console.warn(message);
}

function parseDocumentUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('#')) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { raw, supported: false, reason: '链接必须使用完整的 http、https、mailto 或 tel 地址' };
  }

  if (!SUPPORTED_SCHEMES.has(parsed.protocol)) {
    return { raw, supported: false, reason: '不支持打开此链接' };
  }

  return {
    raw,
    url: parsed.href,
    protocol: parsed.protocol,
    supported: true,
    previewable: PREVIEWABLE_SCHEMES.has(parsed.protocol)
  };
}

async function openInSystemBrowser(url) {
  const value = String(url || '').trim();
  if (!value) return;
  report('link.preview-external-open', {
    scheme: value.split(':', 1)[0].toLowerCase(),
    inputLength: value.length
  });

  if (window.markdownEditorNative?.isAvailable) {
    await window.markdownEditorNative.openExternalUrl(value);
    return;
  }

  const opened = window.open(value, '_blank', 'noopener,noreferrer');
  if (!opened) throw new Error('浏览器阻止了链接打开');
}

function createButton(className, label, title) {
  return createSafeElement(document, 'button', {
    className,
    attributes: {
      type: 'button',
      'aria-label': label,
      title: title || label
    }
  });
}

function ensureOverlay() {
  if (overlay) return overlay;

  overlay = createSafeElement(document, 'section', {
    id: 'link-preview-overlay',
    className: 'link-preview-overlay',
    attributes: {
      'aria-hidden': 'true',
      'aria-label': '链接预览'
    }
  });
  visibility = createTransitionVisibility(overlay, {
    visibleClass: 'show',
    hiddenAttribute: 'aria-hidden',
    timeout: 180
  });
  const overlayEvents = createEventScope();

  const toolbar = createSafeElement(document, 'header', { className: 'link-preview-toolbar' });
  const identity = createSafeElement(document, 'div', { className: 'link-preview-identity' });

  titleElement = createSafeElement(document, 'strong', {
    className: 'link-preview-title',
    text: '链接预览'
  });
  urlElement = createSafeElement(document, 'span', { className: 'link-preview-url' });
  identity.append(titleElement, urlElement);

  const actions = createSafeElement(document, 'div', { className: 'link-preview-actions' });
  externalButton = createButton('link-preview-external', '在系统浏览器打开', '在系统浏览器打开');
  externalButton.textContent = '在浏览器打开';
  overlayEvents.listen(externalButton, 'click', () => {
    openInSystemBrowser(currentUrl).catch(error => showMessage(error?.message || String(error)));
  });

  closeButton = createButton('link-preview-close', '关闭链接预览', '关闭并返回编辑器');
  closeButton.append(createIconView(document, 'icon-close'));
  overlayEvents.listen(closeButton, 'click', () => closeLinkPreview('close-button'));

  actions.append(externalButton, closeButton);
  toolbar.append(identity, actions);

  const notice = createSafeElement(document, 'div', {
    className: 'link-preview-notice',
    text: '网页拒绝嵌入或显示异常时，可使用右上角“在浏览器打开”。'
  });
  const body = createSafeElement(document, 'div', { className: 'link-preview-body' });

  frame = createSafeElement(document, 'iframe', {
    className: 'link-preview-frame',
    attributes: {
      title: '外部链接内容',
      referrerpolicy: 'no-referrer',
      sandbox: 'allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin',
      allow: 'clipboard-read; clipboard-write'
    }
  });
  overlayEvents.listen(frame, 'load', () => {
    if (!currentUrl || currentUrl === 'about:blank') return;
    overlay?.classList.remove('is-loading');
    report('link.preview-loaded', {
      host: safeHost(currentUrl),
      inputLength: currentUrl.length
    });
  });

  body.append(frame);
  overlay.append(toolbar, notice, body);
  document.body.appendChild(overlay);
  return overlay;
}

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

function openLinkPreview(value, options = {}) {
  const parsed = parseDocumentUrl(value);
  if (!parsed?.supported) {
    showMessage(parsed?.reason || '链接地址无效');
    return false;
  }

  if (!parsed.previewable) {
    openInSystemBrowser(parsed.url).catch(error => showMessage(error?.message || String(error)));
    return true;
  }

  ensureOverlay();
  currentUrl = parsed.url;
  focusGeneration += 1;
  focusScope?.destroy({ restoreFocus: false });
  focusScope = createFocusScope(overlay, {
    initialFocus: closeButton,
    returnFocus: isElementRef(options.sourceElement) ? options.sourceElement : document.activeElement,
    trap: true
  });
  titleElement.textContent = safeHost(parsed.url) || '链接预览';
  urlElement.textContent = parsed.url;
  urlElement.title = parsed.url;
  overlay.classList.add('is-loading');
  visibility.show();
  document.documentElement.classList.add('link-preview-open');
  frame.src = parsed.url;
  requestAnimationFrame(() => {
    if (visibility?.isVisible() && !focusScope?.isDestroyed()) focusScope?.focusInitial({ preventScroll: true });
  });

  report('link.preview-open', {
    host: safeHost(parsed.url),
    source: String(options.source || 'document-link'),
    inputLength: parsed.url.length
  });
  return true;
}

function closeLinkPreview(reason = 'api') {
  if (!visibility?.isVisible()) return false;
  const closedUrl = currentUrl;
  const closingGeneration = focusGeneration;
  const closingFocusScope = focusScope;
  focusScope = null;
  overlay.classList.remove('is-loading');
  const hidden = visibility.hide();
  document.documentElement.classList.remove('link-preview-open');
  currentUrl = '';

  hidden.then(completed => {
    if (completed && frame) frame.src = 'about:blank';
  });
  requestAnimationFrame(() => {
    closingFocusScope?.destroy({
      restoreFocus: closingGeneration === focusGeneration && !visibility?.isVisible()
    });
  });

  report('link.preview-close', {
    reason,
    host: safeHost(closedUrl)
  });
  return true;
}

function findDocumentLink(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest('#link-preview-overlay')) return null;

  const anchor = target.closest('a[href]');
  if (anchor && !anchor.hasAttribute('download')) {
    const inPreview = Boolean(anchor.closest('#preview'));
    const inEditor = Boolean(anchor.closest('#editor'));
    if (!inPreview && !inEditor) return null;
    return {
      element: anchor,
      value: anchor.getAttribute('href'),
      source: inPreview ? 'live-preview' : 'hybrid-html-link',
      requiresModifier: false
    };
  }

  const hybridLink = target.closest('[data-hybrid-link-url]');
  if (!hybridLink || !hybridLink.closest('#editor')) return null;
  return {
    element: hybridLink,
    value: hybridLink.getAttribute('data-hybrid-link-url'),
    source: 'hybrid-markdown-link',
    requiresModifier: false
  };
}

function handleDocumentLinkPointerDown(event) {
  if (event.defaultPrevented || event.button !== 0) return;
  const link = findDocumentLink(event);
  if (!link) return;

  // A hybrid link is rendered inside CodeMirror's content DOM. Without an
  // early pointer guard, CodeMirror processes mousedown first, moves the
  // selection into the hidden Markdown range and reveals the source before
  // the later click handler can open the preview. Keep the link read-only on
  // pointer down; the click handler below owns navigation.
  event.preventDefault();
  event.stopPropagation();
}

function handleDocumentLinkClick(event) {
  if (event.defaultPrevented || event.button !== 0) return;
  const link = findDocumentLink(event);
  if (!link) return;
  if (link.requiresModifier && !event.ctrlKey && !event.metaKey) return;

  const parsed = parseDocumentUrl(link.value);
  if (!parsed) return; // Preserve same-document hash navigation.

  event.preventDefault();
  event.stopPropagation();

  if (!parsed.supported) {
    showMessage(parsed.reason);
    report('link.preview-blocked', {
      source: link.source,
      reason: parsed.reason,
      inputLength: String(link.value || '').length
    }, 'error');
    return;
  }

  if (event.ctrlKey || event.metaKey || event.shiftKey) {
    openInSystemBrowser(parsed.url).catch(error => showMessage(error?.message || String(error)));
    return;
  }

  openLinkPreview(parsed.url, {
    source: link.source,
    sourceElement: link.element
  });
}

function handleKeydown(event) {
  if (event.key !== 'Escape' || !visibility?.isVisible()) return;
  event.preventDefault();
  event.stopPropagation();
  closeLinkPreview('escape');
}

documentEvents.listen(document, 'mousedown', handleDocumentLinkPointerDown, true);
documentEvents.listen(document, 'click', handleDocumentLinkClick, true);
documentEvents.listen(document, 'keydown', handleKeydown, true);

window.markdownEditorLinkPreview = Object.freeze({
  open: openLinkPreview,
  close: closeLinkPreview,
  openExternal: openInSystemBrowser,
  isOpen: () => Boolean(visibility?.isVisible())
});
