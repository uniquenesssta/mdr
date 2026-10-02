/** Owns one clipper session and its source; synchronous insertion is injected. */
export function createWebClipperController({ fetchCoordinator, extract, convert, insertMarkdown, native = false } = {}) {
  if (!fetchCoordinator || [extract, convert, insertMarkdown].some(fn => typeof fn !== 'function')) throw new TypeError('Clipper dependencies are required.');
  let destroyed = false, generation = 0, html = '';
  let state = { open: false, url: '', proxyUrl: 'http://localhost:8765/fetch', useLocalProxy: native, manualHtml: '', status: 'idle', source: '', error: '', hint: '', showManual: false };
  const listeners = new Set();
  const snapshot = () => Object.freeze({ ...state, hasContent: Boolean(html), native });
  const assertActive = () => { if (destroyed) throw new Error('Web clipper is destroyed.'); };
  const publish = () => { const value = snapshot(); for (const listener of listeners) listener(value); };
  const invalidate = () => { generation++; html = ''; fetchCoordinator.cancel(); };
  return Object.freeze({
    get snapshot() { return snapshot(); },
    subscribe(listener) { assertActive(); listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    open() { assertActive(); invalidate(); state = { ...state, open: true, url: '', manualHtml: '', useLocalProxy: native, status: 'idle', source: '', error: '', hint: '', showManual: false }; publish(); },
    close() { if (destroyed) return; invalidate(); state = { ...state, open: false, manualHtml: '', status: 'idle', error: '', hint: '' }; publish(); },
    setInput(name, value) {
      assertActive(); if (!state.open) return;
      if (!['url', 'proxyUrl', 'useLocalProxy', 'manualHtml'].includes(name)) throw new TypeError('Unknown clipper input.');
      invalidate(); state = { ...state, [name]: name === 'useLocalProxy' ? Boolean(value) : String(value), status: 'idle', error: '', hint: '' }; publish();
    },
    async fetch() {
      assertActive(); if (!state.open) return;
      invalidate(); const request = generation;
      state = { ...state, status: 'fetching', error: '', hint: '' }; publish();
      try {
        const result = await fetchCoordinator.fetchUrl(state.url, { useLocalProxy: state.useLocalProxy, proxyUrl: state.proxyUrl });
        if (destroyed || !state.open || request !== generation || !fetchCoordinator.isCurrent(result)) return;
        html = result.status === 'success' ? result.html : '';
        state = { ...state, status: result.status, source: result.source || '', error: result.error || '', hint: result.hint || '', showManual: result.status === 'success' ? false : result.status === 'empty' ? state.showManual : true }; publish();
      } catch (error) {
        if (destroyed || !state.open || request !== generation) return;
        state = { ...state, status: 'manual-required', error: String(error?.message || error), showManual: true }; publish();
      }
    },
    insert() {
      assertActive(); if (!state.open) return { status: 'closed' };
      const source = html || state.manualHtml.trim();
      if (!source) return { status: 'empty' };
      // Manual conversion supersedes any in-flight fetch before document mutation.
      invalidate();
      try {
        const markdown = convert(extract(source));
        if (!markdown) return { status: 'no-content' };
        insertMarkdown(markdown);
        state = { ...state, open: false, manualHtml: '', status: 'idle' }; publish();
        return { status: 'inserted' };
      } catch (error) { html = source; return { status: 'error', error: String(error?.message || error) }; }
    },
    destroy() { if (destroyed) return; invalidate(); destroyed = true; state = { ...state, open: false, manualHtml: '' }; listeners.clear(); }
  });
}
