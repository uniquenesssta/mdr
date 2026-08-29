import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import {
  SETTINGS_CHANGED_EVENT,
  SETTING_DEFAULTS,
  createSettingsApplyCoordinator,
  createSettingsController,
  createSettingsStore
} from '../../../src/features/settings/index.js';

function createStore(persist = () => {}) {
  return createSettingsStore({
    initialSnapshot: { ...SETTING_DEFAULTS, toolbarHiddenItems: [] },
    persist
  });
}

function createElementTrigger() {
  const listeners = new Map();
  return {
    tagName: 'DIV',
    ownerDocument: {},
    setAttribute() {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    click() { listeners.get('click')?.({ target: this }); },
    listenerCount() { return listeners.size; }
  };
}

function createShortcutTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    key(event) { listeners.get('keydown')?.(event); },
    listenerCount() { return listeners.size; }
  };
}

function createView() {
  const calls = [];
  let opened = false;
  let onClose = null;
  let validation = Object.freeze({ valid: true, message: '', focus: null });
  const view = {
    renderDraft(draft) { calls.push(['render', draft.theme, draft.autoSaveDelay]); },
    setActivePage(page) { calls.push(['page', page]); return page; },
    getActiveNavigationButton() { return { tagName: 'BUTTON', ownerDocument: {}, setAttribute() {} }; },
    validate() { return validation; },
    setFeedback(message, kind = 'info') { calls.push(['feedback', message, kind]); },
    setDirectoryBusy(value) { calls.push(['busy', Boolean(value)]); },
    setDirectoryValue(value) { calls.push(['directory', value]); },
    open(options) { opened = true; onClose = options.onClose; calls.push(['open']); return true; },
    close(reason) {
      if (!opened) return false;
      opened = false;
      calls.push(['close', reason]);
      const callback = onClose;
      onClose = null;
      callback?.(reason);
      return true;
    },
    isOpen() { return opened; },
    destroy() {
      calls.push(['destroy']);
      const callback = opened ? onClose : null;
      opened = false;
      onClose = null;
      callback?.('destroy');
    },
    setValidation(next) { validation = next; }
  };
  return { view, calls };
}

function createControllerFixture({ persist = () => {}, platform = null } = {}) {
  const store = createStore(persist);
  const published = [];
  const applyCoordinator = createSettingsApplyCoordinator({
    store,
    publish: event => published.push(event)
  });
  const { view, calls } = createView();
  const openTrigger = createElementTrigger();
  const shortcutTarget = createShortcutTarget();
  const controller = createSettingsController({
    store,
    view,
    applyCoordinator,
    platform: platform || { supports: () => false, call: async () => null },
    openTrigger,
    shortcutTarget
  });
  return { controller, store, published, view, calls, openTrigger, shortcutTarget };
}

test('Atomic 4.10 Apply Coordinator publishes immutable effective changes only after a successful Store apply', () => {
  const writes = [];
  const store = createStore(changes => writes.push(changes));
  const published = [];
  const coordinator = createSettingsApplyCoordinator({ store, publish: event => published.push(event) });

  store.openDraft();
  store.updateDraft({ theme: 'dark', editorFontSize: 18 });
  const applied = coordinator.applyDraft();
  assert.equal(applied.theme, 'dark');
  assert.equal(writes.length, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0].type, SETTINGS_CHANGED_EVENT);
  assert.deepEqual(published[0].changedIds, ['theme', 'editorFontSize']);
  assert.deepEqual(published[0].changes, { theme: 'dark', editorFontSize: 18 });
  assert.ok(published[0].impactEvents.includes('settings.theme.changed'));
  assert.ok(published[0].impactEvents.includes('settings.editor.changed'));
  assert.equal(Object.isFrozen(published[0]), true);
  assert.equal(Object.isFrozen(published[0].snapshot), true);

  store.openDraft();
  coordinator.applyDraft();
  assert.equal(published.length, 1, 'no-op apply must not publish a false change event');

  const immediate = coordinator.commit({ theme: 'light' });
  assert.equal(immediate.theme, 'light');
  assert.equal(writes.length, 2);
  assert.equal(published.length, 2);
  assert.deepEqual(published[1].changedIds, ['theme']);
  assert.deepEqual(published[1].changes, { theme: 'light' });

  coordinator.destroy();
  coordinator.destroy();
  assert.throws(() => coordinator.applyDraft(), /destroyed/);
  assert.throws(() => coordinator.commit({ theme: 'dark' }), /destroyed/);
  store.destroy();
});

test('Atomic 4.10 controller opens one Store draft, updates only draft state, navigates and applies through the coordinator', () => {
  const writes = [];
  const { controller, store, published, openTrigger, shortcutTarget } = createControllerFixture({
    persist: changes => writes.push(changes)
  });

  openTrigger.click();
  assert.equal(store.hasDraft, true);
  assert.equal(store.snapshot.theme, 'light');
  controller.updateDraft('theme', 'dark');
  assert.equal(controller.open('save'), true, 'reopening an already open Settings dialog must reuse the same draft session');
  assert.equal(store.hasDraft, true);
  assert.equal(store.draft.theme, 'dark');
  controller.navigate('editor');
  assert.equal(store.draft.theme, 'dark');
  assert.equal(store.snapshot.theme, 'light');
  assert.equal(writes.length, 0, 'editing the dialog must never persist');

  const applied = controller.apply();
  assert.equal(applied.theme, 'dark');
  assert.equal(store.hasDraft, false);
  assert.equal(store.snapshot.theme, 'dark');
  assert.equal(writes.length, 1);
  assert.equal(published.length, 1);

  let prevented = 0;
  let stopped = 0;
  shortcutTarget.key({
    key: ',', ctrlKey: true, metaKey: false,
    preventDefault() { prevented += 1; },
    stopPropagation() { stopped += 1; }
  });
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(store.hasDraft, true);
  controller.cancel();
  controller.destroy();
});

test('Atomic 4.10 Cancel, Escape/backdrop View close callback and validation failure all keep committed state untouched', () => {
  const writes = [];
  const { controller, store, view, calls } = createControllerFixture({
    persist: changes => writes.push(changes)
  });

  controller.open();
  controller.updateDraft('theme', 'dark');
  controller.cancel('feature-close');
  assert.equal(store.snapshot.theme, 'light');
  assert.equal(store.hasDraft, false);
  assert.equal(writes.length, 0);

  controller.open();
  controller.updateDraft('theme', 'dark');
  view.close('escape');
  assert.equal(store.hasDraft, false);
  assert.equal(store.snapshot.theme, 'light');

  controller.open();
  controller.updateDraft('theme', 'dark');
  let focused = 0;
  view.setValidation(Object.freeze({
    valid: false,
    message: '自动保存间隔请输入 0.5–3600 秒',
    focus: () => { focused += 1; }
  }));
  assert.equal(controller.apply(), false);
  assert.equal(store.hasDraft, true);
  assert.equal(store.snapshot.theme, 'light');
  assert.equal(writes.length, 0);
  assert.equal(focused, 1);
  assert.ok(calls.some(call => call[0] === 'feedback' && call[1].includes('0.5–3600')));
  controller.cancel();
  controller.destroy();
});

test('Atomic 4.10 persistence failure keeps the committed snapshot unchanged and leaves the draft available for correction', () => {
  const { controller, store, published, calls } = createControllerFixture({
    persist() { throw new Error('quota exceeded'); }
  });
  controller.open();
  controller.updateDraft('theme', 'dark');
  assert.equal(controller.apply(), false);
  assert.equal(store.snapshot.theme, 'light');
  assert.equal(store.draft.theme, 'dark');
  assert.equal(store.hasDraft, true);
  assert.equal(published.length, 0);
  assert.ok(calls.some(call => call[0] === 'feedback' && call[1].includes('quota exceeded') && call[2] === 'error'));
  controller.cancel();
  controller.destroy();
});

test('Atomic 4.10 directory selection updates draft only, ignores cancellation/stale completion and reports unsupported platforms', async () => {
  let resolveDirectory;
  const platform = {
    supports: () => true,
    call: () => new Promise(resolve => { resolveDirectory = resolve; })
  };
  const { controller, store, calls } = createControllerFixture({ platform });

  controller.open();
  const pending = controller.chooseDirectory();
  controller.cancel();
  resolveDirectory('F:/Exports');
  assert.equal(await pending, false);
  assert.equal(store.snapshot.exportDirectory, '');

  controller.open();
  const second = controller.chooseDirectory();
  resolveDirectory('F:/Exports');
  assert.equal(await second, true);
  assert.equal(store.draft.exportDirectory, 'F:/Exports');
  assert.equal(store.snapshot.exportDirectory, '');
  controller.clearDirectory();
  assert.equal(store.draft.exportDirectory, '');
  controller.cancel();
  controller.destroy();

  const unsupported = createControllerFixture();
  unsupported.controller.open();
  assert.equal(await unsupported.controller.chooseDirectory(), false);
  assert.equal(unsupported.store.draft.exportDirectory, '');
  assert.ok(unsupported.calls.some(call => call[0] === 'feedback' && call[1] === '自定义导出路径仅支持桌面版'));
  unsupported.controller.destroy();
});

test('Atomic 4.10 controller destroy removes listeners, cancels draft and makes operations terminal', () => {
  const { controller, store, openTrigger, shortcutTarget } = createControllerFixture();
  controller.open();
  controller.updateDraft('theme', 'dark');
  assert.equal(store.hasDraft, true);
  assert.equal(openTrigger.listenerCount(), 1);
  assert.equal(shortcutTarget.listenerCount(), 1);
  controller.destroy();
  controller.destroy();
  assert.equal(store.hasDraft, false);
  assert.equal(openTrigger.listenerCount(), 0);
  assert.equal(shortcutTarget.listenerCount(), 0);
  assert.throws(() => controller.open(), /destroyed/);
  assert.equal(store.snapshot.theme, 'light');
});

test('Atomic 4.10 controller construction rolls back an already-installed open trigger listener when shortcut binding fails', () => {
  const store = createStore();
  const coordinator = createSettingsApplyCoordinator({ store, publish() {} });
  const { view } = createView();
  const openTrigger = createElementTrigger();
  const shortcutTarget = {
    addEventListener() { throw new Error('shortcut listener failed'); },
    removeEventListener() {}
  };
  assert.throws(() => createSettingsController({
    store, view, applyCoordinator: coordinator,
    platform: { supports: () => false, call: async () => null },
    openTrigger, shortcutTarget
  }), /shortcut listener failed/);
  assert.equal(openTrigger.listenerCount(), 0);
  view.destroy();
  coordinator.destroy();
  store.destroy();
});

test('Atomic 4.10 Settings UI stays feature-owned while Atomic 4.11 Theme Service remains bootstrap-owned', async () => {
  const [entry, settingsIndex, core, events, markup, modalBridge, dialog, fieldFactory, navigation, autosave, color, directory] = await Promise.all([
    readFile('src/bootstrap/module-entry.js', 'utf8'),
    readFile('src/features/settings/index.js', 'utf8'),
    readFile('public/app/core.js', 'utf8'),
    readFile('public/app/events.js', 'utf8'),
    readFile('public/compatibility/business-content.html', 'utf8'),
    readFile('src/ui/compatibility/mount-modal-shells.js', 'utf8'),
    readFile('src/features/settings/ui/settings-dialog-view.js', 'utf8'),
    readFile('src/features/settings/ui/settings-field-view.js', 'utf8'),
    readFile('src/features/settings/ui/settings-navigation-view.js', 'utf8'),
    readFile('src/features/settings/ui/autosave-field-view.js', 'utf8'),
    readFile('src/features/settings/ui/color-field-view.js', 'utf8'),
    readFile('src/features/settings/ui/directory-field-view.js', 'utf8')
  ]);

  assert.match(entry, /createSettingsFeature/);
  assert.ok(entry.indexOf('await importApplication();') < entry.indexOf('createSettingsFeature({'));
  assert.match(entry, /markdownEditorPlatformPort/);
  assert.match(entry, /settingsController\?\.destroy\(\)/);
  assert.match(settingsIndex, /create-settings-feature\.js/);
  assert.match(settingsIndex, /settings-controller\.js/);
  assert.match(settingsIndex, /settings-apply-coordinator\.js/);

  assert.match(markup, /data-settings-open/);
  assert.doesNotMatch(markup, /data-settings-open[^>]*onclick=/);
  assert.ok(events.includes("document.querySelector('[data-settings-open]')?.addEventListener('click', closeAppMenus);"));
  assert.doesNotMatch(markup, /id="settings-modal"|openSettings\(|closeSettings\(|switchSettingsPage\(|applySettings\(|chooseExportDirectory\(|clearExportDirectory\(|resetSettingColor\(/);
  assert.doesNotMatch(modalBridge, /id: 'settings-modal'/);
  assert.match(dialog, /id: 'settings-modal'/);
  assert.ok(dialog.includes('return modal.open(null, options);'));
  assert.doesNotMatch(dialog, /\blocalStorage\b|\bsessionStorage\b|markdownEditorSettingsStorePort|markdownEditorPlatformPort|setAppTheme|setLanguage|setLayoutMode/);
  assert.match(dialog, /listSettingsSectionDefinitions/);
  assert.match(dialog, /for \(const descriptor of section\.fields\)/);
  assert.match(fieldFactory, /descriptor\.control/);
  assert.match(fieldFactory, /descriptor\.settingId/);
  assert.doesNotMatch(fieldFactory, /\blocalStorage\b|\bsessionStorage\b|markdownEditorSettingsStorePort|markdownEditorPlatformPort|setAppTheme|setLanguage|setLayoutMode/);
  for (const source of [dialog, fieldFactory, navigation, autosave, color, directory]) {
    assert.doesNotMatch(source, /onclick\s*=|onchange\s*=|oninput\s*=/);
  }

  assert.doesNotMatch(core, /function\s+(?:openSettings|closeSettings|switchSettingsPage|applySettings|chooseExportDirectory|clearExportDirectory|resetSettingColor|markSettingColorCustom|syncSettingsThemeDefaults|toggleCustomAutosaveDelay)\b/);
  assert.doesNotMatch(core, /getElementById\(['"]setting-|querySelectorAll\(['"]\[data-toolbar-setting\]/);
  assert.match(core, /markdown-editor:settings-changed/);
  assert.doesNotMatch(events, /key === ','\)\s*action = openSettings/);

  const uiFiles = (await readdir('src/features/settings/ui')).sort();
  assert.deepEqual(uiFiles, [
    'autosave-field-view.js',
    'color-field-view.js',
    'directory-field-view.js',
    'settings-dialog-view.js',
    'settings-field-view.js',
    'settings-navigation-view.js'
  ]);
  assert.match(entry, /createThemeService/);
  assert.doesNotMatch(settingsIndex + core, /createThemeService|theme-service\.js/);
});
