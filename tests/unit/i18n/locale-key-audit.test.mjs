import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildLocaleKeyAudit,
  collectLiteralTranslationReferences,
  extractPlaceholderSignature,
  parseLocaleDeclarations
} from '../../../scripts/stage-04/locale-key-audit.mjs';

const FIXTURE_PATH = new URL('./fixtures/locale-key-compatibility.json', import.meta.url);
const INCOMPLETE_LOCALES = ['de', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh-TW'];
const EXPECTED_MISSING_KEYS = ['importFromWeb', 'importLocalFile'];

function toCompatibilityFixture(audit) {
  return {
    schemaVersion: 1,
    kind: 'stage-04-locale-key-compatibility-fixture',
    source: audit.source,
    auditMode: audit.auditMode,
    localeOrder: audit.localeOrder,
    unionKeys: audit.unionKeys,
    localeKeyCounts: Object.fromEntries(
      audit.localeOrder.map(locale => [locale, audit.localeKeys[locale].length])
    ),
    missingKeysByLocale: audit.anomalies.missingKeysByLocale,
    placeholderSignatures: audit.placeholderSignatures,
    htmlContent: audit.htmlContent,
    duplicateLocales: audit.anomalies.duplicateLocales,
    duplicateKeysByLocale: audit.anomalies.duplicateKeysByLocale,
    placeholderMismatches: audit.anomalies.placeholderMismatches,
    unusedKeys: audit.anomalies.unusedKeys,
    unknownReferencedKeys: audit.anomalies.unknownReferencedKeys
  };
}

async function loadFixture() {
  return JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
}

test('Atomic 4.1 freezes the current locale key compatibility surface without correcting it', async () => {
  const [audit, fixture] = await Promise.all([buildLocaleKeyAudit(), loadFixture()]);

  assert.deepEqual(toCompatibilityFixture(audit), fixture);
  assert.equal(audit.localeOrder.length, 10);
  assert.equal(audit.unionKeys.length, 162);
  assert.deepEqual(audit.anomalies.duplicateLocales, []);
  assert.deepEqual(audit.anomalies.duplicateKeysByLocale, {});
  assert.deepEqual(audit.anomalies.placeholderMismatches, []);
  assert.deepEqual(audit.anomalies.unknownReferencedKeys, []);
});

test('Atomic 4.1 records known missing keys instead of silently filling them', async () => {
  const audit = await buildLocaleKeyAudit();
  assert.deepEqual(Object.keys(audit.anomalies.missingKeysByLocale).sort(), [...INCOMPLETE_LOCALES].sort());

  for (const locale of INCOMPLETE_LOCALES) {
    assert.deepEqual(audit.anomalies.missingKeysByLocale[locale], EXPECTED_MISSING_KEYS);
    assert.equal(audit.localeKeys[locale].length, 160);
  }
  assert.equal(audit.localeKeys['zh-CN'].length, 162);
  assert.equal(audit.localeKeys.en.length, 162);
});

test('Atomic 4.1 freezes placeholder signatures and long HTML content separately', async () => {
  const audit = await buildLocaleKeyAudit();
  const referencePlaceholders = audit.placeholderSignatures['zh-CN'];

  for (const locale of audit.localeOrder) {
    assert.deepEqual(audit.placeholderSignatures[locale], referencePlaceholders);
    assert.equal(audit.htmlContent[locale].length, 1);
    assert.equal(audit.htmlContent[locale][0].key, 'helpHtml');
    assert.match(audit.htmlContent[locale][0].sha256, /^[a-f0-9]{64}$/);
    assert.ok(audit.htmlContent[locale][0].length > 0);
  }
});

test('Atomic 4.1 keeps static-literal unused findings distinct from dynamic translation calls', async () => {
  const audit = await buildLocaleKeyAudit();
  assert.equal(audit.auditMode, 'static-literal-production-references');
  assert.ok(audit.anomalies.unusedKeys.includes('welcomeDoc'));
  assert.ok(audit.anomalies.unusedKeys.includes('importFromWeb'));
  assert.equal(audit.anomalies.dynamicTranslationCalls.length, 4);
  assert.ok(audit.anomalies.dynamicTranslationCalls.every(record => record.path === 'public/app/core.js'));
  assert.ok(audit.anomalies.dynamicTranslationCalls.every(record => record.expression === 'key'));
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

test('literal reference audit recognizes supported HTML, t() and direct i18n access paths', () => {
  const source = `<span data-i18n="save" data-i18n-title='boldTitle' data-i18n-placeholder="editorPlaceholder"></span>
<script>
  t('wordCount');
  i18n[currentLang].helpHtml;
  i18n[currentLang]['helpOk'];
</script>`;
  const references = collectLiteralTranslationReferences(source, 'fixture.html');

  assert.deepEqual([...references.keys()].sort(), [
    'boldTitle',
    'editorPlaceholder',
    'helpHtml',
    'helpOk',
    'save',
    'wordCount'
  ]);
  assert.equal(references.get('save')[0].kind, 'html-binding');
  assert.equal(references.get('wordCount')[0].kind, 't-call');
  assert.equal(references.get('helpHtml')[0].kind, 'direct-i18n-property');
});
