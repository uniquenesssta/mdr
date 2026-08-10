import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(file, 'utf8');

const LEGACY_HISTORY_AUTHORITY = Object.freeze([
  /\bhistoryStack\b/,
  /\bhistoryIndex\b/,
  /\blastHistoryText\b/,
  /\bhistoryTimer\b/,
  /\bMAX_HISTORY\b/,
  /\brecordHistory\b/,
  /\bresetHistoryForCurrentDocument\b/
]);

test('Atomic 5.9 removes the classic full-text history authority from every remaining classic app module', async () => {
  const paths = [
    'public/app/core.js',
    'public/app/bootstrap.js',
    'public/app/editor-tools.js',
    'public/app/events.js'
  ];
  for (const file of paths) {
    const source = await read(file);
    for (const pattern of LEGACY_HISTORY_AUTHORITY) {
      assert.doesNotMatch(source, pattern, `${file} must not retain ${pattern}`);
    }
  }
});

test('Atomic 5.9 routes classic undo/redo/isolation only through the scoped History Adapter port', async () => {
  const [editorTools, main, editorIndex, historySource, fixture] = await Promise.all([
    read('public/app/editor-tools.js'),
    read('src/main.js'),
    read('src/features/editor/index.js'),
    read('src/features/editor/application/editor-history-adapter.js'),
    read('tests/architecture/fixtures/production-modules.json')
  ]);

  assert.match(editorTools, /markdownEditorEditorHistoryPort/);
  assert.match(editorTools, /editorToolsHistoryPort\.isolate\(\)/);
  assert.match(editorTools, /editorToolsHistoryPort\.undo\(\)/);
  assert.match(editorTools, /editorToolsHistoryPort\.redo\(\)/);
  assert.doesNotMatch(editorTools, /virtualEditor\?\.(?:undo|redo|isolateHistory|resetHistory|consumeDocumentLoadHistoryReset)/);

  assert.match(main, /createEditorHistoryAdapter/);
  assert.match(main, /mountClassicEditorHistoryPort/);
  assert.match(editorIndex, /createEditorHistoryAdapter/);
  assert.match(editorIndex, /mountClassicEditorHistoryPort/);
  assert.doesNotMatch(historySource, /@codemirror\//, 'application history adapter must depend only on the neutral adapter contract');
  assert.match(fixture, /src\/features\/editor\/application\/editor-history-adapter\.js/);
  assert.match(fixture, /src\/features\/editor\/compatibility\/classic-editor-history-port\.js/);
});

test('document replacement resets CodeMirror state directly without a second reset-history compatibility path', async () => {
  const [virtualEditor, codeMirrorAdapter] = await Promise.all([
    read('src/editor/virtual-editor.js'),
    read('src/features/editor/infrastructure/codemirror-editor-adapter.js')
  ]);
  assert.doesNotMatch(virtualEditor, /consumeDocumentLoadHistoryReset|resetHistory\s*\(/);
  assert.doesNotMatch(codeMirrorAdapter, /resetHistory\s*\(options/);
  assert.match(codeMirrorAdapter, /isolateHistory\(\)/);
  assert.match(codeMirrorAdapter, /undo\(\)/);
  assert.match(codeMirrorAdapter, /redo\(\)/);
});
