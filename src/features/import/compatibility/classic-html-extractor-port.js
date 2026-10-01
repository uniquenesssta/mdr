const PROPERTY = 'markdownEditorHtmlExtractorPort';
/** Scoped extraction access until the classic clipper is removed in 13.12/13.14. */
export function mountClassicHtmlExtractorPort(host, extract) {
  if (!host || typeof host !== 'object' || typeof extract !== 'function') throw new TypeError('HTML extractor port requires a host and extractor.');
  if (Object.hasOwn(host, PROPERTY)) throw new Error('HTML extractor port is already mounted.');
  let destroyed = false;
  const api = Object.freeze({ extract(html) {
    if (destroyed) throw new Error('HTML extractor port is destroyed.');
    return extract(html);
  } });
  Object.defineProperty(host, PROPERTY, { configurable: true, value: api });
  return Object.freeze({ api, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PROPERTY] === api) delete host[PROPERTY];
  } });
}
