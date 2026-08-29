import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const plannedModules = Object.freeze([
  'src/i18n/i18n-service.js',
  'src/i18n/locale-registry.js',
  'src/i18n/translation-bindings.js',
  ...['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'pt']
    .map(locale => `src/i18n/locales/${locale}.js`),
  'src/features/help/index.js',
  'src/features/help/help-controller.js',
  'src/features/help/help-state.js',
  ...['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'pt']
    .map(locale => `src/features/help/content/help.${locale}.js`),
  'src/features/help/ui/help-dialog-view.js',
  'src/features/help/ui/help-navigation-view.js',
  'src/features/settings/index.js',
  'src/features/settings/application/settings-controller.js',
  'src/features/settings/application/settings-apply-coordinator.js',
  'src/features/settings/domain/settings-schema.js',
  'src/features/settings/domain/settings-defaults.js',
  'src/features/settings/domain/settings-validation.js',
  'src/features/settings/state/settings-store.js',
  'src/features/settings/infrastructure/settings-repository.js',
  'src/features/settings/sections/general-settings.js',
  'src/features/settings/sections/editor-settings.js',
  'src/features/settings/sections/save-settings.js',
  'src/features/settings/sections/toolbar-settings.js',
  'src/features/settings/sections/performance-settings.js',
  'src/features/settings/ui/settings-dialog-view.js',
  'src/features/settings/ui/settings-navigation-view.js',
  'src/features/settings/ui/autosave-field-view.js',
  'src/features/settings/ui/color-field-view.js',
  'src/features/settings/ui/directory-field-view.js',
  'src/styles/themes/light.css',
  'src/styles/themes/dark.css'
]);

function assertResponsibilityHeader(path, source) {
  const header = source.slice(0, 1200);
  assert.match(header, /Responsibility:/, `${path}: missing Responsibility`);
  assert.match(header, /Imports:/, `${path}: missing Imports contract`);
  assert.match(header, /Exports:/, `${path}: missing Exports contract`);
  assert.match(header, /State\/side effects:/, `${path}: missing State/side effects contract`);
  assert.match(header, /Lifecycle:/, `${path}: missing Lifecycle contract`);
}

test('Stage 4 taskbook planned files exist and declare responsibility contracts', async () => {
  const failures = [];
  for (const path of plannedModules) {
    try {
      await access(path);
      const source = await readFile(path, 'utf8');
      assertResponsibilityHeader(path, source);
    } catch (error) {
      failures.push(`${path}: ${error.message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('Stage 4 final cutover keeps the retired classic I18n implementation absent', async () => {
  await assert.rejects(access('public/i18n.js'));
  const [core, bootstrap] = await Promise.all([
    readFile('public/app/core.js', 'utf8'),
    readFile('public/app/bootstrap.js', 'utf8')
  ]);
  assert.doesNotMatch(core, /let currentLang\s*=|function setLanguage\s*\(|coreI18nPort\.setLocale\(/);
  assert.doesNotMatch(bootstrap, /savedLang|coreI18nPort\.setLocale\(|currentLang\s*=/);
});
