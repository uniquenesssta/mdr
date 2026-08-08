import zhCN from './locales/zh-CN.js';
import zhTW from './locales/zh-TW.js';
import en from './locales/en.js';
import ja from './locales/ja.js';
import ko from './locales/ko.js';
import es from './locales/es.js';
import fr from './locales/fr.js';
import de from './locales/de.js';
import ru from './locales/ru.js';
import pt from './locales/pt.js';

const DEFAULT_LOCALE = 'zh-CN';
const HTML_TAG_PATTERN = /<(?:a|b|blockquote|br|code|div|em|h[1-6]|li|ol|p|pre|span|strong|table|tbody|td|th|thead|tr|ul)\b/i;
const PLACEHOLDER_PATTERN = /\{(\d+)\}/g;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function placeholderSignature(value) {
  const indexes = new Set();
  for (const match of String(value).matchAll(PLACEHOLDER_PATTERN)) indexes.add(Number(match[1]));
  return [...indexes].sort((left, right) => left - right);
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function freezeDictionary(locale, dictionary) {
  if (!isRecord(dictionary)) throw new TypeError(`Locale ${locale} must be an object.`);
  const copy = {};
  for (const [key, value] of Object.entries(dictionary)) {
    if (typeof value !== 'string') throw new TypeError(`Locale ${locale} key ${key} must be a string.`);
    if (HTML_TAG_PATTERN.test(value)) throw new Error(`Locale ${locale} key ${key} must not contain help/content HTML.`);
    copy[key] = value;
  }
  return Object.freeze(copy);
}

export function createLocaleRegistry(entries, { defaultLocale = DEFAULT_LOCALE } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError('Locale registry requires locale entries.');
  const dictionaries = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new TypeError('Locale registry entries must be [locale, dictionary].');
    const locale = String(entry[0] || '').trim();
    if (!locale) throw new TypeError('Locale id must be non-empty.');
    if (dictionaries.has(locale)) throw new Error(`Duplicate locale: ${locale}.`);
    dictionaries.set(locale, freezeDictionary(locale, entry[1]));
  }
  if (!dictionaries.has(defaultLocale)) throw new Error(`Default locale is missing: ${defaultLocale}.`);

  const canonical = dictionaries.get(defaultLocale);
  const canonicalKeys = Object.keys(canonical).sort();
  const canonicalPlaceholders = new Map(canonicalKeys.map(key => [key, placeholderSignature(canonical[key])]));
  for (const [locale, dictionary] of dictionaries) {
    const keys = Object.keys(dictionary).sort();
    if (!sameArray(keys, canonicalKeys)) {
      const missing = canonicalKeys.filter(key => !Object.hasOwn(dictionary, key));
      const extra = keys.filter(key => !Object.hasOwn(canonical, key));
      throw new Error(`Locale ${locale} keys differ from ${defaultLocale}; missing=[${missing.join(',')}], extra=[${extra.join(',')}].`);
    }
    for (const key of canonicalKeys) {
      const actual = placeholderSignature(dictionary[key]);
      const expected = canonicalPlaceholders.get(key);
      if (!sameArray(actual, expected)) {
        throw new Error(`Locale ${locale} key ${key} placeholder signature differs from ${defaultLocale}.`);
      }
    }
  }

  const localeIds = Object.freeze([...dictionaries.keys()]);
  return Object.freeze({
    defaultLocale,
    localeIds,
    keys: Object.freeze([...canonicalKeys]),
    has(locale) { return dictionaries.has(String(locale || '')); },
    get(locale) { return dictionaries.get(String(locale || '')) || null; }
  });
}

export const localeRegistry = createLocaleRegistry([
  ['zh-CN', zhCN],
  ['zh-TW', zhTW],
  ['en', en],
  ['ja', ja],
  ['ko', ko],
  ['es', es],
  ['fr', fr],
  ['de', de],
  ['ru', ru],
  ['pt', pt]
]);

export const LOCALE_IDS = localeRegistry.localeIds;
