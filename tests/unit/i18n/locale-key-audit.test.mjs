import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  collectLiteralTranslationReferences,
  extractPlaceholderSignature,
  parseLocaleDeclarations
} from '../../../scripts/stage-04/locale-key-audit.mjs';

const FIXTURE_PATH = new URL('./fixtures/locale-key-compatibility.json', import.meta.url);
const SPLIT_FIXTURE_PATH = new URL('./fixtures/locale-split-compatibility.json', import.meta.url);
const INCOMPLETE_LOCALES = ['de', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh-TW'];
const EXPECTED_MISSING_KEYS = ['importFromWeb', 'importLocalFile'];

async function loadJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

test('Atomic 4.1 historical compatibility fixture remains exact after the 4.2 migration', async () => {
  const fixture = await loadJson(FIXTURE_PATH);
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.kind, 'stage-04-locale-key-compatibility-fixture');
  assert.equal(fixture.localeOrder.length, 10);
  assert.equal(fixture.unionKeys.length, 162);
  assert.equal(fixture.localeKeyCounts['zh-CN'], 162);
  assert.equal(fixture.localeKeyCounts.en, 162);
  assert.deepEqual(fixture.duplicateLocales, []);
  assert.deepEqual(fixture.duplicateKeysByLocale, {});
  assert.deepEqual(fixture.placeholderMismatches, []);
  assert.deepEqual(fixture.unknownReferencedKeys, []);
});

test('Atomic 4.1 known missing keys are preserved as historical evidence, not silently rewritten', async () => {
  const [fixture, split] = await Promise.all([loadJson(FIXTURE_PATH), loadJson(SPLIT_FIXTURE_PATH)]);
  assert.deepEqual(Object.keys(fixture.missingKeysByLocale).sort(), [...INCOMPLETE_LOCALES].sort());
  for (const locale of INCOMPLETE_LOCALES) {
    assert.deepEqual(fixture.missingKeysByLocale[locale], EXPECTED_MISSING_KEYS);
    assert.equal(fixture.localeKeyCounts[locale], 160);
    assert.deepEqual(split.materializedFallbackKeysByLocale[locale], EXPECTED_MISSING_KEYS);
  }
  assert.deepEqual(split.materializedFallbackKeysByLocale['zh-CN'], []);
  assert.deepEqual(split.materializedFallbackKeysByLocale.en, []);
});

test('Atomic 4.1 placeholder and help HTML evidence remains frozen for the 4.2 compatibility proof', async () => {
  const [fixture, split] = await Promise.all([loadJson(FIXTURE_PATH), loadJson(SPLIT_FIXTURE_PATH)]);
  const reference = fixture.placeholderSignatures['zh-CN'];
  for (const locale of fixture.localeOrder) {
    assert.deepEqual(fixture.placeholderSignatures[locale], reference);
    assert.equal(fixture.htmlContent[locale].length, 1);
    assert.equal(fixture.htmlContent[locale][0].key, 'helpHtml');
    assert.equal(fixture.htmlContent[locale][0].sha256, split.helpHtmlSha256ByLocale[locale]);
  }
});

test('Atomic 4.1 static-literal findings remain historical evidence distinct from dynamic calls', async () => {
  const fixture = await loadJson(FIXTURE_PATH);
  assert.equal(fixture.auditMode, 'static-literal-production-references');
  assert.ok(fixture.unusedKeys.includes('welcomeDoc'));
  assert.ok(fixture.unusedKeys.includes('importFromWeb'));
});

test('locale declaration parser detects duplicate locale and key declarations before object evaluation erases them', () => {
  const parsed = parseLocaleDeclarations(`const i18n = {
  'en': {
    save: 'Save',
    save: 'Save again'
  },
  'en': {
    help: 'Help'
  }
};`);
  assert.deepEqual(parsed.duplicateLocales, [{ locale: 'en', count: 2 }]);
  assert.equal(parsed.duplicateKeysByLocale.en.length, 1);
  assert.equal(parsed.duplicateKeysByLocale.en[0].key, 'save');
  assert.deepEqual(parsed.duplicateKeysByLocale.en[0].lines, [3, 4]);
});

test('placeholder audit canonicalizes repeated and out-of-order placeholders', () => {
  assert.deepEqual(extractPlaceholderSignature('Rows {1}; value {0}; again {1}'), [0, 1]);
  assert.deepEqual(extractPlaceholderSignature('No placeholders'), []);
});

test('literal reference audit recognizes supported HTML, t() and historical direct i18n access forms', () => {
  const source = `<span data-i18n="save" data-i18n-title='boldTitle' data-i18n-placeholder="editorPlaceholder"></span>
<script>
  t('wordCount');
  i18n[currentLang].helpHtml;
  i18n[currentLang]['helpOk'];
</script>`;
  const references = collectLiteralTranslationReferences(source, 'fixture.html');
  assert.deepEqual([...references.keys()].sort(), ['boldTitle', 'editorPlaceholder', 'helpHtml', 'helpOk', 'save', 'wordCount']);
  assert.equal(references.get('save')[0].kind, 'html-binding');
  assert.equal(references.get('wordCount')[0].kind, 't-call');
  assert.equal(references.get('helpHtml')[0].kind, 'direct-i18n-property');
});
