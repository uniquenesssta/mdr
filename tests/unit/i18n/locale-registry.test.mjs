import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import {
  createLocaleRegistry,
  localeRegistry,
  LOCALE_IDS,
  mountClassicLocalePort
} from '../../../src/i18n/index.js';
import { buildLocaleKeyAudit } from '../../../scripts/stage-04/locale-key-audit.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const FIXTURE_PATH = new URL('./fixtures/locale-split-compatibility.json', import.meta.url);
const HISTORICAL_FIXTURE_PATH = new URL('./fixtures/locale-key-compatibility.json', import.meta.url);
const HTML_TAG_PATTERN = /<(?:a|b|blockquote|br|code|div|em|h[1-6]|li|ol|p|pre|span|strong|table|tbody|td|th|thead|tr|ul)\b/i;

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function stableHash(record) {
  const sorted = Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
  return sha256(JSON.stringify(sorted));
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

async function loadHelpContent(localeIds = LOCALE_IDS) {
  const source = await readFile(resolve(ROOT, 'public/help-content.js'), 'utf8');
  const host = { removeAttribute() {} };
  runInNewContext(source, {
    document: { getElementById: id => id === 'compatibility-business-ports' ? host : null }
  }, { timeout: 2_000, filename: 'public/help-content.js' });
  const api = host.markdownEditorHelpContent;
  assert.ok(api);
  return Object.fromEntries(localeIds.map(locale => [locale, api.get(locale)]));
}

test('Atomic 4.2 exposes ten immutable short-text locale modules with one exact key surface', async () => {
  const fixture = await readJson(FIXTURE_PATH);
  assert.deepEqual([...LOCALE_IDS], fixture.localeOrder);
  assert.deepEqual([...localeRegistry.localeIds], fixture.localeOrder);
  assert.equal(localeRegistry.defaultLocale, 'zh-CN');
  assert.equal(localeRegistry.keys.length, 161);
  assert.equal(sha256(JSON.stringify([...localeRegistry.keys].sort())), fixture.shortKeysSha256);

  for (const locale of LOCALE_IDS) {
    const dictionary = localeRegistry.get(locale);
    assert.ok(Object.isFrozen(dictionary), `${locale} dictionary must be frozen`);
    assert.equal(Object.keys(dictionary).length, 161, `${locale} key count`);
    assert.deepEqual(Object.keys(dictionary).sort(), [...localeRegistry.keys].sort(), `${locale} key set`);
    assert.equal(Object.hasOwn(dictionary, 'helpHtml'), false, `${locale} must not contain helpHtml`);
    assert.ok(Object.values(dictionary).every(value => typeof value === 'string'));
    assert.ok(Object.values(dictionary).every(value => !HTML_TAG_PATTERN.test(value)), `${locale} must contain short text only`);
    assert.equal(stableHash(dictionary), fixture.splitShortTextSha256ByLocale[locale], `${locale} split hash`);
  }
});

test('Atomic 4.2 materializes only the historical zh-CN fallback keys and preserves every other short value', async () => {
  const [fixture, historical] = await Promise.all([readJson(FIXTURE_PATH), readJson(HISTORICAL_FIXTURE_PATH)]);
  const fallback = localeRegistry.get('zh-CN');
  assert.equal(historical.unionKeys.length, 162);

  for (const locale of LOCALE_IDS) {
    const dictionary = localeRegistry.get(locale);
    const materialized = fixture.materializedFallbackKeysByLocale[locale];
    for (const key of materialized) assert.equal(dictionary[key], fallback[key], `${locale}.${key} must preserve old fallback behavior`);

    const originalShape = { ...dictionary };
    for (const key of materialized) delete originalShape[key];
    assert.equal(stableHash(originalShape), fixture.originalShortTextSha256ByLocale[locale], `${locale} original short-text hash`);
  }
});

test('Atomic 4.2 keeps help HTML byte-compatible outside every locale module', async () => {
  const fixture = await readJson(FIXTURE_PATH);
  const help = await loadHelpContent();
  for (const locale of LOCALE_IDS) {
    assert.equal(sha256(help[locale]), fixture.helpHtmlSha256ByLocale[locale], `${locale} help hash`);
    assert.match(help[locale], HTML_TAG_PATTERN);
    const localeSource = await readFile(resolve(ROOT, 'src/i18n/locales', `${locale}.js`), 'utf8');
    assert.doesNotMatch(localeSource, /helpHtml|<p>|<ul>|<li>|<code>/i);
  }
});

test('locale registry rejects duplicate locales, key drift, placeholder drift, HTML and non-string values', () => {
  const valid = { save: 'Save', count: '{0} items' };
  assert.throws(() => createLocaleRegistry([['en', valid], ['en', valid]], { defaultLocale: 'en' }), /Duplicate locale/);
  assert.throws(() => createLocaleRegistry([['en', valid], ['fr', { save: 'Sauver' }]], { defaultLocale: 'en' }), /keys differ/);
  assert.throws(() => createLocaleRegistry([['en', valid], ['fr', { save: 'Sauver', count: '{1} éléments' }]], { defaultLocale: 'en' }), /placeholder signature differs/);
  assert.throws(() => createLocaleRegistry([['en', { save: '<b>Save<\/b>', count: '{0} items' }]], { defaultLocale: 'en' }), /must not contain help\/content HTML/);
  assert.throws(() => createLocaleRegistry([['en', { save: 1, count: '{0} items' }]], { defaultLocale: 'en' }), /must be a string/);
  assert.throws(() => createLocaleRegistry([['fr', valid]], { defaultLocale: 'en' }), /Default locale is missing/);
});

test('classic locale compatibility port is scoped, read-only and terminal after destroy', () => {
  const host = { removeAttribute() {} };
  const mount = mountClassicLocalePort(host, localeRegistry);
  const descriptor = Object.getOwnPropertyDescriptor(host, 'markdownEditorLocalePort');
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, false);
  assert.equal(host.markdownEditorLocalePort.defaultLocale, 'zh-CN');
  assert.equal(host.markdownEditorLocalePort.hasLocale('ja'), true);
  assert.equal(host.markdownEditorLocalePort.hasLocale('missing'), false);
  assert.equal(host.markdownEditorLocalePort.getLocale('en'), localeRegistry.get('en'));
  assert.equal(host.markdownEditorLocalePort.getLocale('missing'), null);
  assert.throws(() => mountClassicLocalePort(host, localeRegistry), /already mounted/);

  const api = host.markdownEditorLocalePort;
  mount.destroy();
  mount.destroy();
  assert.equal(Object.hasOwn(host, 'markdownEditorLocalePort'), false);
  assert.equal(api.hasLocale('en'), false);
  assert.throws(() => api.getLocale('en'), /destroyed/);
});

test('Atomic 4.2 bootstrap and classic core consume explicit locale/help compatibility APIs only', async () => {
  const [entry, core, index, help] = await Promise.all([
    readFile(resolve(ROOT, 'src/bootstrap/module-entry.js'), 'utf8'),
    readFile(resolve(ROOT, 'public/app/core.js'), 'utf8'),
    readFile(resolve(ROOT, 'src/i18n/index.js'), 'utf8'),
    readFile(resolve(ROOT, 'public/help-content.js'), 'utf8')
  ]);
  await assert.rejects(access(resolve(ROOT, 'public/i18n.js')));

  const mountIndex = entry.indexOf('mountClassicLocalePort(portsHost, localeRegistry)');
  const helpIndex = entry.indexOf("loadClassicScript(documentRef, '/help-content.js')");
  const appIndex = entry.indexOf('await importApplication()');
  assert.ok(mountIndex >= 0 && helpIndex > mountIndex && appIndex > helpIndex);
  assert.match(entry, /localePort\?\.destroy\(\)/);
  assert.match(index, /locale-registry\.js/);
  assert.match(index, /classic-locale-port\.js/);
  assert.match(core, /markdownEditorLocalePort/);
  assert.match(core, /markdownEditorHelpContent/);
  assert.doesNotMatch(core, /\bi18n\s*\[/);
  assert.doesNotMatch(core, /window\.markdownEditor(?:Locale|I18n|Help)/);
  assert.match(help, /compatibility-business-ports/);
  assert.doesNotMatch(help, /window\.markdownEditor|window\s*\[/);
});

test('current locale audit reports a complete split registry with separate help content', async () => {
  const [audit, fixture] = await Promise.all([buildLocaleKeyAudit({ root: ROOT }), readJson(FIXTURE_PATH)]);
  assert.equal(audit.schemaVersion, 2);
  assert.equal(audit.kind, 'stage-04-split-locale-key-audit');
  assert.equal(audit.source, 'src/i18n/locale-registry.js');
  assert.deepEqual(audit.localeOrder, fixture.localeOrder);
  assert.equal(audit.unionKeys.length, 161);
  assert.deepEqual(audit.anomalies.duplicateLocales, []);
  assert.deepEqual(audit.anomalies.duplicateKeysByLocale, {});
  assert.deepEqual(audit.anomalies.missingKeysByLocale, {});
  assert.deepEqual(audit.anomalies.placeholderMismatches, []);
  assert.deepEqual(audit.anomalies.unknownReferencedKeys, []);
  assert.ok(audit.localeOrder.every(locale => audit.htmlContent[locale].length === 0));
  for (const locale of audit.localeOrder) assert.equal(audit.helpContent[locale].sha256, fixture.helpHtmlSha256ByLocale[locale]);
  assert.equal(audit.anomalies.dynamicTranslationCalls.length, 4);
  assert.ok(audit.anomalies.dynamicTranslationCalls.every(record => record.path === 'public/app/core.js'));
});
