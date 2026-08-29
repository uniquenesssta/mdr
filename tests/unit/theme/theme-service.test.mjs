import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import { SETTINGS_CHANGED_EVENT, SETTING_DEFAULTS } from '../../../src/features/settings/index.js';
import { createThemeService, createThemeToggleController } from '../../../src/theme/index.js';

function createRoot(initialTheme = null) {
  const attributes = new Map();
  if (initialTheme !== null) attributes.set('data-theme', initialTheme);
  return {
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); }
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
      if (failRemove) throw new Error('listener removal failed');
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    emit(detail) { listeners.get(SETTINGS_CHANGED_EVENT)?.({ type: SETTINGS_CHANGED_EVENT, detail }); },
    listenerCount() { return listeners.size; }
  };
}

function snapshot(theme = SETTING_DEFAULTS.theme) {
  return { ...SETTING_DEFAULTS, toolbarHiddenItems: [], theme };
}

function createTrigger({ failAdd = false, failRemove = false, installBeforeThrow = false } = {}) {
  let clickListener = null;
  return {
    addEventListener(type, listener) {
      if (type !== 'click') return;
      if (installBeforeThrow) clickListener = listener;
      if (failAdd) throw new Error('toggle listener install failed');
      clickListener = listener;
    },
    removeEventListener(type, listener) {
      if (type !== 'click') return;
      if (failRemove) throw new Error('toggle listener removal failed');
      if (clickListener === listener) clickListener = null;
    },
    click() { return clickListener?.({ type: 'click' }); },
    listenerCount() { return clickListener ? 1 : 0; }
  };
}

test('Atomic 4.11 Theme Toggle Controller commits the next validated Settings theme without owning theme DOM', () => {
  const trigger = createTrigger();
  let current = 'light';
  const commits = [];
  const controller = createThemeToggleController({
    trigger,
    readTheme: () => current,
    commitTheme: theme => {
      commits.push(theme);
      current = theme;
      return theme;
    }
  });
  assert.equal(trigger.listenerCount(), 1);
  assert.equal(controller.toggle(), 'dark');
  assert.equal(trigger.click(), 'light');
  assert.deepEqual(commits, ['dark', 'light']);
  controller.destroy();
  controller.destroy();
  assert.equal(trigger.listenerCount(), 0);
  assert.throws(() => controller.toggle(), /destroyed/);
});

test('Atomic 4.11 Theme Toggle Controller rolls back a partially installed trigger listener', () => {
  const trigger = createTrigger({ failAdd: true, installBeforeThrow: true });
  assert.throws(() => createThemeToggleController({
    trigger,
    readTheme: () => 'light',
    commitTheme: theme => theme
  }), /toggle listener install failed/);
  assert.equal(trigger.listenerCount(), 0);
});

test('Atomic 4.11 Theme Service applies the validated initial Settings theme to one explicit root', () => {
  const root = createRoot();
  const target = createEventTarget();
  const service = createThemeService({ root, eventTarget: target, initialSnapshot: snapshot('dark') });
  assert.equal(root.getAttribute('data-theme'), 'dark');
  assert.equal(service.theme, 'dark');
  assert.equal(target.listenerCount(), 1);
  assert.equal(service.applySnapshot(snapshot('dark')), false, 'idempotent reapply must not rewrite equivalent state');
  service.destroy();
  assert.equal(root.getAttribute('data-theme'), null);
});

test('Atomic 4.11 follows only committed SettingsChanged events that include the theme id', () => {
  const root = createRoot('legacy');
  const target = createEventTarget();
  const service = createThemeService({ root, eventTarget: target, initialSnapshot: snapshot('light') });
  target.emit({ changedIds: ['editorFontSize'], snapshot: snapshot('dark') });
  assert.equal(service.theme, 'light');
  assert.equal(root.getAttribute('data-theme'), 'light');
  target.emit({ changedIds: ['theme'], snapshot: snapshot('dark') });
  assert.equal(service.theme, 'dark');
  assert.equal(root.getAttribute('data-theme'), 'dark');
  service.destroy();
  assert.equal(root.getAttribute('data-theme'), 'legacy');
});

test('Atomic 4.11 rejects invalid direct or published theme snapshots before changing the applied theme', () => {
  const root = createRoot();
  const target = createEventTarget();
  const service = createThemeService({ root, eventTarget: target, initialSnapshot: snapshot('light') });
  assert.throws(() => service.applySnapshot({ theme: 'sepia' }));
  assert.equal(root.getAttribute('data-theme'), 'light');
  assert.throws(() => target.emit({ changedIds: ['theme'], snapshot: { theme: 'sepia' } }));
  assert.equal(root.getAttribute('data-theme'), 'light');
  service.destroy();
});

test('Atomic 4.11 has no cancel or stale async path because draft edits publish no SettingsChanged event', () => {
  const root = createRoot();
  const target = createEventTarget();
  const service = createThemeService({ root, eventTarget: target, initialSnapshot: snapshot('light') });
  target.emit({ changedIds: [], snapshot: snapshot('dark') });
  target.emit(null);
  assert.equal(service.theme, 'light');
  assert.equal(root.getAttribute('data-theme'), 'light');
  service.destroy();
});

test('Atomic 4.11 destroy removes the Settings listener, restores the original attribute and makes operations terminal', () => {
  const root = createRoot('pre-service');
  const target = createEventTarget();
  const service = createThemeService({ root, eventTarget: target, initialSnapshot: snapshot('dark') });
  service.destroy();
  service.destroy();
  assert.equal(target.listenerCount(), 0);
  assert.equal(root.getAttribute('data-theme'), 'pre-service');
  assert.throws(() => service.applySnapshot(snapshot('light')), /destroyed/);
  assert.throws(() => service.theme, /destroyed/);
  target.emit({ changedIds: ['theme'], snapshot: snapshot('light') });
  assert.equal(root.getAttribute('data-theme'), 'pre-service');
});

test('Atomic 4.11 construction rolls back the root theme when listener installation fails', () => {
  const root = createRoot('pre-service');
  const target = createEventTarget({ failAdd: true, installBeforeThrow: true });
  assert.throws(() => createThemeService({ root, eventTarget: target, initialSnapshot: snapshot('dark') }), /listener install failed/);
  assert.equal(target.listenerCount(), 0, 'partially installed listener must be removed during rollback');
  assert.equal(root.getAttribute('data-theme'), 'pre-service');
});

test('Atomic 4.11 production integration removes classic theme authority and keeps semantic tokens CSS-owned', async () => {
  const [entry, themeIndex, service, toggleController, core, bootstrap, editorTools, markup, coordinator] = await Promise.all([
    readFile('src/bootstrap/module-entry.js', 'utf8'),
    readFile('src/theme/index.js', 'utf8'),
    readFile('src/theme/theme-service.js', 'utf8'),
    readFile('src/theme/theme-toggle-controller.js', 'utf8'),
    readFile('public/app/core.js', 'utf8'),
    readFile('public/app/bootstrap.js', 'utf8'),
    readFile('public/app/editor-tools.js', 'utf8'),
    readFile('public/compatibility/business-content.html', 'utf8'),
    readFile('src/features/settings/application/settings-apply-coordinator.js', 'utf8')
  ]);

  assert.match(themeIndex, /theme-service\.js/);
  assert.match(themeIndex, /theme-toggle-controller\.js/);
  assert.match(entry, /createThemeService/);
  assert.match(entry, /createThemeToggleController/);
  assert.match(entry, /createSettingsApplyCoordinator/);
  assert.ok(entry.indexOf('createSettingsStore({') < entry.indexOf('createThemeService({'));
  assert.ok(entry.indexOf('createThemeService({') < entry.indexOf('await importApplication();'));
  assert.match(entry, /themeService\?\.destroy\(\)/);
  assert.match(service, /SETTINGS_CHANGED_EVENT/);
  assert.match(service, /normalizeSettingValue/);
  assert.match(service, /setAttribute\('data-theme'/);
  for (const forbidden of ['localStorage', 'mermaid', 'updatePreview', 'virtualEditor']) {
    assert.equal(service.includes(forbidden), false, `Theme Service must not reference ${forbidden}.`);
  }
  assert.doesNotMatch(core, /function\s+setAppTheme\b|setAppTheme\s*\(/);
  assert.doesNotMatch(bootstrap, /setAttribute\(['"]data-theme|mermaid\.initialize/);
  assert.doesNotMatch(editorTools, /function\s+toggleTheme\b|setAppTheme\s*\(/);
  assert.match(markup, /data-theme-toggle/);
  assert.doesNotMatch(markup, /data-theme-toggle[^>]*onclick=|onclick=["]toggleTheme\(\)["]/);
  assert.match(toggleController, /commitTheme/);
  assert.match(toggleController, /normalizeSettingValue/);
  assert.doesNotMatch(toggleController, /setAttribute\(['"]data-theme|\blocalStorage\b|updatePreview\s*\(|virtualEditor/);
  assert.match(coordinator, /commit\(changes\)/);

  const publicAppFiles = (await readdir('public/app', { recursive: true }))
    .filter(path => path.endsWith('.js'));
  const publicAppSources = await Promise.all(publicAppFiles.map(path => readFile('public/app/' + path, 'utf8')));
  assert.doesNotMatch(publicAppSources.join('\n'), /setAppTheme\s*\(/);

  assert.doesNotMatch(service, /(?:styles\/themes|\.css)/, 'Theme Service must not own theme CSS.');
});
