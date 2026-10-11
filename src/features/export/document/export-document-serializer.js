/** Serialize an already-safe, completely enhanced Builder body into a passive standalone HTML document. */
export function createExportDocumentSerializer({ styles, format } = {}) {
  if (!['html', 'word'].includes(format)) throw new TypeError('Standalone document format must be HTML or Word.');
  if (typeof styles?.getCss !== 'function') throw new TypeError('Standalone document requires the public stylesheet.');
  const escapeTitle = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  return Object.freeze({ serialize({ bodyHtml, name, fontCss } = {}) {
    if (typeof bodyHtml !== 'string' || typeof name !== 'string' || typeof fontCss !== 'string' || !fontCss.trim()) {
      throw new TypeError('Standalone document requires body, name and embedded font CSS.');
    }
    const css = styles.getCss(format);
    if (typeof css !== 'string' || /<\/style/i.test(css + fontCss)) throw new TypeError('Standalone stylesheet is unsafe.');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeTitle(name.replace(format === 'html' ? /\.(html|htm)$/i : /\.doc$/i, ''))}</title>
  <style>${css}</style>
  <style data-export-fonts="katex">${fontCss}</style>
</head>
<body class="export-document" data-export-format="${format}">
${bodyHtml}
</body>
</html>`;
  } });
}
