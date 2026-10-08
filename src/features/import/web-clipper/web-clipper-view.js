/** Own clipper DOM, translations, ModalShell and listeners; source HTML belongs only to the controller. */
import { ModalShell } from '../../../ui/components/modal-shell.js';
import { createIconView } from '../../../ui/components/icon-view.js';
import { createEventScope, createSafeElement, requireElementRef } from '../../../ui/dom/index.js';

function createDialog(overlayRoot) {
  const documentRef = overlayRoot.ownerDocument;
  const node = (parent, tag, options = {}) => {
    const element = createSafeElement(documentRef, tag, options);
    parent?.append(element);
    return element;
  };
  const root = node(null, 'div', { id: 'url-modal', className: 'modal-overlay' });
  const panel = node(root, 'div', { className: 'modal' });
  const header = node(panel, 'div', { className: 'modal-header' });
  const title = node(header, 'h3', { id: 'url-modal-title' });
  title.append(createIconView(documentRef, 'icon-globe', { className: 'icon icon-lg' }), documentRef.createTextNode(' '));
  node(title, 'span', { attributes: { 'data-i18n': 'urlTitle' } });
  const closeButton = node(header, 'button', { attributes: { type: 'button', 'data-clipper-close': true } });
  closeButton.append(createIconView(documentRef, 'icon-close'));
  const body = node(panel, 'div', { className: 'modal-body' });
  node(body, 'label', { attributes: { for: 'url-input', 'data-i18n': 'urlLabel' } });
  const url = node(body, 'input', { id: 'url-input', attributes: { type: 'url', 'data-i18n-placeholder': 'urlPlaceholder' } });
  const option = node(body, 'div', { className: 'c-form-inline-option' });
  const local = node(option, 'input', { id: 'use-local-proxy', className: 'c-inline-checkbox', attributes: { type: 'checkbox' } });
  node(option, 'label', { className: 'c-inline-label', attributes: { for: local.id, 'data-i18n': 'useProxy' } });
  const proxy = node(body, 'input', { id: 'proxy-url', className: 'c-proxy-input is-hidden',
    attributes: { type: 'url', 'data-i18n-placeholder': 'proxyPlaceholder' } });
  const fetchButton = node(body, 'button', { className: 'primary',
    attributes: { type: 'button', 'data-clipper-fetch': true, 'data-i18n': 'fetchBtn' } });
  const status = node(body, 'div', { id: 'url-status', className: 'c-form-status' });
  const area = node(body, 'div', { id: 'manual-area', className: 'c-manual-input is-hidden' });
  node(area, 'label', { attributes: { for: 'manual-html', 'data-i18n': 'manualLabel' } });
  const manual = node(area, 'textarea', { id: 'manual-html', attributes: { rows: '6', 'data-i18n-placeholder': 'manualPlaceholder' } });
  const footer = node(panel, 'div', { className: 'modal-footer' });
  node(footer, 'button', { attributes: { type: 'button', 'data-clipper-close': true, 'data-i18n': 'cancel' } });
  const insertButton = node(footer, 'button', { className: 'primary',
    attributes: { type: 'button', 'data-clipper-insert': true, 'data-i18n': 'convertInsert' } });
  return { root, panel, url, proxy, local, manual, status, area, fetchButton, insertButton, closeButton };
}

export function createWebClipperView({ overlayRoot, controller, translate, notify, subscribeLocale = () => () => {} } = {}) {
  requireElementRef(overlayRoot, 'Web clipper overlay root');
  if (overlayRoot.ownerDocument.getElementById('url-modal')) throw new Error('Web clipper view is already mounted.');
  const { root, panel, url, proxy, local, manual, status, area, fetchButton, insertButton, closeButton } = createDialog(overlayRoot);
  const events = createEventScope();
  let destroyed = false, modal = null, unsubscribe = null, unsubscribeLocale = null;
  const renderState = state => {
    for (const [element, value] of [[url, state.url], [proxy, state.proxyUrl], [manual, state.manualHtml]]) if (element.value !== value) element.value = value;
    local.checked = state.useLocalProxy;
    proxy.classList.toggle('is-hidden', state.native || !state.useLocalProxy);
    area.classList.toggle('is-hidden', !state.showManual);
    const key = state.status === 'fetching' ? 'urlStatusFetching' : state.status === 'empty' ? 'urlStatusEmptyUrl' : state.status === 'success' ? (state.source === 'public-proxy' ? 'urlStatusPublicSuccess' : 'urlStatusLocalSuccess') : state.status === 'manual-required' ? (state.source === 'public-proxy' ? 'urlStatusPublicFailed' : 'urlStatusLocalFailed') : '';
    status.textContent = key ? translate(key, state.error) + (state.hint ? '\n' + state.hint : '') : '';
    status.classList.remove('is-muted', 'is-success', 'is-error');
    status.classList.add(state.status === 'success' ? 'is-success' : ['empty', 'manual-required'].includes(state.status) ? 'is-error' : 'is-muted');
  };
  const renderTranslations = () => {
    for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = translate(element.dataset.i18n);
    for (const element of root.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = translate(element.dataset.i18nPlaceholder);
    closeButton.setAttribute('aria-label', translate('cancel'));
    renderState(controller.snapshot);
  };
  const cleanup = () => {
    const errors = [];
    for (const release of [() => unsubscribe?.(), () => unsubscribeLocale?.(), () => events.destroy(),
      () => modal?.destroy(), () => controller.destroy(), () => root.remove()]) {
      try { release(); } catch (error) { errors.push(error); }
    }
    return errors;
  };
  try {
    modal = new ModalShell(root, { panel });
    overlayRoot.append(root);
    unsubscribe = controller.subscribe(renderState);
    renderTranslations();
    unsubscribeLocale = subscribeLocale(renderTranslations);
    if (typeof unsubscribeLocale !== 'function') throw new TypeError('Web clipper locale subscription requires a disposer.');
    const on = events.listen;
    for (const [node, name] of [[url, 'url'], [proxy, 'proxyUrl'], [local, 'useLocalProxy'], [manual, 'manualHtml']]) {
      for (const event of ['input', 'change']) on(node, event, () => controller.setInput(name, node === local ? node.checked : node.value));
    }
    const close = () => { if (!modal.close('feature-close')) controller.close(); };
    for (const button of root.querySelectorAll('[data-clipper-close]')) on(button, 'click', close);
    on(fetchButton, 'click', () => { void controller.fetch().catch(error => { if (!destroyed) notify(translate('toastConvertFailed', error.message)); }); });
    on(insertButton, 'click', () => {
      const result = controller.insert();
      if (result.status === 'inserted') { close(); notify(translate('toastInsertedMd')); }
      else if (result.status !== 'closed') notify(translate(result.status === 'empty' ? 'toastNoContent' : result.status === 'no-content' ? 'toastExtractFailed' : 'toastConvertFailed', result.error));
    });
  } catch (error) {
    destroyed = true;
    const errors = [error, ...cleanup()];
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Failed to construct Web clipper view cleanly.');
  }
  return Object.freeze({
    root,
    isOpen: () => !destroyed && modal.isOpen(),
    open() {
      if (destroyed) throw new Error('Web clipper view is destroyed.');
      if (modal.isOpen()) return;
      controller.open();
      try { renderTranslations(); modal.open(null, { labelledBy: 'url-modal-title', initialFocus: url, onClose: () => controller.close() }); }
      catch (error) { controller.close(); throw error; }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = cleanup();
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy Web clipper view cleanly.');
    }
  });
}
