/** DOM projection and modal/listener lifetime; source HTML lives only in the controller. */
export function createWebClipperView({ root, controller, translate, notify } = {}) {
  const get = id => { const node = root.querySelector('#' + id); if (!node) throw new Error('Missing clipper element: ' + id); return node; };
  const url = get('url-input'), proxy = get('proxy-url'), local = get('use-local-proxy'), manual = get('manual-html');
  const status = get('url-status'), area = get('manual-area');
  let destroyed = false;
  const removers = [];
  const on = (node, event, handler) => { node.addEventListener(event, handler); removers.push(() => node.removeEventListener(event, handler)); };
  const dispatch = (name, detail) => {
    root.dispatchEvent(new root.ownerDocument.defaultView.CustomEvent('markdown-editor:modal-shell-' + name, { detail }));
    if (detail.error) throw detail.error;
  };
  const unsubscribe = controller.subscribe(state => {
    for (const [element, value] of [[url, state.url], [proxy, state.proxyUrl], [manual, state.manualHtml]]) if (element.value !== value) element.value = value;
    local.checked = state.useLocalProxy;
    proxy.classList.toggle('is-hidden', state.native || !state.useLocalProxy);
    area.classList.toggle('is-hidden', !state.showManual);
    const key = state.status === 'fetching' ? 'urlStatusFetching' : state.status === 'empty' ? 'urlStatusEmptyUrl' : state.status === 'success' ? (state.source === 'public-proxy' ? 'urlStatusPublicSuccess' : 'urlStatusLocalSuccess') : state.status === 'manual-required' ? (state.source === 'public-proxy' ? 'urlStatusPublicFailed' : 'urlStatusLocalFailed') : '';
    status.textContent = key ? translate(key, state.error) + (state.hint ? '\n' + state.hint : '') : '';
    status.classList.remove('is-muted', 'is-success', 'is-error');
    status.classList.add(state.status === 'success' ? 'is-success' : ['empty', 'manual-required'].includes(state.status) ? 'is-error' : 'is-muted');
  });
  for (const [node, name] of [[url, 'url'], [proxy, 'proxyUrl'], [local, 'useLocalProxy'], [manual, 'manualHtml']]) {
    for (const event of ['input', 'change']) on(node, event, () => controller.setInput(name, node === local ? node.checked : node.value));
  }
  const close = () => { controller.close(); dispatch('close', { reason: 'feature-close' }); };
  for (const button of root.querySelectorAll('[data-clipper-close]')) on(button, 'click', close);
  on(root.querySelector('[data-clipper-fetch]'), 'click', () => { void controller.fetch().catch(error => notify(translate('toastConvertFailed', error.message))); });
  on(root.querySelector('[data-clipper-insert]'), 'click', () => {
    const result = controller.insert();
    if (result.status === 'inserted') { close(); notify(translate('toastInsertedMd')); }
    else if (result.status !== 'closed') notify(translate(result.status === 'empty' ? 'toastNoContent' : result.status === 'no-content' ? 'toastExtractFailed' : 'toastConvertFailed', result.error));
  });
  return Object.freeze({
    open() {
      if (destroyed) throw new Error('Web clipper view is destroyed.');
      controller.open();
      try { dispatch('open', { options: { initialFocus: url, onClose: () => controller.close() } }); }
      catch (error) { controller.close(); throw error; }
    },
    destroy() { if (destroyed) return; destroyed = true; unsubscribe(); for (const remove of removers) remove(); try { if (controller.snapshot.open) close(); } finally { controller.destroy(); } }
  });
}
