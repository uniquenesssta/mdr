import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(file, 'utf8');
const COMMAND_FILES = Object.freeze([
  'src/features/editor/commands/inline-format-commands.js',
  'src/features/editor/commands/block-format-commands.js',
  'src/features/editor/commands/list-commands.js',
  'src/features/editor/commands/code-commands.js'
]);
const FORBIDDEN_COMMAND_SIDE_EFFECTS = Object.freeze([
  /\bupdatePreview\b/,
  /\bupdateCount\b/,
  /\bautoSave\b/,
  /\bsaveToLocal\b/,
  /\bshowToast\b/,
  /\blocalStorage\b/,
  /\bdocument\./,
  /\bwindow\./,
  /\bfetch\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bsetInterval\s*\(/
]);

test('Atomic 5.10 places each basic formatting responsibility in the planned Editor feature modules', async () => {
  const [service, inline, block, list, code] = await Promise.all([
    read('src/features/editor/application/editor-command-service.js'),
    ...COMMAND_FILES.map(read)
  ]);

  assert.match(service, /createEditorCommandService/);
  assert.match(inline, /bold/);
  assert.match(inline, /italic/);
  assert.match(inline, /strikethrough/);
  assert.match(block, /heading/);
  assert.match(block, /quote/);
  assert.match(list, /unorderedList/);
  assert.match(list, /orderedList/);
  assert.match(list, /taskList/);
  assert.match(code, /inlineCode/);
  assert.match(code, /code/);

  for (const [index, source] of [inline, block, list, code].entries()) {
    assert.match(source, /replaceRange\s*\(/, `${COMMAND_FILES[index]} must commit through the neutral editor transaction boundary`);
    for (const pattern of FORBIDDEN_COMMAND_SIDE_EFFECTS) {
      assert.doesNotMatch(source, pattern, `${COMMAND_FILES[index]} must not contain ${pattern}`);
    }
  }
});

test('Atomic 5.10 routes classic basic-format callers through one scoped command port and removes migrated transforms from editor-tools', async () => {
  const [editorTools, main, editorIndex, fixture] = await Promise.all([
    read('public/app/editor-tools.js'),
    read('src/main.js'),
    read('src/features/editor/index.js'),
    read('tests/architecture/fixtures/production-modules.json')
  ]);

  assert.match(editorTools, /markdownEditorEditorCommandPort/);
  for (const method of ['bold', 'italic', 'strikethrough', 'heading', 'quote', 'unorderedList', 'orderedList', 'taskList', 'inlineCode', 'code']) {
    assert.match(editorTools, new RegExp(`editorToolsCommandPort\\.${method}\\(`), `classic caller must route ${method} through the scoped command port`);
  }
  assert.doesNotMatch(editorTools, /function\s+prefixLines\s*\(/, 'legacy list transform must be deleted after migration');
  assert.doesNotMatch(editorTools, /selected\.includes\('\\n'\)\s*\?\s*'```/, 'legacy code transform must be deleted after migration');
  assert.doesNotMatch(editorTools, /currentLine\.replace\(\/\^#\{0,6\}/, 'legacy heading transform must be deleted after migration');

  assert.match(main, /createEditorCommandService/);
  assert.match(main, /mountClassicEditorCommandPort/);
  assert.match(editorIndex, /createEditorCommandService/);
  assert.match(editorIndex, /mountClassicEditorCommandPort/);
  assert.match(fixture, /src\/features\/editor\/application\/editor-command-service\.js/);
  assert.match(fixture, /src\/features\/editor\/compatibility\/classic-editor-command-port\.js/);
  for (const file of COMMAND_FILES) {
    assert.match(fixture, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Atomic 5.10 command layer remains independent from history, UI, persistence and raw CodeMirror implementation details', async () => {
  const sources = await Promise.all([
    read('src/features/editor/application/editor-command-service.js'),
    ...COMMAND_FILES.map(read)
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /@codemirror\//);
    assert.doesNotMatch(source, /EditorHistory|historyAdapter|isolateHistory/);
    assert.doesNotMatch(source, /preview|toast|persist|storage|autosave/i);
  }
});
