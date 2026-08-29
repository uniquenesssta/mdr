import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { SETTINGS_CHANGED_EVENT } from '../../../src/features/settings/index.js';
import { createSettingsLocaleController } from '../../../src/i18n/settings-locale-controller.js';

function createI18n(initial = 'zh-CN') {
  let locale = initial;
  const calls = [];
  return {
    get locale() { return locale; },
    get calls() { return [...calls]; },
    setLocale(next) { calls.push(next); locale = next; return next; }
  };
}

function createEventTarget({ failAdd = false, failRemove = false, installBeforeThrow = false } = {}) {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (installBeforeThrow) listeners.set(type, listener);
      if (failAdd) throw new Error('listener install failed');
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (failRemove) throw new Error('listener remove failed');
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    dispatch(detail) {
      return listeners.get(SETTINGS_CHANGED_EVENT)?.({ detail });
    },
    listenerCount() { return listeners.size; }
  };
}

function snapshot(language = 'zh-CN') {
  return { language };
}

test('Atomic 4.12 Settings Locale Controller applies only committed language changes', () => {
  const i18n = createI18n();
  const target = createEventTarget();
  const controller = createSettingsLocaleController({ i18n, eventTarget: target, eventType: SETTINGS_CHANGED_EVENT });
  target.dispatch({ changedIds: ['theme'], snapshot: snapshot('en') });
  assert.deepEqual(i18n.calls, []);
  target.dispatch({ changedIds: ['language'], snapshot: snapshot('en') });
  assert.deepEqual(i18n.calls, ['en']);
  assert.equal(i18n.locale, 'en');
  controller.destroy();
});

test('Atomic 4.12 Settings Locale Controller ignores malformed and unrelated events', () => {
  const i18n = createI18n();
  const target = createEventTarget();
  const controller = createSettingsLocaleController({ i18n, eventTarget: target, eventType: SETTINGS_CHANGED_EVENT });
  target.dispatch(null);
  target.dispatch({});
  target.dispatch({ changedIds: 'language', snapshot: snapshot('en') });
  target.dispatch({ changedIds: [], snapshot: snapshot('en') });
  assert.deepEqual(i18n.calls, []);
  controller.destroy();
});

test('Atomic 4.12 validates the committed language before delegating to I18n Service', () => {
  const i18n = createI18n();
  const target = createEventTarget();
  const controller = createSettingsLocaleController({ i18n, eventTarget: target, eventType: SETTINGS_CHANGED_EVENT });
  i18n.setLocale = next => {
    if (next === 'not-a-locale') throw new RangeError('Unsupported locale: not-a-locale');
    return next;
  };
  assert.throws(
    () => target.dispatch({ changedIds: ['language'], snapshot: snapshot('not-a-locale') }),
    /Unsupported locale/
  );
  assert.equal(i18n.locale, 'zh-CN');
  controller.destroy();
});

test('Atomic 4.12 destroy removes the Settings listener, is idempotent and makes explicit apply terminal', () => {
  const i18n = createI18n();
  const target = createEventTarget();
  const controller = createSettingsLocaleController({ i18n, eventTarget: target, eventType: SETTINGS_CHANGED_EVENT });
  assert.equal(target.listenerCount(), 1);
  controller.destroy();
  controller.destroy();
  assert.equal(target.listenerCount(), 0);
  target.dispatch({ changedIds: ['language'], snapshot: snapshot('en') });
  assert.deepEqual(i18n.calls, []);
  assert.throws(() => controller.applySnapshot(snapshot('en')), /destroyed/);
});

test('Atomic 4.12 construction rolls back a partially installed Settings listener', () => {
  const target = createEventTarget({ failAdd: true, installBeforeThrow: true });
  assert.throws(
    () => createSettingsLocaleController({ i18n: createI18n(), eventTarget: target, eventType: SETTINGS_CHANGED_EVENT }),
    /listener install failed/
  );
  assert.equal(target.listenerCount(), 0);
});

test('Atomic 4.12 production integration removes legacy locale ownership from public i18n, core and bootstrap', async () => {
  await assert.rejects(access('public/i18n.js'), error => error?.code === 'ENOENT');
  const [index, controllerSource, moduleEntry, core, bootstrap, main] = await Promise.all([
    readFile('src/i18n/index.js', 'utf8'),
    readFile('src/i18n/settings-locale-controller.js', 'utf8'),
    readFile('src/bootstrap/module-entry.js', 'utf8'),
    readFile('public/app/core.js', 'utf8'),
    readFile('public/app/bootstrap.js', 'utf8'),
    readFile('src/main.js', 'utf8')
  ]);

  assert.match(index, /settings-locale-controller\.js/);
  assert.doesNotMatch(controllerSource, /features\/settings|settings-schema|settings-validation|i18n\/index/);
  assert.match(controllerSource, /eventType/);
  assert.match(moduleEntry, /createI18nService\(localeRegistry, \{ initialLocale: settingsStore\.get\('language'\) \}\)/);
  assert.match(moduleEntry, /createSettingsLocaleController\(\{[\s\S]*i18n: i18nService,[\s\S]*eventTarget: documentRef,[\s\S]*eventType: SETTINGS_CHANGED_EVENT[\s\S]*\}\)/);
  assert.ok(moduleEntry.indexOf('createSettingsStore({') < moduleEntry.indexOf('createI18nService(localeRegistry'));
  assert.ok(moduleEntry.indexOf('settingsLocaleController?.destroy()') < moduleEntry.indexOf('i18nService?.destroy()'));

  assert.match(core, /return coreI18nPort\.t\(key, \.\.\.args\)/);
  assert.match(core, /coreI18nPort\.subscribe\(\(\) => refreshClassicLocalizedState\(\)\)/);
  assert.doesNotMatch(core, /function setLanguage\s*\(|coreI18nPort\.setLocale\(/);
  assert.doesNotMatch(bootstrap, /savedLang|coreI18nPort\.setLocale\(/);

  for (const source of [core, bootstrap, main, moduleEntry]) {
    assert.doesNotMatch(source, /\bcurrentLang\b/);
    assert.doesNotMatch(source, /(?:window|globalThis)\.i18n\b/);
  }
  assert.doesNotMatch(main, /public\/i18n\.js|['"]\/i18n\.js['"]/);
});
