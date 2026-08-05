export const STABLE_ICON_ID_PATTERN = /^icon-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function collectSvgSymbols(source) {
  if (typeof source !== 'string') throw new TypeError('SVG sprite source must be a string.');
  const records = [];
  const expression = /<symbol\b([^>]*)\bid=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/symbol>/gi;
  for (const match of source.matchAll(expression)) {
    const attributes = `${match[1]} ${match[3]}`;
    const viewBox = attributes.match(/\bviewBox=["']([^"']+)["']/i)?.[1] || '';
    records.push(Object.freeze({ id: match[2], viewBox, markup: match[0] }));
  }
  return Object.freeze(records);
}

export function collectIconReferences(source) {
  if (typeof source !== 'string') throw new TypeError('Icon reference source must be a string.');
  const references = [];
  const expression = /<use\b[^>]*(?:href|xlink:href)=["']([^"']+)["'][^>]*>/gi;
  for (const match of source.matchAll(expression)) {
    references.push(Object.freeze({ href: match[1], iconId: match[1].split('#').at(-1) || '' }));
  }
  return Object.freeze(references);
}

export function inspectSvgSprite(source) {
  const symbols = collectSvgSymbols(source);
  const ids = symbols.map(symbol => symbol.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
  const invalidIds = [...new Set(ids.filter(id => !STABLE_ICON_ID_PATTERN.test(id)))].sort();
  const missingViewBoxes = symbols.filter(symbol => !symbol.viewBox).map(symbol => symbol.id);
  const forbiddenMarkup = /<script\b|\son[a-z]+\s*=|<title\b|<desc\b|\sdata-[\w-]+\s*=|\saria-label\s*=/i.test(source);
  return Object.freeze({
    symbols,
    ids: Object.freeze(ids),
    symbolCount: symbols.length,
    uniqueSymbolCount: new Set(ids).size,
    duplicates: Object.freeze(duplicates),
    invalidIds: Object.freeze(invalidIds),
    missingViewBoxes: Object.freeze(missingViewBoxes),
    forbiddenMarkup
  });
}
