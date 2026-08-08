import assert from 'node:assert/strict';
import test from 'node:test';
import { createTranslationBindings } from '../../../src/i18n/translation-bindings.js';

const VIEW_NAMES = ['menu', 'toolbar', 'sidebar', 'editor', 'preview', 'status', 'overlay'];

function createI18n() {
  const dictionaries = {
    en: { text: 'Text', title: 'Title', placeholder: 'Placeholder', alt: 'Alt', aria: 'Aria' },
    fr: { text: 'Texte', title: 'Titre', placeholder: 'Espace', alt: 'Alternatif', aria: 'Libellé' }
  };
  let locale = 'en';
  const listeners = new Set();
  return {
    get locale() { return locale; },
    t(key) { return dictionaries[locale]?.[key] ?? key; },
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
      locale = next;
      const errors = [];
      for (const listener of [...listeners]) {
        try { listener({ locale: next }); } catch (error) { errors.push(error); }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors);
    }
  };
}

function createFixture(elementsByView = {}) {
  const documentElement = {
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
  };
  const ownerDocument = { documentElement };
  const queryCounts = new Map();
  const views = Object.fromEntries(VIEW_NAMES.map(name => [name, {
    ownerDocument,
    querySelectorAll(selector) {
      assert.equal(selector, '[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-alt], [data-i18n-aria-label]');
      queryCounts.set(name, (queryCounts.get(name) || 0) + 1);
      return elementsByView[name] || [];
    }
  }]));
  return { documentElement, queryCounts, views };
}

function element(dataset = {}) {
  return {
    dataset: { ...dataset },
    textContent: '',
    title: '',
    placeholder: '',
    alt: '',
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
  };
}

test('binds text, title, placeholder, alt and aria-label across explicit View roots', () => {
  const text = element({ i18n: 'text' });
  const title = element({ i18nTitle: 'title' });
  const placeholder = element({ i18nPlaceholder: 'placeholder' });
  const alt = element({ i18nAlt: 'alt' });
  const aria = element({ i18nAriaLabel: 'aria' });
  const fixture = createFixture({ menu: [text], toolbar: [title], editor: [placeholder], preview: [alt], overlay: [aria] });
  const i18n = createI18n();
  const bindings = createTranslationBindings(i18n, fixture.views, { documentElement: fixture.documentElement });

  assert.equal(bindings.bindingCount, 5);
  assert.equal(text.textContent, 'Text');
  assert.equal(title.title, 'Title');
  assert.equal(placeholder.placeholder, 'Placeholder');
  assert.equal(alt.alt, 'Alt');
  assert.equal(aria.attributes.get('aria-label'), 'Aria');
  assert.equal(fixture.documentElement.attributes.get('lang'), 'en');
  bindings.destroy();
});

test('locale changes refresh cached bindings without rescanning any View', () => {
  const node = element({ i18n: 'text', i18nTitle: 'title' });
  const fixture = createFixture({ toolbar: [node] });
  const i18n = createI18n();
  const bindings = createTranslationBindings(i18n, fixture.views, { documentElement: fixture.documentElement });
  assert.deepEqual(Object.fromEntries(fixture.queryCounts), Object.fromEntries(VIEW_NAMES.map(name => [name, 1])));

  i18n.setLocale('fr');
  assert.equal(node.textContent, 'Texte');
  assert.equal(node.title, 'Titre');
  assert.equal(fixture.documentElement.attributes.get('lang'), 'fr');
  assert.deepEqual(Object.fromEntries(fixture.queryCounts), Object.fromEntries(VIEW_NAMES.map(name => [name, 1])));
  bindings.destroy();
});

test('destroy removes the locale subscription and is idempotent', () => {
  const node = element({ i18n: 'text' });
  const fixture = createFixture({ menu: [node] });
  const i18n = createI18n();
  const bindings = createTranslationBindings(i18n, fixture.views, { documentElement: fixture.documentElement });

  bindings.destroy();
  bindings.destroy();
  i18n.setLocale('fr');
  assert.equal(node.textContent, 'Text');
  assert.throws(() => bindings.refresh(), /Translation bindings are destroyed/);
  assert.throws(() => bindings.bindingCount, /Translation bindings are destroyed/);
});

test('requires every named View and rejects cross-document roots', () => {
  const i18n = createI18n();
  const fixture = createFixture();
  const missing = { ...fixture.views };
  delete missing.sidebar;
  assert.throws(() => createTranslationBindings(i18n, missing, { documentElement: fixture.documentElement }), /sidebar View root/);

  const otherDocumentElement = { setAttribute() {} };
  const crossDocument = { ...fixture.views, status: { ownerDocument: { documentElement: otherDocumentElement }, querySelectorAll() { return []; } } };
  assert.throws(() => createTranslationBindings(i18n, crossDocument, { documentElement: fixture.documentElement }), /another document/);
});

test('does not depend on a global document or window', () => {
  const fixture = createFixture();
  const i18n = createI18n();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  try {
    globalThis.document = { querySelectorAll() { throw new Error('global scan'); } };
    globalThis.window = { document: globalThis.document };
    const bindings = createTranslationBindings(i18n, fixture.views, { documentElement: fixture.documentElement });
    assert.equal(bindings.bindingCount, 0);
    bindings.destroy();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('refresh continues through binding failures and reports them after remaining writes', () => {
  let fail = false;
  const broken = element({ i18n: 'text' });
  Object.defineProperty(broken, 'textContent', {
    get() { return ''; },
    set(value) { if (fail) throw new Error(`broken:${value}`); }
  });
  const healthy = element({ i18n: 'text' });
  const fixture = createFixture({ menu: [broken, healthy] });
  const i18n = createI18n();
  const bindings = createTranslationBindings(i18n, fixture.views, { documentElement: fixture.documentElement });

  fail = true;
  assert.throws(() => i18n.setLocale('fr'), /broken:Texte/);
  assert.equal(healthy.textContent, 'Texte');
  assert.equal(fixture.documentElement.attributes.get('lang'), 'fr');
  bindings.destroy();
});

test('production integration has one declarative translation owner and preserves the 114 existing bindings', async () => {
  const { readFile } = await import('node:fs/promises');
  const [moduleEntry, core, bootstrap, index, markup, helpDialog] = await Promise.all([
    readFile('src/bootstrap/module-entry.js', 'utf8'),
    readFile('public/app/core.js', 'utf8'),
    readFile('public/app/bootstrap.js', 'utf8'),
    readFile('src/i18n/index.js', 'utf8'),
    readFile('public/compatibility/business-content.html', 'utf8'),
    readFile('src/features/help/ui/help-dialog-view.js', 'utf8')
  ]);

  assert.match(index, /translation-bindings\.js/);
  assert.match(moduleEntry, /createTranslationBindings\(i18nService, ui,/);
  assert.match(moduleEntry, /translationBindings\?\.destroy\(\)/);
  assert.ok(moduleEntry.indexOf('i18nPort?.destroy()') < moduleEntry.indexOf('translationBindings?.destroy()'));
  assert.ok(moduleEntry.indexOf('translationBindings?.destroy()') < moduleEntry.indexOf('i18nService?.destroy()'));

  assert.doesNotMatch(core, /function applyLanguage\s*\(/);
  assert.doesNotMatch(core, /querySelectorAll\(['"]\[data-i18n/);
  assert.doesNotMatch(core, /document\.documentElement\.lang\s*=/);
  assert.match(core, /coreI18nPort\.subscribe\(\(\) => refreshClassicLocalizedState\(\)\)/);
  assert.match(bootstrap, /refreshClassicLocalizedState\(\)/);
  assert.doesNotMatch(bootstrap, /applyLanguage\(\)/);

  const markupBindings = markup.match(/\sdata-i18n(?:-title|-placeholder|-alt)?="[^"]+"/g) || [];
  const helpBindings = helpDialog.match(/['"]data-i18n['"]\s*:\s*['"][^'"]+['"]/g) || [];
  assert.equal(markupBindings.length, 112);
  assert.equal(helpBindings.length, 2);
  assert.equal(markupBindings.length + helpBindings.length, 114);
});
