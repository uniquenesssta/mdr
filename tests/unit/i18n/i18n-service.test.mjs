import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createI18nService } from '../../../src/i18n/i18n-service.js';
import { mountClassicI18nPort } from '../../../src/i18n/compatibility/classic-i18n-port.js';
import { localeRegistry } from '../../../src/i18n/locale-registry.js';

function createLooseRegistry() {
  const dictionaries = new Map([
    ['zh-CN', Object.freeze({ greeting: '你好，{0}', repeated: '{0}/{0}', fallbackOnly: '默认值' })],
    ['en', Object.freeze({ greeting: 'Hello, {0}', repeated: '{0}/{0}' })]
  ]);
  return Object.freeze({
    defaultLocale: 'zh-CN',
    has(locale) {
      return dictionaries.has(locale);
    },
    get(locale) {
      return dictionaries.get(locale) || null;
    }
  });
}

test('Atomic 4.3 I18n Service owns locale state with deterministic default normalization', () => {
  const service = createI18nService(localeRegistry, { initialLocale: 'ja' });
  assert.equal(service.locale, 'ja');
  assert.equal(service.defaultLocale, 'zh-CN');
  assert.equal(service.setLocale('en'), 'en');
  assert.equal(service.locale, 'en');
  assert.equal(service.setLocale('not-a-locale'), 'zh-CN');
  assert.equal(service.locale, 'zh-CN');
  service.destroy();

  const fallbackService = createI18nService(localeRegistry, { initialLocale: 'not-a-locale' });
  assert.equal(fallbackService.locale, 'zh-CN');
  fallbackService.destroy();
});

test('Atomic 4.3 t() preserves legacy placeholder formatting and fallback-to-key behavior', () => {
  const service = createI18nService(createLooseRegistry(), { initialLocale: 'en' });
  assert.equal(service.t('greeting', 'Ada'), 'Hello, Ada');
  assert.equal(service.t('repeated', 7), '7/7');
  assert.equal(service.t('fallbackOnly'), '默认值');
  assert.equal(service.t('missingKey'), 'missingKey');
  service.destroy();
});

test('Atomic 4.3 locale switching emits immutable events only for real transitions', () => {
  const service = createI18nService(localeRegistry);
  const events = [];
  const dispose = service.subscribe(event => events.push(event));

  assert.equal(service.setLocale('en'), 'en');
  assert.equal(service.setLocale('en'), 'en');
  assert.equal(service.setLocale('invalid'), 'zh-CN');
  assert.deepEqual(events, [
    { locale: 'en', previousLocale: 'zh-CN' },
    { locale: 'zh-CN', previousLocale: 'en' }
  ]);
  assert.ok(events.every(Object.isFrozen));

  dispose();
  dispose();
  service.setLocale('ja');
  assert.equal(events.length, 2);
  service.destroy();
});

test('Atomic 4.3 listener failures do not roll back state and multiple failures are aggregated', () => {
  const service = createI18nService(localeRegistry);
  const delivered = [];
  service.subscribe(() => { throw new Error('first'); });
  service.subscribe(event => delivered.push(event.locale));
  service.subscribe(() => { throw new Error('second'); });

  assert.throws(
    () => service.setLocale('en'),
    error => error instanceof AggregateError
      && error.errors.map(item => item.message).join(',') === 'first,second'
  );
  assert.equal(service.locale, 'en');
  assert.deepEqual(delivered, ['en']);
  service.destroy();
});

test('Atomic 4.3 destroy is idempotent and makes stateful service operations terminal', () => {
  const service = createI18nService(localeRegistry);
  const dispose = service.subscribe(() => {});
  service.destroy();
  service.destroy();
  dispose();

  assert.throws(() => service.locale, /I18n service is destroyed/);
  assert.throws(() => service.t('saved'), /I18n service is destroyed/);
  assert.throws(() => service.setLocale('en'), /I18n service is destroyed/);
  assert.throws(() => service.subscribe(() => {}), /I18n service is destroyed/);
});

test('Atomic 4.3 classic I18n port exposes service semantics without raw locale dictionaries', () => {
  const service = createI18nService(localeRegistry);
  const target = { removeAttribute() {} };
  const mount = mountClassicI18nPort(target, service);
  const port = target.markdownEditorI18nPort;
  const events = [];

  assert.equal(port.locale, 'zh-CN');
  assert.equal(port.t('saved'), service.t('saved'));
  assert.equal(typeof port.getLocale, 'undefined');
  assert.equal(typeof port.hasLocale, 'undefined');
  const dispose = port.subscribe(event => events.push(event.locale));
  assert.equal(port.setLocale('en'), 'en');
  assert.deepEqual(events, ['en']);

  mount.destroy();
  mount.destroy();
  dispose();
  assert.equal(Object.hasOwn(target, 'markdownEditorI18nPort'), false);
  assert.throws(() => port.t('saved'), /Classic I18n port is destroyed/);
  service.destroy();
});

test('Atomic 4.3 production integration keeps service DOM/storage-free and removes classic translation ownership', async () => {
  const [serviceSource, portSource, moduleEntry, core, bootstrap] = await Promise.all([
    readFile('src/i18n/i18n-service.js', 'utf8'),
    readFile('src/i18n/compatibility/classic-i18n-port.js', 'utf8'),
    readFile('src/bootstrap/module-entry.js', 'utf8'),
    readFile('public/app/core.js', 'utf8'),
    readFile('public/app/bootstrap.js', 'utf8')
  ]);

  assert.doesNotMatch(serviceSource, /\bdocument\b|\bwindow\b|localStorage|querySelector|querySelectorAll/);
  assert.doesNotMatch(portSource, /getLocale|hasLocale|markdownEditorLocalePort/);
  assert.match(moduleEntry, /createI18nService\(localeRegistry\)/);
  assert.match(moduleEntry, /mountClassicI18nPort\(portsHost, i18nService\)/);
  assert.match(moduleEntry, /i18nPort\?\.destroy\(\)/);
  assert.match(moduleEntry, /i18nService\?\.destroy\(\)/);
  assert.ok(moduleEntry.indexOf('i18nPort?.destroy()') < moduleEntry.indexOf('i18nService?.destroy()'));

  assert.match(core, /markdownEditorI18nPort/);
  assert.match(core, /return coreI18nPort\.t\(key, \.\.\.args\)/);
  assert.match(core, /coreI18nPort\.setLocale\(lang\)/);
  assert.match(core, /refreshClassicLocalizedState\(currentLang = coreI18nPort\.locale\)/);
  assert.doesNotMatch(core, /markdownEditorLocalePort|coreLocalePort|getLocale\(|hasLocale\(|let currentLang\s*=/);

  assert.match(bootstrap, /if \(savedLang\) coreI18nPort\.setLocale\(savedLang\)/);
  assert.doesNotMatch(bootstrap, /i18n\s*\[\s*savedLang\s*\]|currentLang\s*=\s*savedLang/);
});
