import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createApplicationLifetime } from '../src/bootstrap/application-lifetime.js';
import { createApplicationEvents } from '../src/bootstrap/application-events.js';
import { createFindPreviewCommands } from '../src/features/editor/application/find-preview-commands.js';
import { createWorkspaceStartup } from '../src/bootstrap/workspace-startup.js';
import { applicationSurfaceOwners } from './support/application-surface-source.mjs';

test('R16-02 production entry imports ESM owners and every classic file is absent', async () => {
  const main = await readFile('src/main.js', 'utf8');
  assert.doesNotMatch(main, /APP_MODULES|loadClassicScript|createElement\(['"]script|__markdownEditorInitPromise|['"]\/app\//);
  for (const [retired, owners] of Object.entries(applicationSurfaceOwners)) {
    await assert.rejects(access(retired), { code: 'ENOENT' });
    for (const owner of owners) {
      const source = await readFile(owner, 'utf8');
      assert.match(source, /export function create/);
      assert.doesNotMatch(source, /getElementById\(['"]compatibility-business-ports|eval\(|new Function/);
      await import(new URL('../' + owner, import.meta.url));
    }
  }
});

test('R16-02 lifetime cancels timers and attempts all independent releases after a disposer fails', () => {
  const pending = new Map(), cleared = [], calls = [];
  const scope = createApplicationLifetime({ timers: { setTimeout(fn) { pending.set(7, fn); return 7; }, clearTimeout(id) { cleared.push(id); } } });
  scope.setTimeout(() => calls.push('late'), 1);
  scope.own(() => calls.push('first'));
  scope.own(() => { calls.push('second'); throw new Error('release'); });
  assert.throws(scope.destroy, AggregateError);
  pending.get(7)(); scope.destroy();
  assert.deepEqual(calls, ['second', 'first']); assert.deepEqual(cleared, [7]);
});

test('R16-02 partially installed listeners are removable even when registration throws', () => {
  const listeners = new Set(), scope = createApplicationLifetime();
  const target = { addEventListener(_type, fn) { listeners.add(fn); throw new Error('install'); }, removeEventListener(_type, fn) { listeners.delete(fn); } };
  assert.throws(() => scope.listen(target, 'x', () => {}), /install/);
  scope.destroy(); assert.equal(listeners.size, 0);
});

function eventHarness() {
  const listeners = new Map(), calls = [], registrations = new Set(); let transaction;
  class Element { closest() { return null; } }
  const editor = new Element(); editor.contains = () => false;
  editor.setRangeText = (...args) => calls.push(['range', ...args]); editor.selectionStart = 1; editor.selectionEnd = 2;
  const document = { querySelector: () => null,
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); } };
  const ui = { has: () => true, invoke: (...args) => calls.push(args), register(values) { registrations.add(values); return () => registrations.delete(values); } };
  const owner = createApplicationEvents({ document, window: { Element }, editor,
    eventsEditorControllerPort: { subscribeTransactions(fn) { transaction = fn; return () => { transaction = null; }; } },
    eventsEditorUiCommandPort: ui, eventsDocumentUiCommandPort: ui,
    eventsPreviewCommandPort: { scheduleUpdate: () => calls.push(['preview']), scheduleCountUpdate: () => calls.push(['count']), scheduleFocusUpdate() {} },
    ensureCurrentDocumentForEditing: () => calls.push(['ensure']), updateLargeDocumentMode: () => calls.push(['large']),
    closeAppMenus() {}, closeContextMenus() {}, showToast: message => calls.push(['error', message]),
    newDocument() {}, toggleSidebar() {}, renameCurrentDocument() {} });
  return { owner, calls, listeners, registrations, editor, get transaction() { return transaction; },
    key(key, extra = {}) { listeners.get('keydown')({ key, target: editor, preventDefault() {}, stopPropagation() {}, ...extra }); } };
}

test('R16-02 interactive edit reaches lazy document, geometry, Preview and persistence without retired metrics globals', () => {
  const h = eventHarness(); h.transaction({ interactive: false }); assert.deepEqual(h.calls, []);
  h.transaction({ interactive: true });
  assert.deepEqual(h.calls, [['ensure'], ['large'], ['preparePreviewEditorMetrics'], ['preview'], ['count'], ['requestDocumentPersistence', 'editor-transaction']]);
  h.owner.destroy(); assert.equal(h.transaction, null); assert.equal(h.listeners.size, 0); assert.equal(h.registrations.size, 0);
});

test('R16-02 shortcuts preserve save-as and four-space Tab insertion', () => {
  const h = eventHarness(); h.key('s', { ctrlKey: true, shiftKey: true }); h.key('Tab');
  assert.deepEqual(h.calls, [['saveAsMarkdown'], ['range', '    ', 1, 2, 'end']]); h.owner.destroy();
});

function findHarness() {
  const calls = []; let active = { id: 'native-doc', nativeBacked: true }, version = 4, resolveSave;
  const save = new Promise(resolve => { resolveSave = resolve; });
  const owner = createFindPreviewCommands({ nativeStore: { search: async (...args) => { calls.push(args); return { from: 1, to: 3 }; } },
    documentModel: { getTextLength: () => 5000000, getDocumentVersion: () => version }, getCurrentDocument: () => active,
    saveDocument: () => save, webClipperEditorUiCommandPort: { register: () => () => {}, has: () => true, invoke: (...args) => calls.push(args) },
    webClipperPreviewCommandPort: { thresholds: { mode: { virtualChars: 1000000 } }, snapshot: { mode: 'full' } }, requestAnimationFrame: () => 8, cancelAnimationFrame: id => calls.push(['cancel', id]) });
  return { owner, calls, resolveSave, change: () => { active = { id: 'other' }; version++; } };
}

test('R16-02 native Find waits for save before searching the same document', async () => {
  const h = findHarness(), options = h.owner.createFindSearchOptions();
  const pending = options.nativeSearch({ query: '词', from: 3, wrap: true }); assert.deepEqual(h.calls, []);
  h.resolveSave(); assert.deepEqual(await pending, { from: 1, to: 3 });
  assert.deepEqual(h.calls, [['native-doc', '词', 3, true]]); h.owner.destroy();
});

for (const reason of ['document-change', 'destroy']) test('R16-02 native Find rejects a late save after ' + reason, async () => {
  const h = findHarness(), pending = h.owner.createFindSearchOptions().nativeSearch({ query: 'x' });
  if (reason === 'destroy') h.owner.destroy(); else h.change();
  h.resolveSave(); await assert.rejects(pending, /document changed/); assert.deepEqual(h.calls, []); h.owner.destroy();
});

function startupHarness({ launch = false, setup } = {}) {
  const calls = []; let resolvePath;
  const mode = () => calls.push('layout');
  const owner = createWorkspaceStartup({ editor: { textLength: 0 }, preview: {}, filenameInput: {}, t: key => key,
    localStorage: { setItem: () => calls.push('preview-mode') }, platform: { supports: () => launch, call: () => new Promise(resolve => { resolvePath = resolve; }) },
    documentCommands: { invoke: () => calls.push('launch-import') }, bootstrapSettingsStorePort: { snapshot: { sidebarVisible: true, layoutMode: 'both' } },
    bootstrapEditorControllerPort: { setText: text => calls.push(['text', text]) }, bootstrapLayoutStatePort: { previewCollapsed: true },
    bootstrapPreviewCommandPort: { thresholds: { scheduling: { postprocess: { deferChars: 100000 } } }, updateCount: () => calls.push('count'), setViewMode: () => calls.push('view') },
    bootstrapHelpPort: { openFirstRun: () => calls.push('help') }, applyEditorPreferences: () => calls.push('preferences'),
    applyTableVisualEditingSetting: () => calls.push('table'), applyCodeVisualEditingSetting: () => calls.push('code'),
    setupDocuments: setup || (() => calls.push('session')), updateStatusBar() {}, updateLargeDocumentMode() {}, setLayoutMode: mode, isHybridLayoutMode: () => false, refreshClassicLocalizedState: () => calls.push('locale') });
  return { owner, calls, resolvePath: () => resolvePath('C:/launch.md') };
}

test('R16-02 startup restores preferences before session, Preview, layout and help', async () => {
  const h = startupHarness(); assert.equal(await h.owner.start(), true);
  assert.deepEqual(h.calls, [['text', ''], 'preferences', 'table', 'code', 'session', 'preview-mode', 'count', 'view', 'layout', 'help', 'locale']); h.owner.destroy();
});

test('R16-02 destroyed startup cannot open a late launch path', async () => {
  const h = startupHarness({ launch: true }), pending = h.owner.start(); await Promise.resolve();
  h.owner.destroy(); h.resolvePath(); assert.equal(await pending, false); assert.ok(!h.calls.includes('launch-import'));
});

test('R16-02 startup failure preserves the original error and stops later initialization', async () => {
  const failure = new Error('session failed'), h = startupHarness({ setup: () => { throw failure; } });
  await assert.rejects(h.owner.start(), error => error === failure); assert.ok(!h.calls.includes('view')); h.owner.destroy();
});

test('R16-02 late Find frame cannot synchronize a replaced document or a destroyed owner', () => {
  const frames = [], calls = [];
  let version = 1;
  const owner = createFindPreviewCommands({ nativeStore: {}, documentModel: { getDocumentVersion: () => version },
    getCurrentDocument: () => ({ id: 'doc' }), saveDocument() {},
    webClipperEditorUiCommandPort: { register: () => () => {}, has: () => true, invoke: () => calls.push('sync') },
    webClipperPreviewCommandPort: { thresholds: { mode: { virtualChars: 1 } }, snapshot: { mode: 'full' } },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; }, cancelAnimationFrame: id => calls.push(id) });
  owner.afterFindMatch({ from: 0 }); version++; frames[0](); assert.deepEqual(calls, []);
  owner.afterFindMatch({ from: 0 }); owner.destroy(); frames[1]();
  assert.deepEqual(calls, [2, 1]); assert.equal(owner.afterFindMatch({ from: 0 }), false);
});
