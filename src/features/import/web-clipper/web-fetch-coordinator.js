/**
 * Own web-source selection and one cancellable request generation; no DOM or conversion.
 * Desktop failures never fall through to browser proxies. All paths return explicit outcomes.
 * Native policy belongs to Rust; browser proxy compatibility is not native security evidence.
 */
export function createWebFetchCoordinator({ nativeFetch, browserFetch = globalThis.fetch,
  decodeBase64 = globalThis.atob, timeoutMs = 30000,
  onCleanupError = error => console.warn('Web fetch cancellation failed:', error) } = {}) {
  if (nativeFetch !== undefined && typeof nativeFetch !== 'function') throw new TypeError('Invalid native web fetch port.');
  if (typeof browserFetch !== 'function') throw new TypeError('Web fetch requires a browser transport.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid web fetch deadline.');
  let generation = 0, active = null, destroyed = false;
  const assertActive = () => { if (destroyed) throw new Error('Web Fetch Coordinator is destroyed.'); };
  const message = error => String(error?.message || error || 'Unknown fetch error');
  const result = (id, status, source, extra = {}) => Object.freeze({ generation: id, status, source, html: '', error: '', hint: '', ...extra });
  function cancel() {
    generation++;
    const previous = active;
    active = null;
    previous?.abort();
  }
  const isCurrent = value => !destroyed && value?.generation === generation && value.status !== 'cancelled';
  async function transport(url, { useLocalProxy, proxyUrl }, signal) {
    if (nativeFetch) {
      const html = await nativeFetch(url, { signal });
      if (typeof html !== 'string' || !html) throw new Error('Native backend returned empty content');
      return { html };
    }
    if (useLocalProxy) {
      const response = await browserFetch((String(proxyUrl || '').trim() || 'http://localhost:8765/fetch') + '?url=' + encodeURIComponent(url), { signal });
      if (!response.ok) throw new Error('Local proxy response not ok');
      const data = await response.json();
      const html = data?.html || data?.content || '';
      if (data?.success === false || typeof html !== 'string' || !html) {
        throw Object.assign(new Error(data?.error || 'Local proxy returned empty content'), { hint: String(data?.hint || '') });
      }
      return { html };
    }
    const encoded = encodeURIComponent(url);
    const proxies = [
      { url: 'https://api.allorigins.win/raw?url=' + encoded },
      { url: 'https://api.allorigins.win/get?url=' + encoded, json: true },
      { url: 'https://api.codetabs.com/v1/proxy?quest=' + encoded }
    ];
    let lastError;
    for (const proxy of proxies) {
      if (signal.aborted) throw signal.reason;
      try {
        const response = await browserFetch(proxy.url, { signal });
        if (!response.ok) throw new Error('Proxy response not ok');
        let html = proxy.json ? (await response.json())?.contents : await response.text();
        if (proxy.json && typeof html === 'string' && /^[A-Za-z0-9+/=]+$/.test(html) && html.length % 4 === 0) {
          try { html = decodeBase64(html); } catch { /* Preserve the proxy's original text when it is not valid base64. */ }
        }
        if (typeof html !== 'string' || html.length < 100) throw new Error('Content too short');
        return { html };
      } catch (error) {
        if (signal.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }
  async function fetchUrl(input, options = {}) {
    assertActive();
    cancel();
    const id = generation, url = String(input || '').trim();
    const source = nativeFetch ? 'native' : options.useLocalProxy ? 'local-proxy' : 'public-proxy';
    if (!url) return result(id, 'empty', source);
    const abort = new AbortController();
    active = abort;
    let timedOut = false, rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(abort.signal.reason);
    const forwardAbort = () => abort.abort();
    abort.signal.addEventListener('abort', onAbort, { once: true });
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
    try {
      if (options.signal?.aborted) abort.abort();
      const request = abort.signal.aborted ? aborted : transport(url, options, abort.signal).catch(error => {
        if (abort.signal.aborted && error?.name !== 'AbortError' && error?.code !== 'WEB_FETCH_CANCELLED' && error !== 'WEB_FETCH_CANCELLED') {
          onCleanupError(error);
        }
        throw error;
      });
      const value = await Promise.race([request, aborted]);
      if (destroyed || id !== generation || abort.signal.aborted) return result(id, 'cancelled', source);
      return result(id, 'success', source, value);
    } catch (error) {
      if (destroyed || id !== generation || (abort.signal.aborted && !timedOut)) return result(id, 'cancelled', source);
      return result(id, 'manual-required', source, { error: timedOut ? `Web fetch exceeded ${timeoutMs / 1000} seconds` : message(error), hint: String(error?.hint || '') });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', forwardAbort);
      abort.signal.removeEventListener('abort', onAbort);
      if (active === abort) active = null;
    }
  }
  return Object.freeze({
    fetchUrl, cancel, isCurrent,
    manualHtml(input) {
      assertActive();
      cancel();
      const html = String(input || '').trim();
      return result(generation, html ? 'success' : 'empty', 'manual', { html });
    },
    destroy() { if (destroyed) return; destroyed = true; cancel(); }
  });
}
