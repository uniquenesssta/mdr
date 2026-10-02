/** One activation bridge until classic document insertion migrates; owns view disposal. */
export function mountClassicWebClipperPort(host, createView) {
  const property = 'markdownEditorWebClipperPort';
  if (Object.hasOwn(host, property)) throw new Error('Web clipper port is already mounted.');
  let view, destroyed = false;
  const api = Object.freeze({
    start(options) { if (destroyed || view) throw new Error('Web clipper cannot start.'); view = createView(options); },
    open() { if (destroyed || !view) throw new Error('Web clipper is unavailable.'); view.open(); }
  });
  Object.defineProperty(host, property, { configurable: true, value: api });
  return Object.freeze({ destroy() {
    if (destroyed) return; destroyed = true;
    try { view?.destroy(); } finally { if (host[property] === api) delete host[property]; }
  } });
}
