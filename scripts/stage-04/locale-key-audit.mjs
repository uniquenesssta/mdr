import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const LEGACY_LOCALE_PATH = 'public/i18n.js';
const REFERENCE_ROOTS = ['public', 'src'];
const REFERENCE_EXTENSIONS = new Set(['.html', '.js', '.mjs']);
const HTML_TAG_PATTERN = /<(?:a|b|blockquote|br|code|div|em|h[1-6]|li|ol|p|pre|span|strong|table|tbody|td|th|thead|tr|ul)\b/i;
const PLACEHOLDER_PATTERN = /\{(\d+)\}/g;
const LOCALE_DECLARATION_PATTERN = /^\s{2}(['"])([^'"]+)\1\s*:\s*\{\s*$/;
const LOCALE_END_PATTERN = /^\s{2}\},?\s*$/;
const KEY_DECLARATION_PATTERN = /^\s{4}(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*:/;
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
  for (const match of String(value ?? '').matchAll(PLACEHOLDER_PATTERN)) {
    placeholders.add(Number(match[1]));
  }
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
    if (!keyMatch) continue;
    keyDeclarations.get(currentLocale).push({
      key: keyMatch[2] || keyMatch[3],
      line: index + 1
    });
  }

  const duplicateLocales = [...localeDefinitions.entries()]
    .filter(([, count]) => count > 1)
    .map(([locale, count]) => ({ locale, count }))
    .sort((left, right) => left.locale.localeCompare(right.locale));

  const duplicateKeysByLocale = {};
  for (const locale of [...new Set(localeOrder)]) {
    const declarations = keyDeclarations.get(locale) || [];
    const grouped = new Map();
    for (const record of declarations) {
      if (!grouped.has(record.key)) grouped.set(record.key, []);
      grouped.get(record.key).push(record.line);
    }
    const duplicates = [...grouped.entries()]
      .filter(([, lines]) => lines.length > 1)
      .map(([key, lines]) => ({ key, lines }))
      .sort((left, right) => left.key.localeCompare(right.key));
    if (duplicates.length) duplicateKeysByLocale[locale] = duplicates;
  }

  return {
    localeOrder,
    duplicateLocales,
    duplicateKeysByLocale,
    keyDeclarations
  };
}

export function evaluateLegacyLocales(source) {
  const sandbox = Object.create(null);
  runInNewContext(
    `${String(source)}\n;globalThis.__markdownEditorLocaleAudit = i18n;`,
    sandbox,
    { timeout: 2_000, filename: LEGACY_LOCALE_PATH }
  );
  const locales = sandbox.__markdownEditorLocaleAudit;
  if (!locales || typeof locales !== 'object' || Array.isArray(locales)) {
    throw new Error(`${LEGACY_LOCALE_PATH} did not expose an object-shaped locale dictionary.`);
  }
  return locales;
}

async function collectReferenceFiles(root) {
  const files = ['index.html'];

  async function walk(directory) {
    const absoluteDirectory = resolve(root, directory);
    let entries;
    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!entry.isFile()) continue;
      const normalized = normalizePath(child);
      if (normalized === LEGACY_LOCALE_PATH) continue;
      if (!REFERENCE_EXTENSIONS.has(extname(entry.name))) continue;
      files.push(normalized);
    }
  }

  for (const directory of REFERENCE_ROOTS) await walk(directory);
  return [...new Set(files)].sort();
}

function lineNumberAt(source, index) {
  return String(source).slice(0, index).split(/\r?\n/).length;
}

function addReference(referenceMap, key, path, index, kind, source) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return;
  if (!referenceMap.has(normalizedKey)) referenceMap.set(normalizedKey, []);
  referenceMap.get(normalizedKey).push({
    path: normalizePath(path),
    line: lineNumberAt(source, index),
    kind
  });
}

export function collectLiteralTranslationReferences(source, path) {
  const references = new Map();
  const text = String(source);

  for (const match of text.matchAll(HTML_REFERENCE_PATTERN)) {
    addReference(references, match[2], path, match.index, 'html-binding', text);
  }
  for (const match of text.matchAll(TRANSLATION_CALL_PATTERN)) {
    addReference(references, match[2], path, match.index, 't-call', text);
  }
  for (const match of text.matchAll(DIRECT_I18N_DOT_PATTERN)) {
    addReference(references, match[1], path, match.index, 'direct-i18n-property', text);
  }
  for (const match of text.matchAll(DIRECT_I18N_BRACKET_PATTERN)) {
    addReference(references, match[2], path, match.index, 'direct-i18n-property', text);
  }

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
    results.push({
      path: normalizePath(path),
      line: lineNumberAt(text, match.index),
      expression: argument.trim().slice(0, 80)
    });
  }
  return results;
}

function sortObjectKeys(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

export async function buildLocaleKeyAudit({ root = process.cwd() } = {}) {
  const localeSource = await readFile(resolve(root, LEGACY_LOCALE_PATH), 'utf8');
  const declarations = parseLocaleDeclarations(localeSource);
  const locales = evaluateLegacyLocales(localeSource);
  const localeOrder = declarations.localeOrder.filter((locale, index, list) => list.indexOf(locale) === index);
  const runtimeLocaleNames = Object.keys(locales);

  if (localeOrder.join('\u0000') !== runtimeLocaleNames.join('\u0000')) {
    throw new Error('Locale declaration order does not match the evaluated legacy locale dictionary.');
  }

  const localeKeys = {};
  const placeholderSignatures = {};
  const htmlContent = {};
  const union = new Set();

  for (const locale of localeOrder) {
    const dictionary = locales[locale];
    if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) {
      throw new Error(`Locale ${locale} is not an object-shaped dictionary.`);
    }
    const keys = Object.keys(dictionary).sort();
    localeKeys[locale] = keys;
    for (const key of keys) union.add(key);

    const placeholders = {};
    const htmlEntries = [];
    for (const key of keys) {
      const value = dictionary[key];
      if (typeof value !== 'string') {
        throw new Error(`Locale ${locale} key ${key} is not a string.`);
      }
      const signature = extractPlaceholderSignature(value);
      if (signature.length) placeholders[key] = signature;
      if (HTML_TAG_PATTERN.test(value)) {
        htmlEntries.push({ key, length: value.length, sha256: sha256(value) });
      }
    }
    placeholderSignatures[locale] = sortObjectKeys(placeholders);
    htmlContent[locale] = htmlEntries.sort((left, right) => left.key.localeCompare(right.key));
  }

  const unionKeys = [...union].sort();
  const missingKeysByLocale = {};
  for (const locale of localeOrder) {
    const keys = new Set(localeKeys[locale]);
    const missing = unionKeys.filter(key => !keys.has(key));
    if (missing.length) missingKeysByLocale[locale] = missing;
  }

  const referenceFiles = await collectReferenceFiles(root);
  const references = new Map();
  const dynamicTranslationCalls = [];
  for (const path of referenceFiles) {
    const source = await readFile(resolve(root, path), 'utf8');
    mergeReferenceMaps(references, collectLiteralTranslationReferences(source, path));
    if (/\.(?:js|mjs)$/.test(path)) {
      dynamicTranslationCalls.push(...findDynamicTranslationCalls(source, path));
    }
  }

  const referencedKeys = [...references.keys()].sort();
  const unionKeySet = new Set(unionKeys);
  const referencedKeySet = new Set(referencedKeys);
  const unusedKeys = unionKeys.filter(key => !referencedKeySet.has(key));
  const unknownReferencedKeys = referencedKeys.filter(key => !unionKeySet.has(key));

  const referencesByKey = {};
  for (const key of referencedKeys) {
    referencesByKey[key] = references.get(key)
      .sort((left, right) => `${left.path}:${left.line}:${left.kind}`.localeCompare(`${right.path}:${right.line}:${right.kind}`));
  }

  const placeholderMismatches = [];
  for (const key of unionKeys) {
    const signatures = new Map();
    for (const locale of localeOrder) {
      if (!(key in locales[locale])) continue;
      const signature = extractPlaceholderSignature(locales[locale][key]);
      const signatureKey = JSON.stringify(signature);
      if (!signatures.has(signatureKey)) signatures.set(signatureKey, []);
      signatures.get(signatureKey).push(locale);
    }
    if (signatures.size <= 1) continue;
    placeholderMismatches.push({
      key,
      variants: [...signatures.entries()]
        .map(([signature, variantLocales]) => ({
          placeholders: JSON.parse(signature),
          locales: variantLocales
        }))
        .sort((left, right) => JSON.stringify(left.placeholders).localeCompare(JSON.stringify(right.placeholders)))
    });
  }

  return {
    schemaVersion: 1,
    kind: 'stage-04-locale-key-compatibility',
    source: LEGACY_LOCALE_PATH,
    auditMode: 'static-literal-production-references',
    localeOrder,
    localeKeys,
    unionKeys,
    placeholderSignatures,
    htmlContent,
    referencesByKey,
    anomalies: {
      duplicateLocales: declarations.duplicateLocales,
      duplicateKeysByLocale: declarations.duplicateKeysByLocale,
      missingKeysByLocale: sortObjectKeys(missingKeysByLocale),
      placeholderMismatches,
      unusedKeys,
      unknownReferencedKeys,
      dynamicTranslationCalls: dynamicTranslationCalls.sort((left, right) => (
        `${left.path}:${left.line}:${left.expression}`.localeCompare(`${right.path}:${right.line}:${right.expression}`)
      ))
    }
  };
}

export function serializeLocaleKeyAudit(audit) {
  return `${JSON.stringify(audit, null, 2)}\n`;
}

async function writeAudit(path, audit) {
  const absolutePath = resolve(process.cwd(), path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, serializeLocaleKeyAudit(audit), 'utf8');
}

async function main() {
  const outputArgument = process.argv.slice(2).find(argument => argument.startsWith('--output='));
  const output = outputArgument?.slice('--output='.length) || '';
  const audit = await buildLocaleKeyAudit();
  if (output) await writeAudit(output, audit);
  else process.stdout.write(serializeLocaleKeyAudit(audit));
}

const entryHref = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entryHref && import.meta.url === entryHref) {
  await main();
}
