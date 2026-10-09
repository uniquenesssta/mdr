import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { SETTINGS_CHANGED_EVENT, SETTING_DEFAULTS, createSettingsStore, createSettingsApplyCoordinator } from '../src/features/settings/index.js';
import { createThemeService, createThemeToggleController } from '../src/theme/index.js';

const source = readFileSync(new URL('../public/app/core.js', import.meta.url), 'utf8');
const start = source.indexOf("    document.addEventListener('markdown-editor:settings-changed', event => {");
const end = source.indexOf('    function updateToolbarItemVisibility()', start);
assert.ok(start >= 0 && end > start, 'Actual classic Settings listener must be exercised.');
const listenerSource = source.slice(start, end);

function harness(t) {
  const listeners = new Map(), attributes = new Map(), effects = { layout: [], preferences: 0, sidebar: 0 };
  const document = {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(detail) { for (const listener of listeners.get(SETTINGS_CHANGED_EVENT) || []) listener({ detail }); }
  };
  const root = {
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name)
  };
  const editor = {}, model = { version: 7, text: 'fixture' }, preview = { firstElementChild: {} };
  const first = preview.firstElementChild;
  const context = vm.createContext({
    document, coreLayoutStatePort: { set sidebarVisible(value) { effects.sidebar++; effects.sidebarValue = value; } },
    editorFontSize: SETTING_DEFAULTS.editorFontSize, editorTextColor: '', activeLineColor: '', exportDirectory: '',
    toolbarVisible: true, toolbarHiddenItems: new Set(), previewPerformanceMode: 'auto',
    setLayoutMode(...args) { effects.layout.push(args); preview.firstElementChild = {}; },
    applyEditorPreferences() { effects.preferences++; }, updateStatusBar() {}, showToast() {}
  });
  const store = createSettingsStore({ initialSnapshot: SETTING_DEFAULTS, persist() {} });
  const theme = createThemeService({ root, eventTarget: document, initialSnapshot: store.snapshot });
  new vm.Script(listenerSource).runInContext(context);
  const coordinator = createSettingsApplyCoordinator({ store, publish: event => document.emit(event) });
  let click;
  const trigger = { addEventListener(_type, listener) { click = listener; }, removeEventListener() { click = null; } };
  const toggle = createThemeToggleController({ trigger, readTheme: () => store.get('theme'), commitTheme: value => coordinator.commit({ theme: value }).theme });
  t.after(() => { toggle.destroy(); coordinator.destroy(); theme.destroy(); store.destroy(); });
  return { effects, store, coordinator, context, root, click: () => click(), editor, model, preview, first };
}

test('R14-06 theme toggle and committed theme draft preserve an existing Preview body through the actual classic listener', t => {
  const h = harness(t), editor = h.editor, model = h.model;
  for (const expected of ['dark', 'light']) {
    h.click();
    assert.equal(h.root.getAttribute('data-theme'), expected);
    assert.equal(h.store.get('theme'), expected);
    assert.equal(h.preview.firstElementChild, h.first);
    assert.equal(h.editor, editor); assert.equal(h.model, model);
    assert.deepEqual(h.model, { version: 7, text: 'fixture' });
  }
  h.store.openDraft(); h.store.updateDraft({ theme: 'dark' }); h.coordinator.applyDraft();
  assert.equal(h.root.getAttribute('data-theme'), 'dark');
  assert.equal(h.preview.firstElementChild, h.first);
  assert.deepEqual(h.effects, { layout: [], preferences: 0, sidebar: 0 });
});

test('R14-06 mixed Settings commit still applies changed layout, preferences and sidebar exactly once', t => {
  const h = harness(t);
  h.coordinator.commit({ theme: 'dark', layoutMode: 'preview', editorFontSize: 20, sidebarVisible: !SETTING_DEFAULTS.sidebarVisible });
  assert.equal(h.root.getAttribute('data-theme'), 'dark');
  assert.deepEqual(h.effects.layout, [['preview', false, false]]);
  assert.equal(h.effects.preferences, 1); assert.equal(h.context.editorFontSize, 20);
  assert.equal(h.effects.sidebar, 1); assert.equal(h.effects.sidebarValue, !SETTING_DEFAULTS.sidebarVisible);
});

test('R14-06 changing Preview performance mode retains its layout refresh without unrelated preference work', t => {
  const h = harness(t);
  h.coordinator.commit({ previewPerformanceMode: 'virtual' });
  assert.equal(h.context.previewPerformanceMode, 'virtual');
  assert.deepEqual(h.effects.layout, [[SETTING_DEFAULTS.layoutMode, false, false]]);
  assert.equal(h.effects.preferences, 0); assert.equal(h.effects.sidebar, 0);
});

test('R14-06 editor and toolbar changes apply their preferences without rebuilding layout', t => {
  const h = harness(t);
  h.coordinator.commit({ editorTextColor: '#112233', activeLineColor: '#223344', toolbarVisible: !SETTING_DEFAULTS.toolbarVisible });
  assert.equal(h.context.editorTextColor, '#112233'); assert.equal(h.context.activeLineColor, '#223344');
  assert.equal(h.effects.preferences, 1); assert.equal(h.effects.layout.length, 0);
  assert.equal(h.preview.firstElementChild, h.first);
});

test('R14-06 locale, autosave and export-directory commits preserve Preview and route their committed values', t => {
  const h = harness(t);
  h.coordinator.commit({ language: 'en' });
  h.coordinator.commit({ autoSaveEnabled: !SETTING_DEFAULTS.autoSaveEnabled });
  h.coordinator.commit({ exportDirectory: 'C:\\exports' });
  assert.equal(h.store.get('language'), 'en');
  assert.equal(h.store.get('autoSaveEnabled'), !SETTING_DEFAULTS.autoSaveEnabled);
  assert.equal(h.context.exportDirectory, 'C:\\exports');
  assert.equal(h.preview.firstElementChild, h.first);
  assert.deepEqual(h.effects, { layout: [], preferences: 0, sidebar: 0 });
});
