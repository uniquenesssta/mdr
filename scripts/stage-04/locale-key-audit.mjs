import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const REGISTRY_PATH = 'src/i18n/locale-registry.js';
const LOCALE_DIRECTORY = 'src/i18n/locales';
const HELP_CONTENT_PATH = 'public/help-content.js';
const REFERENCE_ROOTS = ['public', 'src'];
const REFERENCE_EXTENSIONS = new Set(['.html', '.js', '.mjs']);
const HTML_TAG_PATTERN = /<(?:a|b|blockquote|br|code|div|em|h[1-6]|li|ol|p|pre|span|strong|table|tbody|td|th|thead|tr|ul)\b/i;
const PLACEHOLDER_PATTERN = /\{(\d+)\}/g;
const LOCALE_DECLARATION_PATTERN = /^\s{2}(['"])([^'"]+)\1\s*:\s*\{\s*$/;
const LOCALE_END_PATTERN = /^\s{2}\},?\s*$/;
const KEY_DECLARATION_PATTERN = /^\s{4}(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*:/;
const SPLIT_KEY_DECLARATION_PATTERN = /^\s{2}"([^"]+)"\s*:/;
const HTML_REFERENCE_PATTERN = /\bdata-i18n(?:-title|-placeholder|-alt)?\s*=\s*(['"])([^'"]+)\1/g;
const TRANSLATION_CALL_PATTERN = /\bt\s*\(\s*(['"])([^'"]+)\1/g;
const DIRECT_I18N_DOT_PATTERN = /\bi18n\s*\[[^\]]+\]\s*\.\s*([A-Za-z_$][\w$]*)/g;
const DIRECT_I18N_BRACKET_PATTERN = /\bi18n\s*\[[^\]]+\]\s*\[\s*(['"])([^'"]+)\1\s*\]/g;

function normalizePath(path) {
  return String(path || '').replaceAll('\\', '/');
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function extractPlaceholderSignature(value) {
  const placeholders = new Set();
  for (const match of String(value ?? '').matchAll(PLACEHOLDER_PATTERN)) placeholders.add(Number(match[1]));
  return [...placeholders].sort((left, right) => left - right);
}

export function parseLocaleDeclarations(source) {
  const localeOrder = [];
  const localeDefinitions = new Map();
  const keyDeclarations = new Map();
  let currentLocale = null;

  for (const [index, line] of String(source).split(/\r?\n/).entries()) {
    const localeMatch = line.match(LOCALE_DECLARATION_PATTERN);
    if (localeMatch) {
      currentLocale = localeMatch[2];
      localeOrder.push(currentLocale);
      localeDefinitions.set(currentLocale, (localeDefinitions.get(currentLocale) || 0) + 1);
      if (!keyDeclarations.has(currentLocale)) keyDeclarations.set(currentLocale, []);
      continue;
    }
    if (!currentLocale) continue;
    if (LOCALE_END_PATTERN.test(line)) {
      currentLocale = null;
      continue;
    }
    const keyMatch = line.match(KEY_DECLARATION_PATTERN);
    if (keyMatch) keyDeclarations.get(currentLocale).push({ key: keyMatch[2] || keyMatch[3], line: index + 1 });
  }

  const duplicateLocales = [...localeDefinitions.entries()]
    .filter(([, count]) => count > 1)
    .map(([locale, count]) => ({ locale, count }))
    .sort((left, right) => left.locale.localeCompare(right.locale));
  const duplicateKeysByLocale = {};
  for (const locale of [...new Set(localeOrder)]) {
    const grouped = new Map();
    for (const record of keyDeclarations.get(locale) || []) {
      if (!grouped.has(record.key)) grouped.set(record.key, []);
      grouped.get(record.key).push(record.line);
    }
    const duplicates = [...grouped.entries()]
      .filter(([, lines]) => lines.length > 1)
      .map(([key, lines]) => ({ key, lines }))
      .sort((left, right) => left.key.localeCompare(right.key));
    if (duplicates.length) duplicateKeysByLocale[locale] = duplicates;
  }
  return { localeOrder, duplicateLocales, duplicateKeysByLocale, keyDeclarations };
}

function lineNumberAt(source, index) {
  return String(source).slice(0, index).split(/\r?\n/).length;
}

function addReference(referenceMap, key, path, index, kind, source) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return;
  if (!referenceMap.has(normalizedKey)) referenceMap.set(normalizedKey, []);
  referenceMap.get(normalizedKey).push({ path: normalizePath(path), line: lineNumberAt(source, index), kind });
}

export function collectLiteralTranslationReferences(source, path) {
  const references = new Map();
  const text = String(source);
  for (const match of text.matchAll(HTML_REFERENCE_PATTERN)) addReference(references, match[2], path, match.index, 'html-binding', text);
  for (const match of text.matchAll(TRANSLATION_CALL_PATTERN)) addReference(references, match[2], path, match.index, 't-call', text);
  for (const match of text.matchAll(DIRECT_I18N_DOT_PATTERN)) addReference(references, match[1], path, match.index, 'direct-i18n-property', text);
  for (const match of text.matchAll(DIRECT_I18N_BRACKET_PATTERN)) addReference(references, match[2], path, match.index, 'direct-i18n-property', text);
  return references;
}

function mergeReferenceMaps(target, source) {
  for (const [key, records] of source) {
    if (!target.has(key)) target.set(key, []);
    target.get(key).push(...records);
  }
}

function findDynamicTranslationCalls(source, path) {
  const results = [];
  const text = String(source);
  const callPattern = /\bt\s*\(([^\n)]*)/g;
  for (const match of text.matchAll(callPattern)) {
    const before = text.slice(Math.max(0, match.index - 16), match.index);
    if (/function\s+$/.test(before)) continue;
    const argument = match[1].trimStart();
    if (argument.startsWith("'") || argument.startsWith('"')) continue;
    results.push({ path: normalizePath(path), line: lineNumberAt(text, match.index), expression: argument.trim().slice(0, 80) });
  }
  return results;
}

async function collectReferenceFiles(root) {
  const files = ['index.html'];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(resolve(root, directory), { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && REFERENCE_EXTENSIONS.has(extname(entry.name))) files.push(normalizePath(child));
    }
  }
  for (const directory of REFERENCE_ROOTS) await walk(directory);
  return [...new Set(files)].sort();
}

async function loadRegistry(root) {
  const href = pathToFileURL(resolve(root, REGISTRY_PATH)).href;
  const module = await import(`${href}?stage04-audit=${Date.now()}`);
  const registry = module.localeRegistry;
  if (!registry || !Array.isArray(registry.localeIds) || !Array.isArray(registry.keys)) {
    throw new Error(`${REGISTRY_PATH} did not expose the expected localeRegistry contract.`);
  }
  return registry;
}

async function loadHelpContent(root, localeOrder) {
  const source = await readFile(resolve(root, HELP_CONTENT_PATH), 'utf8');
  const host = { removeAttribute() {} };
  runInNewContext(source, { document: { getElementById: id => id === 'compatibility-business-ports' ? host : null } }, { timeout: 2_000, filename: HELP_CONTENT_PATH });
  const api = host.markdownEditorHelpContent;
  if (!api || typeof api.get !== 'function' || typeof api.hasLocale !== 'function') {
    throw new Error(`${HELP_CONTENT_PATH} did not mount the expected compatibility API.`);
  }
  const result = {};
  for (const locale of localeOrder) {
    if (!api.hasLocale(locale)) throw new Error(`${HELP_CONTENT_PATH} is missing locale ${locale}.`);
    const value = api.get(locale);
    if (typeof value !== 'string' || !HTML_TAG_PATTERN.test(value)) throw new Error(`Help content for ${locale} must remain HTML text.`);
    result[locale] = { length: value.length, sha256: sha256(value) };
  }
  return result;
}

async function collectSplitDuplicateKeys(root, localeOrder) {
  const duplicateKeysByLocale = {};
  for (const locale of localeOrder) {
    const source = await readFile(resolve(root, LOCALE_DIRECTORY, `${locale}.js`), 'utf8');
    const grouped = new Map();
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      const match = line.match(SPLIT_KEY_DECLARATION_PATTERN);
      if (!match) continue;
      if (!grouped.has(match[1])) grouped.set(match[1], []);
      grouped.get(match[1]).push(index + 1);
    }
    const duplicates = [...grouped.entries()]
      .filter(([, lines]) => lines.length > 1)
      .map(([key, lines]) => ({ key, lines }))
      .sort((left, right) => left.key.localeCompare(right.key));
    if (duplicates.length) duplicateKeysByLocale[locale] = duplicates;
  }
  return duplicateKeysByLocale;
}

function sortObjectKeys(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

export async function buildLocaleKeyAudit({ root = process.cwd() } = {}) {
  const registry = await loadRegistry(root);
  const localeOrder = [...registry.localeIds];
  const unionKeys = [...registry.keys].sort();
  const localeKeys = {};
  const placeholderSignatures = {};
  const missingKeysByLocale = {};
  const placeholderMismatches = [];

  const reference = registry.get(registry.defaultLocale);
  const expectedPlaceholders = Object.fromEntries(unionKeys.map(key => [key, extractPlaceholderSignature(reference[key])]));
  for (const locale of localeOrder) {
    const dictionary = registry.get(locale);
    const keys = Object.keys(dictionary).sort();
    localeKeys[locale] = keys;
    const missing = unionKeys.filter(key => !Object.hasOwn(dictionary, key));
    if (missing.length) missingKeysByLocale[locale] = missing;
    const signatures = {};
    for (const key of keys) {
      const signature = extractPlaceholderSignature(dictionary[key]);
      if (signature.length) signatures[key] = signature;
      if (JSON.stringify(signature) !== JSON.stringify(expectedPlaceholders[key])) {
        placeholderMismatches.push({ locale, key, expected: expectedPlaceholders[key], actual: signature });
      }
      if (HTML_TAG_PATTERN.test(dictionary[key])) throw new Error(`Locale ${locale} key ${key} contains HTML content.`);
    }
    placeholderSignatures[locale] = sortObjectKeys(signatures);
  }

  const references = new Map();
  const dynamicTranslationCalls = [];
  for (const path of await collectReferenceFiles(root)) {
    const source = await readFile(resolve(root, path), 'utf8');
    mergeReferenceMaps(references, collectLiteralTranslationReferences(source, path));
    if (/\.(?:js|mjs)$/.test(path)) dynamicTranslationCalls.push(...findDynamicTranslationCalls(source, path));
  }
  const referencedKeys = [...references.keys()].sort();
  const unionSet = new Set(unionKeys);
  const referencedSet = new Set(referencedKeys);
  const referencesByKey = {};
  for (const key of referencedKeys) {
    referencesByKey[key] = references.get(key).sort((left, right) => `${left.path}:${left.line}:${left.kind}`.localeCompare(`${right.path}:${right.line}:${right.kind}`));
  }

  return {
    schemaVersion: 2,
    kind: 'stage-04-split-locale-key-audit',
    source: REGISTRY_PATH,
    auditMode: 'split-registry-static-literal-production-references',
    localeOrder,
    localeKeys,
    unionKeys,
    placeholderSignatures,
    htmlContent: Object.fromEntries(localeOrder.map(locale => [locale, []])),
    helpContent: await loadHelpContent(root, localeOrder),
    referencesByKey,
    anomalies: {
      duplicateLocales: [],
      duplicateKeysByLocale: await collectSplitDuplicateKeys(root, localeOrder),
      missingKeysByLocale: sortObjectKeys(missingKeysByLocale),
      placeholderMismatches,
      unusedKeys: unionKeys.filter(key => !referencedSet.has(key)),
      unknownReferencedKeys: referencedKeys.filter(key => !unionSet.has(key)),
      dynamicTranslationCalls: dynamicTranslationCalls.sort((left, right) => `${left.path}:${left.line}:${left.expression}`.localeCompare(`${right.path}:${right.line}:${right.expression}`))
    }
  };
}

export function serializeLocaleKeyAudit(audit) {
  return `${JSON.stringify(audit, null, 2)}\n`;
}

async function main() {
  const outputArgument = process.argv.slice(2).find(argument => argument.startsWith('--output='));
  const output = outputArgument?.slice('--output='.length) || '';
  const audit = await buildLocaleKeyAudit();
  if (output) {
    const absolute = resolve(process.cwd(), output);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, serializeLocaleKeyAudit(audit), 'utf8');
  } else process.stdout.write(serializeLocaleKeyAudit(audit));
}

const entryHref = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entryHref && import.meta.url === entryHref) await main();
