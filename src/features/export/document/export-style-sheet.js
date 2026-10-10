/** One authoritative document stylesheet; live roots have reversible, owner-scoped leases. */
const FORMATS = new Set(['html', 'word', 'pdf', 'image']);
const ROOT_CLASS = 'export-document';

const DOCUMENT_CSS = `
.export-document {
  --export-paper: #fff; --export-ink: #212529; --export-muted: #6c757d;
  --export-border: #dee2e6; --export-code: #f1f3f5; --export-link: #0d6efd;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
  line-height: 1.7; box-sizing: border-box; background: var(--export-paper); color: var(--export-ink);
}
.export-document .markdown-body { max-width: none; width: 100%; margin: 0; }
.export-document h1, .export-document h2, .export-document h3,
.export-document h4, .export-document h5, .export-document h6 {
  margin: 24px 0 12px; font-weight: 600; line-height: 1.25; color: inherit;
}
.export-document h1 { font-size: 2em; border-bottom: 1px solid var(--export-border); padding-bottom: 8px; }
.export-document h2 { font-size: 1.5em; border-bottom: 1px solid var(--export-border); padding-bottom: 6px; }
.export-document h3 { font-size: 1.25em; }
.export-document p { margin: 0 0 14px; }
.export-document a { color: var(--export-link); text-decoration: underline; }
.export-document ul, .export-document ol { margin: 0 0 14px; padding-left: 2em; }
.export-document li { margin: 4px 0; }
.export-document li.task-item { list-style: none; margin-left: -1.4em; }
.export-document ul.task-list { padding-left: 1.8em; }
.export-document input[type="checkbox"] { margin-right: 8px; vertical-align: middle; }
.export-document code { background: var(--export-code); padding: 2px 6px; border-radius: 4px; font-family: Consolas, "Courier New", monospace; font-size: .9em; }
.export-document pre { background: var(--export-code); padding: 14px; border: 1px solid var(--export-border); border-radius: 8px; overflow-x: auto; margin: 0 0 14px; }
.export-document pre.preview-code-widget { padding: 0; }
.export-document pre.preview-code-widget::before {
  content: attr(data-code-language); display: block; padding: 6px 14px; font: 12px Consolas, monospace;
  border-bottom: 1px solid var(--export-border); color: var(--export-muted); background: var(--export-code);
}
.export-document pre code, .export-document pre.preview-code-widget code.preview-code-body {
  display: block; background: transparent; padding: 12px 0; color: inherit; font-size: .9em; line-height: 1.65; tab-size: 4;
}
.export-document .preview-code-row, .export-document .markdown-code-row { display: grid; grid-template-columns: 42px minmax(0, 1fr); min-width: max-content; padding-right: 18px; }
.export-document .preview-code-row::before { content: attr(data-line-number); padding-right: 14px; text-align: right; color: var(--export-muted); }
.export-document .preview-code-line, .export-document .markdown-code-line { display: block; white-space: pre; min-height: 1.65em; color: inherit; font: inherit; }
.export-document .preview-code-source-newline { display: none; }
.export-document .markdown-code-token-keyword { color: #7c3aed; }
.export-document .markdown-code-token-string { color: #15803d; }
.export-document .markdown-code-token-number { color: #c2410c; }
.export-document .markdown-code-token-comment { color: var(--export-muted); font-style: italic; }
.export-document .markdown-code-token-type { color: #0369a1; }
.export-document .markdown-code-token-property { color: #a16207; }
.export-document .markdown-code-token-operator { color: #0f766e; }
.export-document .markdown-code-token-punctuation { color: inherit; }
.export-document blockquote { margin: 0 0 14px; padding: 8px 16px; border-left: 4px solid var(--export-border); background: var(--export-code); color: var(--export-muted); }
.export-document table { border-collapse: collapse; width: 100%; margin-bottom: 14px; }
.export-document th, .export-document td { border: 1px solid var(--export-border); padding: 8px 12px; text-align: left; }
.export-document th { background: var(--export-code); font-weight: 600; }
.export-document img, .export-document svg.f-mermaid-svg { max-width: 100%; height: auto; }
.export-document hr { border: none; border-top: 1px solid var(--export-border); margin: 20px 0; }
.export-document .katex { font-size: 1.1em; }
.export-document .katex-display { margin: 16px 0; padding: .45em 2px; overflow: visible; }
.export-document .f-raw-fallback { white-space: pre-wrap; }
`;

const PROFILE_CSS = Object.freeze({
  html: `.export-document[data-export-format="html"] { font-size: 16px; max-width: 820px; margin: 40px auto; padding: 0 20px; }`,
  word: `.export-document[data-export-format="word"] { font-family: "Microsoft YaHei", "SimSun", "PingFang SC", sans-serif; font-size: 12pt; line-height: 1.6; --export-ink: #000; --export-code: #f5f5f5; --export-border: #ccc; --export-link: #0563c1; }
  .export-document[data-export-format="word"] h1 { font-size: 20pt; margin: 18pt 0 10pt; }
  .export-document[data-export-format="word"] h2 { font-size: 16pt; margin: 14pt 0 8pt; }
  .export-document[data-export-format="word"] h3 { font-size: 14pt; margin: 12pt 0 6pt; }
  .export-document[data-export-format="word"] h4, .export-document[data-export-format="word"] h5, .export-document[data-export-format="word"] h6 { font-size: 12pt; margin: 10pt 0 6pt; }
  .export-document[data-export-format="word"] p { margin: 6pt 0; }
  .export-document[data-export-format="word"] .preview-code-row { display: block; }
  .export-document[data-export-format="word"] .preview-code-row::before { display: inline-block; width: 28pt; }
  .export-document[data-export-format="word"] .preview-code-line { display: inline; }`,
  pdf: `@media print {
    .export-document[data-export-format="pdf"] { --export-ink: #000; --export-paper: #fff; --export-code: #f5f5f5; padding: 0; margin: 0; max-width: none; overflow: visible; }
    .export-document[data-export-format="pdf"] pre, .export-document[data-export-format="pdf"] table, .export-document[data-export-format="pdf"] .katex-display { break-inside: avoid; }
  }`,
  image: `.export-document[data-export-format="image"] {
    --export-paper: var(--color-surface-raised, #fff); --export-ink: var(--color-text-primary, #212529);
    --export-muted: var(--color-text-muted, #6c757d); --export-border: var(--color-border-subtle, #dee2e6);
    --export-code: var(--code-background, #f1f3f5); --export-link: var(--color-accent, #0d6efd);
    max-width: none; margin: 0; overflow: visible;
  }
  /* Raster images have no accessibility tree. Retain the source DOM; exclude the auxiliary representation from encoding. */
  .export-document[data-export-format="image"] .katex-mathml { display: none !important; }
  .export-document[data-export-format="image"] .markdown-code-token-keyword { color: var(--code-token-keyword, #7c3aed); }
  .export-document[data-export-format="image"] .markdown-code-token-string { color: var(--code-token-string, #15803d); }
  .export-document[data-export-format="image"] .markdown-code-token-number { color: var(--code-token-number, #c2410c); }
  .export-document[data-export-format="image"] .markdown-code-token-comment { color: var(--code-token-comment, #6c757d); }
  .export-document[data-export-format="image"] .markdown-code-token-type { color: var(--code-token-type, #0369a1); }
  .export-document[data-export-format="image"] .markdown-code-token-property { color: var(--code-token-property, #a16207); }
  .export-document[data-export-format="image"] .markdown-code-token-operator { color: var(--code-token-operator, #0f766e); }
  .export-document[data-export-format="image"] .markdown-code-token-punctuation { color: var(--code-token-punctuation, currentColor); }`
});

function requireFormat(format) {
  if (!FORMATS.has(format)) throw new TypeError('Export document style format is invalid.');
}

/** mathCss is the trusted, locked KaTeX CSS asset. Font packaging belongs to the format asset boundary. */
export function createExportStyleSheet({ documentRef = globalThis.document, mathCss } = {}) {
  if (typeof mathCss !== 'string' || !mathCss.trim() || /<\/style/i.test(mathCss)) throw new TypeError('Trusted KaTeX stylesheet text is required.');
  // Keep one upstream layout authority without emitting broken relative font URLs into standalone files.
  const mathLayoutCss = mathCss.replace(/@font-face\s*\{[^}]*\}/g, '');
  const roots = new Map();
  let styleNode = null, destroyed = false;
  const requireAlive = () => { if (destroyed) throw new Error('Export stylesheet is destroyed.'); };
  function getCss(format) {
    requireAlive(); requireFormat(format);
    const css = mathLayoutCss + DOCUMENT_CSS + PROFILE_CSS[format];
    if (format === 'image') return css;
    // Office's HTML importer does not implement CSS custom properties.
    const palette = format === 'word'
      ? { paper: '#fff', ink: '#000', muted: '#555', border: '#ccc', code: '#f5f5f5', link: '#0563c1' }
      : { paper: '#fff', ink: format === 'pdf' ? '#000' : '#212529', muted: '#6c757d', border: '#dee2e6', code: format === 'pdf' ? '#f5f5f5' : '#f1f3f5', link: '#0d6efd' };
    return css.replace(/var\(--export-(paper|ink|muted|border|code|link)\)/g, (_, name) => palette[name]);
  }
  function apply(root, format) {
    requireAlive(); requireFormat(format);
    if (!root?.dataset || !['contains', 'add', 'remove'].every(method => typeof root.classList?.[method] === 'function')) throw new TypeError('Export style root is required.');
    if (root.ownerDocument && root.ownerDocument !== documentRef) throw new TypeError('Export style root belongs to another document.');
    if (!styleNode) {
      if (!documentRef?.head?.appendChild || !documentRef?.createElement) throw new TypeError('Export style document head is required.');
      const node = documentRef.createElement('style');
      node.textContent = DOCUMENT_CSS + Object.values(PROFILE_CSS).join('\n');
      node.dataset.exportStyleSheet = 'document';
      documentRef.head.appendChild(node);
      styleNode = node;
    }
    roots.get(root)?.release();
    const hadClass = root.classList.contains(ROOT_CLASS), previousFormat = root.dataset.exportFormat;
    root.classList.add(ROOT_CLASS); root.dataset.exportFormat = format;
    let released = false;
    const lease = Object.freeze({ release() {
      if (released) return;
      released = true;
      if (roots.get(root) !== lease) return;
      roots.delete(root);
      if (!hadClass) root.classList.remove(ROOT_CLASS);
      if (previousFormat === undefined) delete root.dataset.exportFormat;
      else root.dataset.exportFormat = previousFormat;
    } });
    roots.set(root, lease);
    return lease;
  }
  return Object.freeze({ getCss, apply, destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const lease of [...roots.values()]) lease.release();
    if (styleNode?.parentNode) styleNode.parentNode.removeChild(styleNode);
    styleNode = null;
  } });
}
