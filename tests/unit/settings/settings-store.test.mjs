import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsStore, SETTING_DEFAULTS } from '../../../src/features/settings/index.js';

function snapshot(overrides = {}) {
  return {
    ...SETTING_DEFAULTS,
    toolbarHiddenItems: [...SETTING_DEFAULTS.toolbarHiddenItems],
    ...overrides
  };
}

function createPersistSpy({ fail = null } = {}) {
  const calls = [];
  return {
    calls,
    persist(changes) {
      calls.push(changes);
      if (fail) throw fail;
      return changes;
    }
  };
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test('Atomic 4.8 owns one validated immutable committed Settings snapshot', () => {
  const spy = createPersistSpy();
  const store = createSettingsStore({ initialSnapshot: snapshot({ theme: 'dark', toolbarHiddenItems: ['bold'] }), persist: spy.persist });
  assert.equal(store.snapshot.theme, 'dark');
  assert.deepEqual(store.snapshot.toolbarHiddenItems, ['bold']);
  assertDeepFrozen(store.snapshot);
  assert.equal(store.hasDraft, false);
  assert.equal(store.draft, null);
  assert.equal(spy.calls.length, 0);
});

test('Atomic 4.8 rejects incomplete, extra or invalid committed state before any persistence', () => {
  const spy = createPersistSpy();
  const missing = snapshot();
  delete missing.theme;
  assert.throws(() => createSettingsStore({ initialSnapshot: missing, persist: spy.persist }), /exactly every/);
  assert.throws(() => createSettingsStore({ initialSnapshot: { ...snapshot(), extra: true }, persist: spy.persist }), /exactly every/);
  assert.throws(() => createSettingsStore({ initialSnapshot: snapshot({ autoSaveDelay: 10 }), persist: spy.persist }), /Invalid value/);
  assert.throws(() => createSettingsStore({ initialSnapshot: snapshot(), persist: null }), /persist callback/);
  assert.equal(spy.calls.length, 0);
});

test('openDraft and updateDraft change only immutable draft state and never persist', () => {
  const spy = createPersistSpy();
  const store = createSettingsStore({ initialSnapshot: snapshot(), persist: spy.persist });
  const opened = store.openDraft();
  const again = store.openDraft();
  assert.equal(opened, again);
  const updated = store.updateDraft({ theme: 'dark', editorTextColor: '#AABBCC', toolbarHiddenItems: ['bold', 'find'] });
  assert.equal(updated.theme, 'dark');
  assert.equal(updated.editorTextColor, '#aabbcc');
  assert.deepEqual(updated.toolbarHiddenItems, ['bold', 'find']);
  assert.equal(store.snapshot.theme, 'light');
  assertDeepFrozen(updated);
  assert.equal(spy.calls.length, 0);
});

test('cancelDraft discards draft with exactly zero persistence writes', () => {
  const spy = createPersistSpy();
  const store = createSettingsStore({ initialSnapshot: snapshot(), persist: spy.persist });
  store.openDraft();
  store.updateDraft({ theme: 'dark', autoSaveEnabled: false });
  assert.equal(store.cancelDraft(), true);
  assert.equal(store.cancelDraft(), false);
  assert.equal(store.hasDraft, false);
  assert.equal(store.snapshot.theme, 'light');
  assert.equal(store.snapshot.autoSaveEnabled, true);
  assert.equal(spy.calls.length, 0);
});

test('applyDraft persists only effective changes once, commits them and closes the session', () => {
  const spy = createPersistSpy();
  const store = createSettingsStore({ initialSnapshot: snapshot(), persist: spy.persist });
  store.openDraft();
  store.updateDraft({ theme: 'dark', autoSaveDelay: 2000, toolbarHiddenItems: ['bold'] });
  const applied = store.applyDraft();
  assert.equal(applied.theme, 'dark');
  assert.equal(applied.autoSaveDelay, 2000);
  assert.deepEqual(applied.toolbarHiddenItems, ['bold']);
  assert.equal(store.hasDraft, false);
  assert.equal(spy.calls.length, 1);
  assert.deepEqual(spy.calls[0], { theme: 'dark', autoSaveDelay: 2000, toolbarHiddenItems: ['bold'] });
});

test('applyDraft closes a no-op draft without persistence', () => {
  const spy = createPersistSpy();
  const store = createSettingsStore({ initialSnapshot: snapshot(), persist: spy.persist });
  const before = store.snapshot;
  store.openDraft();
  assert.equal(store.applyDraft(), before);
  assert.equal(store.hasDraft, false);
  assert.equal(spy.calls.length, 0);
});

test('applyDraft persistence failure keeps committed state unchanged and draft open for retry or cancel', () => {
  const failure = new Error('quota');
  const spy = createPersistSpy({ fail: failure });
  const store = createSettingsStore({ initialSnapshot: snapshot(), persist: spy.persist });
  store.openDraft();
  const draft = store.updateDraft({ theme: 'dark' });
  assert.throws(() => store.applyDraft(), error => error === failure);
  assert.equal(store.snapshot.theme, 'light');
  assert.equal(store.draft, draft);
  assert.equal(store.hasDraft, true);
  assert.equal(store.cancelDraft(), true);
});

test('immediate commit persists before state mutation and safely rebases an open draft', () => {
  const spy = createPersistSpy();
  const store = createSettingsStore({ initialSnapshot: snapshot(), persist: spy.persist });
  store.openDraft();
  store.updateDraft({ editorFontSize: 18 });
  const committed = store.commit({ theme: 'dark', editorFontSize: 20 });
  assert.equal(committed.theme, 'dark');
  assert.equal(committed.editorFontSize, 20);
  assert.equal(store.draft.theme, 'dark');
  assert.equal(store.draft.editorFontSize, 18);
  assert.deepEqual(spy.calls[0], { theme: 'dark', editorFontSize: 20 });
});

test('immediate no-op and failed commit never corrupt committed or draft state', () => {
  let fail = false;
  const calls = [];
  const store = createSettingsStore({
    initialSnapshot: snapshot(),
    persist(changes) {
      calls.push(changes);
      if (fail) throw new Error('write failed');
    }
  });
  store.openDraft();
  store.updateDraft({ editorFontSize: 18 });
  const beforeSnapshot = store.snapshot;
  const beforeDraft = store.draft;
  store.commit({ theme: 'light' });
  assert.equal(calls.length, 0);
  fail = true;
  assert.throws(() => store.commit({ theme: 'dark' }), /write failed/);
  assert.equal(store.snapshot, beforeSnapshot);
  assert.equal(store.draft, beforeDraft);
});

test('Settings Store destroy is idempotent, terminal and never persists draft data', () => {
  const spy = createPersistSpy();
  const store = createSettingsStore({ initialSnapshot: snapshot(), persist: spy.persist });
  store.openDraft();
  store.updateDraft({ theme: 'dark' });
  store.destroy();
  store.destroy();
  assert.equal(spy.calls.length, 0);
  for (const operation of [
    () => store.snapshot,
    () => store.draft,
    () => store.hasDraft,
    () => store.get('theme'),
    () => store.openDraft(),
    () => store.updateDraft({ theme: 'dark' }),
    () => store.applyDraft(),
    () => store.cancelDraft(),
    () => store.commit({ theme: 'dark' }),
    () => store.set('theme', 'dark')
  ]) assert.throws(operation, /destroyed/);
});
