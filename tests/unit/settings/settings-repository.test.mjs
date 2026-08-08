import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSettingsRepository,
  SettingsRepositoryReadError,
  SettingsRepositoryWriteError
} from '../../../src/features/settings/index.js';

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.operations = [];
    this.readFailures = new Map();
    this.writeFailures = new Map();
  }

  failRead(key, error) {
    this.readFailures.set(key, error);
  }

  failWrites(key, count, error, skip = 0) {
    this.writeFailures.set(key, { count, error, skip });
  }

  getItem(key) {
    this.operations.push(['get', key]);
    if (this.readFailures.has(key)) throw this.readFailures.get(key);
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.operations.push(['set', key, String(value)]);
    const failure = this.writeFailures.get(key);
    if (failure?.skip > 0) failure.skip -= 1;
    else if (failure?.count > 0) {
      failure.count -= 1;
      throw failure.error;
    }
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.operations.push(['remove', key]);
    const failure = this.writeFailures.get(key);
    if (failure?.skip > 0) failure.skip -= 1;
    else if (failure?.count > 0) {
      failure.count -= 1;
      throw failure.error;
    }
    this.values.delete(key);
  }

  writes() {
    return this.operations.filter(([kind]) => kind === 'set' || kind === 'remove');
  }

  snapshot() {
    return Object.fromEntries(this.values);
  }
}

test('Atomic 4.7 restores legacy localStorage strings into one typed immutable Settings snapshot', () => {
  const storage = new MemoryStorage({
    md_editor_theme: 'dark',
    md_editor_language: 'en',
    md_editor_layout_mode: 'hybrid',
    md_editor_sidebar_visible: 'false',
    md_editor_autosave_enabled: 'false',
    md_editor_autosave_delay: '1500',
    md_editor_editor_font_size: '18',
    md_editor_text_color: '#112233',
    md_editor_active_line_color: '#445566',
    md_editor_export_directory: 'C:/Exports',
    md_editor_toolbar_visible: 'false',
    md_editor_toolbar_hidden_items: '["bold","find"]',
    md_editor_preview_performance_mode: 'virtual',
    md_editor_table_visual_editing: 'true',
    md_editor_code_visual_editing: 'true'
  });
  const repository = createSettingsRepository({ storage });
  const snapshot = repository.load();

  assert.deepEqual(snapshot, {
    theme: 'dark', language: 'en', layoutMode: 'hybrid', sidebarVisible: false,
    autoSaveEnabled: false, autoSaveDelay: 1500, editorFontSize: 18, editorTextColor: '#112233',
    activeLineColor: '#445566', exportDirectory: 'C:/Exports', toolbarVisible: false,
    toolbarHiddenItems: ['bold', 'find'], previewPerformanceMode: 'virtual',
    tableVisualEditing: true, codeVisualEditing: true
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.toolbarHiddenItems), true);
  assert.deepEqual(storage.writes(), []);
});

test('Atomic 4.7 falls back for missing, malformed JSON and illegal legacy values without repairing storage during load', () => {
  const storage = new MemoryStorage({
    md_editor_theme: 'system',
    md_editor_autosave_delay: '200',
    md_editor_toolbar_hidden_items: '{bad json',
    md_editor_editor_font_size: '17'
  });
  const before = storage.snapshot();
  const repository = createSettingsRepository({ storage });
  const snapshot = repository.load(['theme', 'autoSaveDelay', 'toolbarHiddenItems', 'editorFontSize', 'language']);

  assert.deepEqual(snapshot, {
    theme: 'light', autoSaveDelay: 500, toolbarHiddenItems: [], editorFontSize: 16, language: 'zh-CN'
  });
  assert.deepEqual(storage.snapshot(), before);
  assert.deepEqual(storage.writes(), []);
});

test('Atomic 4.7 normalizes valid legacy values in memory and migrates them only on an explicit save', () => {
  const storage = new MemoryStorage({
    md_editor_text_color: '#AABBCC',
    md_editor_export_directory: '  C:/Exports  '
  });
  const repository = createSettingsRepository({ storage });
  const loaded = repository.load(['editorTextColor', 'exportDirectory']);

  assert.deepEqual(loaded, { editorTextColor: '#aabbcc', exportDirectory: 'C:/Exports' });
  assert.equal(storage.values.get('md_editor_text_color'), '#AABBCC');
  assert.equal(storage.values.get('md_editor_export_directory'), '  C:/Exports  ');
  assert.deepEqual(storage.writes(), []);

  const saved = repository.save(loaded);
  assert.deepEqual(saved, loaded);
  assert.equal(storage.values.get('md_editor_text_color'), '#aabbcc');
  assert.equal(storage.values.get('md_editor_export_directory'), 'C:/Exports');
});

test('Atomic 4.7 read failures abort before any mutation and preserve every stored byte', () => {
  const storage = new MemoryStorage({ md_editor_theme: 'dark', md_editor_language: 'en' });
  const before = storage.snapshot();
  const cause = new Error('storage read denied');
  storage.failRead('md_editor_language', cause);
  const repository = createSettingsRepository({ storage });

  assert.throws(
    () => repository.load(['theme', 'language']),
    error => error instanceof SettingsRepositoryReadError
      && error.settingId === 'language'
      && error.storageKey === 'md_editor_language'
      && error.cause === cause
  );
  assert.deepEqual(storage.snapshot(), before);
  assert.deepEqual(storage.writes(), []);
});

test('Atomic 4.7 validates every requested save before storage I/O and rejects illegal autosave values', () => {
  const storage = new MemoryStorage({ md_editor_theme: 'light' });
  const repository = createSettingsRepository({ storage });

  assert.throws(() => repository.save({ theme: 'dark', autoSaveDelay: 200 }), TypeError);
  assert.deepEqual(storage.operations, []);
  assert.equal(storage.values.get('md_editor_theme'), 'light');
});

test('Atomic 4.7 serializes typed values through schema rules and removes omit-when-empty keys', () => {
  const storage = new MemoryStorage({
    md_editor_text_color: '#abcdef',
    md_editor_export_directory: 'C:/Old',
    md_editor_toolbar_hidden_items: '["bold"]'
  });
  const repository = createSettingsRepository({ storage });
  const saved = repository.save({
    sidebarVisible: false,
    autoSaveDelay: 2000,
    editorTextColor: '',
    exportDirectory: '',
    toolbarHiddenItems: ['mermaid', 'find']
  });

  assert.deepEqual(saved, {
    sidebarVisible: false,
    autoSaveDelay: 2000,
    editorTextColor: '',
    exportDirectory: '',
    toolbarHiddenItems: ['mermaid', 'find']
  });
  assert.equal(storage.values.get('md_editor_sidebar_visible'), 'false');
  assert.equal(storage.values.get('md_editor_autosave_delay'), '2000');
  assert.equal(storage.values.has('md_editor_text_color'), false);
  assert.equal(storage.values.has('md_editor_export_directory'), false);
  assert.equal(storage.values.get('md_editor_toolbar_hidden_items'), '["mermaid","find"]');
});

test('Atomic 4.7 rolls back previously touched settings when quota/write failure interrupts a save', () => {
  const storage = new MemoryStorage({ md_editor_theme: 'light', md_editor_language: 'zh-CN' });
  const before = storage.snapshot();
  const quotaError = Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
  storage.failWrites('md_editor_language', 1, quotaError);
  const repository = createSettingsRepository({ storage });

  assert.throws(
    () => repository.save({ theme: 'dark', language: 'en' }),
    error => error instanceof SettingsRepositoryWriteError
      && error.settingId === 'language'
      && error.cause === quotaError
      && error.rollbackErrors.length === 0
  );
  assert.deepEqual(storage.snapshot(), before);
});

test('Atomic 4.7 reports rollback failures without hiding the original write error', () => {
  const storage = new MemoryStorage({ md_editor_theme: 'light', md_editor_language: 'zh-CN' });
  const quotaError = Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
  const rollbackError = new Error('rollback denied');
  storage.failWrites('md_editor_language', 1, quotaError);
  storage.failWrites('md_editor_theme', 1, rollbackError, 1);
  const repository = createSettingsRepository({ storage });

  assert.throws(
    () => repository.save({ theme: 'dark', language: 'en' }),
    error => error instanceof SettingsRepositoryWriteError
      && error.cause === quotaError
      && error.rollbackErrors.length === 1
      && error.rollbackErrors[0].settingId === 'theme'
      && error.rollbackErrors[0].error === rollbackError
  );
});
