const MODULE_SCRIPT_PATTERN = /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']([^"']+)["'])[^>]*>\s*<\/script>/i;
const STYLESHEET_PATTERN = /<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/i;
const I18N_SCRIPT_PATTERN = /<script\s+src=["']\/i18n\.js["']><\/script>/i;

function normalizeOrigin(origin) {
  if (typeof origin !== 'string' || origin.trim() === '') {
    throw new TypeError('Built application origin must be a non-empty string.');
  }
  return `${origin.replace(/\/+$/, '')}/`;
}

export function prepareBuiltApplicationDocument(html, origin) {
  if (typeof html !== 'string' || html.trim() === '') {
    throw new TypeError('Built application HTML must be a non-empty string.');
  }

  const baseUrl = normalizeOrigin(origin);
  const moduleMatch = html.match(MODULE_SCRIPT_PATTERN);
  if (!moduleMatch) {
    throw new Error('Unable to locate built application module asset.');
  }

  const stylesheetMatch = html.match(STYLESHEET_PATTERN);
  let preparedHtml = html
    .replace('<head>', `<head><base href="${baseUrl}">`)
    .replace(moduleMatch[0], '')
    .replace(I18N_SCRIPT_PATTERN, '');

  if (stylesheetMatch) preparedHtml = preparedHtml.replace(stylesheetMatch[0], '');

  return Object.freeze({
    html: preparedHtml,
    moduleUrl: new URL(moduleMatch[1], baseUrl).href,
    stylesheetUrl: stylesheetMatch ? new URL(stylesheetMatch[1], baseUrl).href : null
  });
}
