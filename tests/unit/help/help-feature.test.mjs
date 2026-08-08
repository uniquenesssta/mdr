import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import {
  HELP_PAGE_IDS,
  HELP_SHOWN_STORAGE_KEY,
  createHelpContentRegistry,
  createHelpController,
  createHelpState,
  helpContentRegistry,
  mountClassicHelpPort
} from '../../../src/features/help/index.js';
import enContent from '../../../src/features/help/content/help.en.js';

const sha256 = value => createHash('sha256').update(String(value), 'utf8').digest('hex');

function createI18n(initialLocale = 'zh-CN') {
  let locale = initialLocale;
  const listeners = new Set();
  return {
    get locale() { return locale; },
    subscribe(listener) {
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },
    setLocale(next) {
      const previousLocale = locale;
      locale = next;
      for (const listener of [...listeners]) listener(Object.freeze({ locale, previousLocale }));
    },
    get listenerCount() { return listeners.size; }
  };
}

function createStorage(entries = []) {
  const values = new Map(entries);
  return {
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    value(key) { return values.get(String(key)); }
  };
}

function createTrigger() {
  const listeners = new Map();
  return {
    tagName: 'DIV',
    ownerDocument: {},
    setAttribute() {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    click() { listeners.get('click')?.({ target: this }); }
  };
}

function createControllerFixture({ locale = 'zh-CN', storageEntries = [] } = {}) {
  const i18n = createI18n(locale);
  const storage = createStorage(storageEntries);
  const state = createHelpState();
  const openTrigger = createTrigger();
  const calls = [];
  let activeButton = { tagName: 'BUTTON', ownerDocument: {}, setAttribute() {} };
  let onClose = null;
  let open = false;
  const navigationView = {
    render(document, page) { calls.push(['nav-render', document.locale, page]); },
    setActive(page) { calls.push(['nav-active', page]); return page; },
    getActiveButton() { return activeButton; },
    destroy() { calls.push(['nav-destroy']); }
  };
  const dialogView = {
    renderDocument(document) { calls.push(['dialog-document', document.locale]); },
    renderPage(page) { calls.push(['dialog-page', page.id]); },
    open(options) { calls.push(['dialog-open']); onClose = options.onClose; activeButton = options.initialFocus; open = true; return true; },
    close(reason) { if (!open) return false; open = false; calls.push(['dialog-close', reason]); const callback = onClose; onClose = null; callback?.(reason); return true; },
    isOpen() { return open; },
    destroy() { calls.push(['dialog-destroy']); if (open) { open = false; const callback = onClose; onClose = null; callback?.('destroy'); } }
  };
  const controller = createHelpController({
    i18n,
    contentRegistry: helpContentRegistry,
    state,
    dialogView,
    navigationView,
    storage,
    openTrigger
  });
  return { controller, i18n, storage, state, openTrigger, calls };
}

test('Atomic 4.5 exposes ten independent Help content modules while preserving the frozen long-form HTML hashes', async () => {
  const fixture = JSON.parse(await readFile('tests/unit/i18n/fixtures/locale-split-compatibility.json', 'utf8'));
  assert.deepEqual([...helpContentRegistry.localeIds], fixture.localeOrder);
  assert.equal(helpContentRegistry.defaultLocale, 'zh-CN');
  const files = (await readdir('src/features/help/content')).filter(name => /^help\..+\.js$/.test(name)).sort();
  assert.equal(files.length, 10);

  for (const locale of fixture.localeOrder) {
    const document = helpContentRegistry.get(locale);
    assert.ok(Object.isFrozen(document));
    assert.ok(Object.isFrozen(document.pages));
    assert.deepEqual(Object.keys(document.pages), HELP_PAGE_IDS);
    assert.equal(sha256(document.sourceHtml), fixture.helpHtmlSha256ByLocale[locale], `${locale} long-form hash`);
    for (const page of Object.values(document.pages)) {
      assert.ok(Object.isFrozen(page));
      assert.equal(typeof page.title, 'string');
      assert.equal(typeof page.summary, 'string');
    }
  }
  assert.equal(helpContentRegistry.get('missing').locale, 'zh-CN');
});

test('Help content registry rejects duplicate, malformed and executable content without weakening fallback behavior', () => {
  assert.throws(() => createHelpContentRegistry([enContent, { ...enContent }], { defaultLocale: 'en' }), /Duplicate help locale/);
  assert.throws(() => createHelpContentRegistry([{ ...enContent, locale: 'x', sourceHtml: '<p>short</p>' }], { defaultLocale: 'x' }), /preserved long-form structure/);
  assert.throws(() => createHelpContentRegistry([{ ...enContent, locale: 'x', aboutHtml: '<script>alert(1)<\/script>' }], { defaultLocale: 'x' }), /executable markup/);
  assert.throws(() => createHelpContentRegistry([enContent], { defaultLocale: 'fr' }), /Default help locale is missing/);
});

test('Help state owns one normalized navigation page and becomes terminal after destroy', () => {
  const state = createHelpState({ initialPage: 'views' });
  assert.equal(state.activePage, 'views');
  assert.equal(state.navigate('files'), 'files');
  assert.equal(state.navigate('unknown'), 'start');
  state.destroy();
  state.destroy();
  assert.throws(() => state.activePage, /destroyed/);
  assert.throws(() => state.navigate('start'), /destroyed/);
});

test('Help controller preserves first-show semantics, owns navigation and handles the explicit menu trigger', () => {
  const { controller, storage, openTrigger, calls } = createControllerFixture();
  assert.equal(storage.getItem(HELP_SHOWN_STORAGE_KEY), null);
  assert.equal(controller.openFirstRun(), true);
  assert.equal(controller.isOpen(), true);
  assert.equal(storage.getItem(HELP_SHOWN_STORAGE_KEY), null, 'opening alone must not mark Help as shown');
  assert.equal(controller.navigate('files'), 'files');
  assert.equal(controller.activePage, 'files');
  assert.equal(controller.close('feature-close'), true);
  assert.equal(storage.value(HELP_SHOWN_STORAGE_KEY), 'true');
  assert.equal(controller.openFirstRun(), false);
  openTrigger.click();
  assert.equal(controller.isOpen(), true);
  assert.ok(calls.some(call => call[0] === 'dialog-open'));
  controller.destroy();
});

test('Help controller keeps the active page across locale changes and unsubscribes before terminal destroy', () => {
  const { controller, i18n, calls } = createControllerFixture({ locale: 'en', storageEntries: [[HELP_SHOWN_STORAGE_KEY, 'true']] });
  controller.navigate('markdown');
  const beforeLocaleChange = calls.length;
  i18n.setLocale('fr');
  assert.equal(controller.activePage, 'markdown');
  assert.ok(calls.slice(beforeLocaleChange).some(call => call[0] === 'dialog-document' && call[1] === 'fr'));
  assert.ok(calls.slice(beforeLocaleChange).some(call => call[0] === 'dialog-page' && call[1] === 'markdown'));
  assert.equal(i18n.listenerCount, 1);
  controller.destroy();
  controller.destroy();
  assert.equal(i18n.listenerCount, 0);
  const afterDestroy = calls.length;
  i18n.setLocale('de');
  assert.equal(calls.length, afterDestroy);
  assert.throws(() => controller.open(), /destroyed/);
});

test('Help controller construction rolls back locale subscriptions when menu listener installation fails', () => {
  const i18n = createI18n();
  const storage = createStorage();
  const state = createHelpState();
  const dialogView = {
    renderDocument() {}, renderPage() {}, open() { return true; }, close() { return true; }, isOpen() { return false; }, destroy() {}
  };
  const navigationView = {
    render() {}, setActive(page) { return page; }, getActiveButton() { return null; }, destroy() {}
  };
  const openTrigger = {
    tagName: 'DIV', ownerDocument: {}, setAttribute() {},
    addEventListener() { throw new Error('listener install failed'); },
    removeEventListener() {}
  };

  assert.throws(() => createHelpController({
    i18n, contentRegistry: helpContentRegistry, state, dialogView, navigationView, storage, openTrigger
  }), /listener install failed/);
  assert.equal(i18n.listenerCount, 0);
  state.destroy();
});

test('Classic Help port delegates only the controller contract and is removed cleanly on destroy', () => {
  const calls = [];
  const host = { removeAttribute() {} };
  const controller = {
    activePage: 'start',
    open(page) { calls.push(['open', page]); return true; },
    close(reason) { calls.push(['close', reason]); return true; },
    navigate(page) { calls.push(['navigate', page]); return page; },
    openFirstRun() { calls.push(['first']); return false; },
    isOpen() { return false; }
  };
  const mount = mountClassicHelpPort(host, controller);
  assert.equal(Object.keys(host).includes('markdownEditorHelpPort'), false);
  assert.equal(host.markdownEditorHelpPort.open('files'), true);
  assert.equal(host.markdownEditorHelpPort.navigate('views'), 'views');
  assert.equal(host.markdownEditorHelpPort.openFirstRun(), false);
  assert.deepEqual(calls, [['open', 'files'], ['navigate', 'views'], ['first']]);
  mount.destroy();
  mount.destroy();
  assert.equal(Object.hasOwn(host, 'markdownEditorHelpPort'), false);
  assert.throws(() => mount.api.open(), /destroyed/);
});

test('Atomic 4.5 production integration removes the classic Help authority and wires one ESM Help feature before Translation Bindings', async () => {
  const [entry, core, bootstrap, editorTools, markup, modalBridge, helpDialog, sourceAnalysis] = await Promise.all([
    readFile('src/bootstrap/module-entry.js', 'utf8'),
    readFile('public/app/core.js', 'utf8'),
    readFile('public/app/bootstrap.js', 'utf8'),
    readFile('public/app/editor-tools.js', 'utf8'),
    readFile('public/compatibility/business-content.html', 'utf8'),
    readFile('src/ui/compatibility/mount-modal-shells.js', 'utf8'),
    readFile('src/features/help/ui/help-dialog-view.js', 'utf8'),
    readFile('scripts/architecture/source-analysis.mjs', 'utf8')
  ]);
  await assert.rejects(access('public/help-content.js'));

  const serviceIndex = entry.indexOf('createI18nService(localeRegistry)');
  const helpIndex = entry.indexOf('createHelpFeature({');
  const bindingsIndex = entry.indexOf('createTranslationBindings(i18nService, ui,');
  const appIndex = entry.indexOf('await importApplication()');
  assert.ok(serviceIndex >= 0 && helpIndex > serviceIndex && bindingsIndex > helpIndex && appIndex > bindingsIndex);
  assert.match(entry, /mountClassicHelpPort\(portsHost, helpController\)/);
  assert.doesNotMatch(entry, /loadClassicScript|\/help-content\.js/);
  assert.ok(entry.indexOf('translationBindings?.destroy()') < entry.indexOf('helpController?.destroy()'));
  assert.ok(entry.indexOf('helpController?.destroy()') < entry.indexOf('i18nService?.destroy()'));

  assert.doesNotMatch(core, /markdownEditorHelpContent|HELP_SHOWN_KEY|help-body|data-help-page-panel/);
  assert.doesNotMatch(editorTools, /function\s+(?:openHelp|closeHelp|switchHelpPage)\b|activeHelpPage/);
  assert.match(bootstrap, /markdownEditorHelpPort/);
  assert.match(bootstrap, /bootstrapHelpPort\.openFirstRun\(\)/);
  assert.doesNotMatch(bootstrap, /HELP_SHOWN_KEY|openHelp\(/);

  assert.match(markup, /data-help-open/);
  assert.doesNotMatch(markup, /id="help-modal"|openHelp\(|closeHelp\(|switchHelpPage\(/);
  assert.doesNotMatch(modalBridge, /id: 'help-modal'/);
  assert.match(helpDialog, /id: 'help-modal'/);
  assert.match(helpDialog, /'data-i18n': 'helpTitle'/);
  assert.match(helpDialog, /'data-i18n': 'helpOk'/);
  assert.doesNotMatch(helpDialog, /onclick=/);
  assert.doesNotMatch(sourceAnalysis, /help-content\.js/);
});
