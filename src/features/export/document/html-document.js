/** Serialize an already-safe, completely enhanced Builder body into a passive standalone HTML document. */
export function createHtmlDocumentSerializer({ styles } = {}) {
  if (typeof styles?.getCss !== 'function') throw new TypeError('HTML document requires the public stylesheet.');
  const escapeTitle = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  return Object.freeze({ serialize({ bodyHtml, name, fontCss } = {}) {
    if (typeof bodyHtml !== 'string' || typeof name !== 'string' || typeof fontCss !== 'string' || !fontCss.trim()) {
      throw new TypeError('HTML document requires body, name and embedded font CSS.');
    }
    const css = styles.getCss('html');
    if (typeof css !== 'string' || /<\/style/i.test(css + fontCss)) throw new TypeError('HTML stylesheet is unsafe.');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeTitle(name.replace(/\.(html|htm)$/i, ''))}</title>
  <style>${css}</style>
  <style data-export-fonts="katex">${fontCss}</style>
</head>
<body class="export-document" data-export-format="html">
${bodyHtml}
</body>
</html>`;
  } });
}
