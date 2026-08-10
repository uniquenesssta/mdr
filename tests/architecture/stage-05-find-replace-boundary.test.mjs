import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(file, 'utf8');
const FIND_REPLACE_FILE = 'src/features/editor/commands/find-replace-command.js';

const FORBIDDEN_FIND_REPLACE_DEPENDENCIES = Object.freeze([
  /@codemirror\//,
  /\bdocument\./,
  /\bwindow\./,
  /\blocalStorage\b/,
  /\bupdatePreview\b/,
  /\bupdateCount\b/,
  /\bautoSave\b/,
  /\bsaveToLocal\b/,
  /\bshowToast\b/,
  /\bdocumentModel\b/,
  /\bmarkdownEditorDocumentStore\b/
]);

test('Atomic 5.11 places Find/Replace in the planned Editor command module and reserves a request-tagged native-search port', async () => {
  const [command, service, editorIndex, fixture] = await Promise.all([
    read(FIND_REPLACE_FILE),
    read('src/features/editor/application/editor-command-service.js'),
    read('src/features/editor/index.js'),
    read('tests/architecture/fixtures/production-modules.json')
  ]);

  assert.match(command, /createFindReplaceCommand/);
  assert.match(command, /findText\s*\(/, 'local search must use the neutral chunked search boundary');
  assert.match(command, /replaceRange\s*\(/, 'replace-one must use the neutral editor transaction boundary');
  assert.match(command, /replaceAllText\s*\(/, 'replace-all must use one adapter bulk transaction');
  assert.match(command, /nativeSearch/, 'native large-document search must remain available through an explicit port');
  assert.match(command, /onNativeSearchError/, 'native-search fallback errors must be reportable rather than silently swallowed');
  assert.match(command, /requestGeneration/, 'async search results must be guarded by an owned request generation');
  assert.match(command, /requestId:\s*generation/, 'native search calls must carry a request identifier');
  assert.match(command, /isCurrent\s*\(/, 'stale native results must be checked before advancing cursor state');
  assert.doesNotMatch(command, /\.value\b|\.getText\s*\(/, 'Find/Replace must not implicitly materialize the full document');

  for (const pattern of FORBIDDEN_FIND_REPLACE_DEPENDENCIES) {
    assert.doesNotMatch(command, pattern, `${FIND_REPLACE_FILE} must not contain ${pattern}`);
  }

  assert.match(service, /createFindReplaceCommand/);
  assert.match(editorIndex, /createEditorCommandService/);
  assert.match(fixture, /src\/features\/editor\/commands\/find-replace-command\.js/);
});

test('Atomic 5.11 removes Find/Replace business state and full-text fallback from web-clipper while preserving the existing modal wrapper', async () => {
  const [clipper, port] = await Promise.all([
    read('public/app/web-clipper.js'),
    read('src/features/editor/compatibility/classic-editor-command-port.js')
  ]);

  assert.match(clipper, /function\s+openFindModal\s*\(/, '5.11 must preserve the existing modal wrapper for Atomic 5.12');
  assert.match(clipper, /function\s+closeFindModal\s*\(/);
  assert.match(clipper, /markdownEditorEditorCommandPort/);
  assert.match(clipper, /webClipperEditorCommandPort\.findNext\s*\(/);
  assert.match(clipper, /webClipperEditorCommandPort\.replaceOne\s*\(/);
  assert.match(clipper, /webClipperEditorCommandPort\.replaceAll\s*\(/);
  assert.match(clipper, /if\s*\(match\s*===\s*undefined\)\s*return\s+false/, 'stale async results must not update classic UI state or selection');

  assert.doesNotMatch(clipper, /\blet\s+findIndex\b/, 'classic web clipper must no longer own the Find cursor');
  assert.doesNotMatch(clipper, /documentModel\?\.findText|documentModel\.findText/);
  assert.doesNotMatch(clipper, /documentModel\?\.replaceAllText|documentModel\.replaceAllText/);
  assert.doesNotMatch(clipper, /virtualEditor\?\.findText|virtualEditor\.findText/);
  assert.doesNotMatch(clipper, /virtualEditor\?\.replaceAllText|virtualEditor\.replaceAllText/);
  assert.doesNotMatch(clipper, /text\.indexOf\(query|text\.split\(query/, 'classic Find/Replace must not copy the document for fallback search or replace');

  for (const method of ['findNext', 'replaceOne', 'replaceAll']) {
    assert.match(port, new RegExp(`['\"]${method}['\"]|\\b${method}\\b`), `classic Editor Command port must expose ${method}`);
  }
});