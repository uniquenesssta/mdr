import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSaveController, createSaveStatusStore } from '../src/features/persistence/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(ROOT, relative));

function createManualHarness({
  persistentFileSystem = true,
  pickerPath = 'C:/docs/Saved.md',
  initialPath = 'C:/docs/Draft.md',
  staleRead = false,
  stalePick = false
} = {}) {
  let generation = 4;
  let record = { id: 'doc-1', title: 'Draft.md', filePath: initialPath, nativeBacked: false, nativeVersion: 0 };
  const other = { id: 'doc-2', title: 'Other.md', filePath: '', nativeBacked: false, nativeVersion: 0 };
  const writes = [];
  const picks = [];
  const binds = [];
  const saves = [];
  const reads = [];
  const model = {
    documentId: 'doc-1',
    title: 'Draft.md',
    getDocumentVersion: () => 9,
    createSnapshot: reason => `body:${reason}`
  };
  const documentController = {
    get activeId() { return record.id; },
    getActiveRecord: () => record,
    getRecord(id) { return id === record.id ? record : id === other.id ? other : null; },
    captureOperation(kind = 'background') { return Object.freeze({ generation, kind }); },
    isCurrentGeneration(value) { return Number(value) === generation; },
    async saveActive(options) {
      saves.push(options);
      return { generation, saved: true, native: false, record, result: { native: false } };
    },
    bindDocumentFilePath(id, filePath, options) {
      binds.push({ id, filePath, options });
      generation += 1;
      const target = id === record.id ? record : other;
      const updated = { ...target, filePath, title: options.title || target.title };
      if (id === record.id) record = updated;
      return { generation, bound: true, record: updated, active: id === record.id };
    },
    async readDocumentContent(id) {
      reads.push(id);
      return { generation: staleRead ? generation + 1 : generation, record: other, content: '# other body' };
    }
  };
  const statusStore = createSaveStatusStore();
  const controller = createSaveController({
    documentController,
    model,
    statusStore,
    persistentFileSystem,
    normalizeTitle(value, fallback = '未命名文档') {
      let title = String(value || fallback).trim() || fallback;
      if (!/\.(md|markdown|txt)$/i.test(title)) title += '.md';
      return title;
    },
    async chooseSaveFile(name, options) {
      picks.push({ name, options });
      if (stalePick) generation += 1;
      return pickerPath;
    },
    async writeText(filePath, content, options) { writes.push({ filePath, content, options }); }
  });
  return { controller, statusStore, model, documentController, writes, picks, binds, saves, reads, other };
}

test('Atomic 10.12 removes the explicitly temporary Save/Autosave classic bridges and public exports', () => {
  const entry = read('src/features/persistence/index.js');
  assert.equal(exists('src/features/persistence/compatibility/classic-save-controller-port.js'), false);
  assert.equal(exists('src/features/persistence/compatibility/classic-autosave-controller-port.js'), false);
  assert.doesNotMatch(entry, /mountClassicSaveControllerPort|mountClassicAutosaveControllerPort|classic-save-controller-port|classic-autosave-controller-port/);
});

test('Atomic 10.12 export.js contains export/import workflows but no save or autosave implementation', () => {
  const source = read('public/app/export.js');
  assert.match(source, /async function exportFile\(/);
  assert.match(source, /async function exportHTML\(/);
  assert.match(source, /prepareDocumentTransition/);
  assert.doesNotMatch(source, /markdownEditorSaveControllerPort|markdownEditorAutosaveControllerPort|exportSaveControllerPort|exportAutosaveControllerPort/);
  assert.doesNotMatch(source, /async function saveToLocal|async function saveCurrentFile|async function saveAsMarkdown|saveMarkdownWithPicker|bindDocumentFilePath/);
});

test('Atomic 10.12 core.js dispatches persistence intents and owns no manual/autosave implementation', () => {
  const source = read('public/app/core.js');
  assert.match(source, /requestDocumentPersistence/);
  assert.match(source, /prepareDocumentTransition/);
  assert.match(source, /invoke\('saveCurrentFile'\)/);
  assert.doesNotMatch(source, /markdownEditorAutosaveControllerPort|coreAutosaveControllerPort/);
  assert.doesNotMatch(source, /async function saveCurrentDocumentState|async function saveAsContextDocument/);
});

test('Atomic 10.12 events.js routes edit autosave and Ctrl-S variants through explicit commands only', () => {
  const source = read('public/app/events.js');
  assert.match(source, /requestDocumentPersistence/);
  assert.match(source, /invoke\('saveCurrentFile'\)/);
  assert.match(source, /invoke\('saveAsMarkdown'\)/);
  assert.doesNotMatch(source, /markdownEditorAutosaveControllerPort|eventsAutosaveControllerPort/);
  assert.doesNotMatch(source, /\bfunction\s+saveCurrentFile|\bfunction\s+saveAsMarkdown|\bfunction\s+autoSave/);
});

test('Atomic 10.12 file-menu Save actions are declarative and no longer call classic save globals inline', () => {
  const source = read('public/compatibility/business-content.html');
  assert.match(source, /data-editor-action="save-current-file"/);
  assert.match(source, /data-editor-action="save-as-markdown"/);
  assert.doesNotMatch(source, /onclick="saveCurrentFile\(|onclick="saveAsMarkdown\(/);
});

test('Atomic 10.12 SaveController current-file save writes an existing desktop path after one persistence save', async () => {
  const h = createManualHarness();
  const result = await h.controller.saveCurrentFile({ title: 'Draft.md' });
  assert.equal(result.completed, true);
  assert.equal(h.saves.length, 1);
  assert.equal(h.picks.length, 0);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].filePath, 'C:/docs/Draft.md');
  assert.equal(h.binds.length, 0);
  h.controller.destroy();
  h.statusStore.destroy();
});

test('Atomic 10.12 first desktop save binds the chosen path only after SaveController persistence generation checks complete', async () => {
  const h = createManualHarness({ initialPath: '', pickerPath: 'C:/docs/Renamed.md' });
  const result = await h.controller.saveCurrentFile({ title: 'Draft.md' });
  assert.equal(result.completed, true);
  assert.equal(result.stale, false);
  assert.equal(result.generation, 5);
  assert.equal(h.picks.length, 1);
  assert.equal(h.writes[0].filePath, 'C:/docs/Renamed.md');
  assert.equal(h.binds.length, 1);
  assert.equal(h.binds[0].options.title, 'Renamed.md');
  h.controller.destroy();
  h.statusStore.destroy();
});

test('Atomic 10.12 desktop picker cancellation remains distinct after internal document persistence', async () => {
  const h = createManualHarness({ initialPath: '', pickerPath: null });
  const result = await h.controller.saveCurrentFile({ title: 'Draft.md' });
  assert.equal(result.saved, true);
  assert.equal(result.completed, false);
  assert.equal(result.cancelled, true);
  assert.equal(result.reason, 'file-picker-cancelled');
  assert.equal(h.saves.length, 1);
  assert.equal(h.writes.length, 0);
  assert.equal(h.binds.length, 0);
  h.controller.destroy();
  h.statusStore.destroy();
});

test('Atomic 10.12 browser Save As delegates one Markdown download without binding a fake filesystem path', async () => {
  const h = createManualHarness({ persistentFileSystem: false, initialPath: '' });
  const result = await h.controller.saveAsMarkdown({ title: 'Browser Draft' });
  assert.equal(result.completed, true);
  assert.equal(result.browserDownload, true);
  assert.equal(h.picks.length, 0);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].filePath, 'Browser Draft.md');
  assert.equal(h.binds.length, 0);
  h.controller.destroy();
  h.statusStore.destroy();
});

test('Atomic 10.12 stale non-active Save As content is cancelled before any external write or path bind', async () => {
  const h = createManualHarness({ staleRead: true, pickerPath: 'C:/docs/Other.md' });
  const result = await h.controller.saveAsMarkdown({ documentId: h.other.id, title: h.other.title });
  assert.equal(result.cancelled, true);
  assert.equal(result.stale, true);
  assert.equal(result.reason, 'document-operation-stale');
  assert.deepEqual(h.reads, ['doc-2']);
  assert.equal(h.writes.length, 0);
  assert.equal(h.binds.length, 0);
  h.controller.destroy();
  h.statusStore.destroy();
});

test('Atomic 10.12 Save As rejects a document transition completed while the desktop picker is open before any external write or path bind', async () => {
  const h = createManualHarness({ stalePick: true, pickerPath: 'C:/docs/Stale.md' });
  const result = await h.controller.saveAsMarkdown({ title: 'Draft.md' });
  assert.equal(result.cancelled, true);
  assert.equal(result.stale, true);
  assert.equal(result.reason, 'document-operation-stale');
  assert.equal(h.writes.length, 0);
  assert.equal(h.binds.length, 0);
  h.controller.destroy();
  h.statusStore.destroy();
});
