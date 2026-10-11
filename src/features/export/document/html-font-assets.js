/** Package the locked KaTeX font faces as data URLs; no network, DOM or document state. */
export function createHtmlFontStyle({ mathCss, fonts } = {}) {
  if (typeof mathCss !== 'string' || /<\/style/i.test(mathCss) || !fonts || typeof fonts !== 'object') {
    throw new TypeError('Trusted math CSS and inline font assets are required.');
  }
  const byName = new Map();
  for (const [path, value] of Object.entries(fonts)) {
    const name = path.split(/[\\/]/).at(-1);
    if (byName.has(name)) throw new TypeError('Duplicate inline math font: ' + name);
    if (!/^data:(?:font\/woff2|application\/(?:font-woff2|octet-stream));base64,[a-z0-9+/]+={0,2}$/i.test(value)) {
      throw new TypeError('Math font must be an inline WOFF2 asset: ' + name);
    }
    byName.set(name, value);
  }
  const faces = mathCss.match(/@font-face\s*\{[^}]*\}/g);
  if (!faces?.length) throw new TypeError('Locked math font faces are missing.');
  return faces.map(face => {
    const name = /url\(["']?fonts\/([^\s"')]+\.woff2)["']?\)/.exec(face)?.[1];
    if (!name || !byName.has(name)) throw new TypeError('Missing inline math font: ' + name);
    return face.replace(/src\s*:[^;]+;/, 'src: url("' + byName.get(name) + '") format("woff2");');
  }).join('\n');
}

/** Lazy immutable asset package; a failed import can be retried by a later export. */
export function createHtmlFontAssets({ mathCss, loaders } = {}) {
  const entries = Object.entries(loaders || {});
  if (typeof mathCss !== 'string' || /<\/style/i.test(mathCss) || !entries.length || entries.some(([, load]) => typeof load !== 'function')) {
    throw new TypeError('HTML font assets require trusted math CSS and font loaders.');
  }
  let pending;
  return Object.freeze({ load() {
    if (!pending) pending = Promise.all(entries.map(async ([path, load]) => [path, await load()]))
      .then(values => createHtmlFontStyle({ mathCss, fonts: Object.fromEntries(values) }))
      .catch(error => { pending = null; throw error; });
    return pending;
  } });
}
