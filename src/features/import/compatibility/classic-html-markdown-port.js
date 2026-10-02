const PROPERTY = 'markdownEditorHtmlMarkdownPort';
/** Scoped conversion access until the classic clipper is removed in 13.12/13.14. */
export function mountClassicHtmlMarkdownPort(host, convert) {
  if (!host || typeof host !== 'object' || typeof convert !== 'function') throw new TypeError('HTML Markdown port requires a host and converter.');
  if (Object.hasOwn(host, PROPERTY)) throw new Error('HTML Markdown port is already mounted.');
  let destroyed = false;
  const api = Object.freeze({ convert(extracted) {
    if (destroyed) throw new Error('HTML Markdown port is destroyed.');
    return convert(extracted);
  } });
  Object.defineProperty(host, PROPERTY, { configurable: true, value: api });
  return Object.freeze({ api, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PROPERTY] === api) delete host[PROPERTY];
  } });
}
