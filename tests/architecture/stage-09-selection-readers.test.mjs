import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');
const controllerPath = 'src/features/sync/selection/selection-sync-controller.js';

test('R9-07 creates exactly the two canonical Selection Readers and exports them only through the Sync public entry', async () => {
  const index = await read('src/features/sync/index.js');
  const editor = await read('src/features/sync/selection/editor-selection-reader.js');
  const preview = await read('src/features/sync/selection/preview-selection-reader.js');
  assert.match(index, /R9-04/);
  assert.match(index, /R9-05/);
  assert.match(index, /R9-06/);
  assert.match(index, /R9-07/);
  assert.match(editor, /export class EditorSelectionReader/);
  assert.match(editor, /export function createEditorSelectionReader/);
  assert.match(preview, /export class PreviewSelectionReader/);
  assert.match(preview, /export function createPreviewSelectionReader/);
  assert.match(index, /\.\/selection\/editor-selection-reader\.js/);
  assert.match(index, /\.\/selection\/preview-selection-reader\.js/);
});

test('R9-07 EditorSelectionReader is DOM-free and owns no mapping feedback highlight scheduling or document text', async () => {
  const source = await read('src/features/sync/selection/editor-selection-reader.js');
  assert.match(source, /editorApi\.getSelection/);
  assert.doesNotMatch(source, /document\.|window\.|globalThis\.|addEventListener|removeEventListener|selectionStart|selectionEnd/);
  assert.doesNotMatch(source, /selectionMapping|highlight|feedback|retry|scrollTo|scheduleTarget|DocumentModel|sliceText|\.value\b/);
});

test('R9-07 PreviewSelectionReader owns browser Selection reads and selectionchange/pointer stabilization but no mapping feedback highlight retry or scroll policy', async () => {
  const source = await read('src/features/sync/selection/preview-selection-reader.js');
  assert.match(source, /this\.getSelection/);
  assert.match(source, /addEventListener\('selectionchange'/);
  assert.match(source, /addEventListener\('pointerdown'/);
  assert.match(source, /addEventListener\('pointerup'/);
  assert.match(source, /requestFrame/);
  assert.match(source, /cancelFrame/);
  assert.doesNotMatch(source, /window\.|globalThis\.|selectionMapping|highlight|feedback|retry|scrollTo|scheduleTarget|markProgrammaticScroll|ScrollSourceOwnership/);
});

test('R9-07 final SelectionSyncController consumes Readers and owns no raw selection boundaries or preview stabilization listeners', async () => {
  const controller = await read(controllerPath);
  assert.match(controller, /editorSelectionReader\.read\(\)/);
  assert.match(controller, /previewSelectionReader\.read\(\)/);
  assert.match(controller, /previewSelectionReader\.subscribe/);
  assert.match(controller, /previewSelectionReader\.start\(\)/);
  assert.match(controller, /previewSelectionReader\.stop\(\)/);
  assert.doesNotMatch(controller, /window\.getSelection|selectionStart|selectionEnd|selectionInside\(|previewPointerActive|previewSelectionDirty/);
  assert.doesNotMatch(controller, /addEventListener\('selectionchange'|removeEventListener\('selectionchange'/);
});

test('R9-07 composition injects neutral Editor and explicit browser Preview capabilities directly and owns teardown', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createEditorSelectionReader, createPreviewSelectionReader/);
  assert.match(main, /createEditorSelectionReader\(\{ editorApi: virtualEditor \}\)/);
  assert.match(main, /createPreviewSelectionReader\(\{/);
  assert.match(main, /documentRef: previewSelectionDocument/);
  assert.match(main, /createSelectionSyncController\(editorHost, previewHost, \{/);
  assert.match(main, /editorSelectionReader,/);
  assert.match(main, /previewSelectionReader/);
  assert.match(main, /previewSelectionReader\.destroy\(\)/);
  assert.match(main, /editorSelectionReader\.destroy\(\)/);
  assert.doesNotMatch(main, /markdownEditorEditorSelectionReader = editorSelectionReader|markdownEditorPreviewSelectionReader = previewSelectionReader/);
  assert.doesNotMatch(main, /window\.markdownEditorEditorSelectionReader|window\.markdownEditorPreviewSelectionReader/);
  assert.doesNotMatch(main, /\.\/features\/sync\/selection\/editor-selection-reader\.js|\.\/features\/sync\/selection\/preview-selection-reader\.js/);
});

test('R9-07 final selection orchestration consumes Reader snapshots without a second raw selection authority', async () => {
  const controller = await read(controllerPath);
  assert.match(controller, /editorSelectionReader\.read\(\)/);
  assert.match(controller, /previewSelectionReader\.read\(\)/);
  assert.doesNotMatch(controller, /editor\.selectionStart|editor\.selectionEnd|window\.getSelection|document\.getSelection/);
  await assert.rejects(access(file('public/app/scroll-sync.js')));
});

test('R9-07 keeps frozen mapping and prior scroll owners separate from later Selection owners', async () => {
  await access(file('src/features/sync/scroll/scroll-source-ownership.js'));
  await access(file('src/features/sync/scroll/scroll-sync-controller.js'));
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/preview-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));
  await access(file('src/sync/selection-mapping.js'));
  await access(file(controllerPath));
  const mapping = await read('src/sync/selection-mapping.js');
  assert.doesNotMatch(mapping, /R9-07/);
});

test('R9-07 production inventory records exactly two Reader responsibilities and final Stage 9 cardinality', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 381);
  assert.equal(records.get('src/features/sync/selection/editor-selection-reader.js')?.[4], 'editor-selection-reader-lifecycle');
  assert.equal(records.get('src/features/sync/selection/preview-selection-reader.js')?.[4], 'preview-selection-stability-session');
});
