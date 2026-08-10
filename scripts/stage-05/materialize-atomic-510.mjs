import { readFile, writeFile } from 'node:fs/promises';

const EDITOR_TOOLS = 'public/app/editor-tools.js';
const MODULE_FIXTURE = 'tests/architecture/fixtures/production-modules.json';

function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error(`Atomic 5.10 materializer: missing ${label}`);
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Atomic 5.10 materializer: missing ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Atomic 5.10 materializer: duplicate ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceFunctionRange(source, firstName, nextName, replacement) {
  const startToken = `    function ${firstName}(`;
  const endToken = `    function ${nextName}(`;
  const start = source.indexOf(startToken);
  if (start < 0) throw new Error(`Atomic 5.10 materializer: missing ${firstName}`);
  const end = source.indexOf(endToken, start + startToken.length);
  if (end < 0) throw new Error(`Atomic 5.10 materializer: missing boundary ${nextName}`);
  if (source.indexOf(startToken, start + startToken.length) >= 0) {
    throw new Error(`Atomic 5.10 materializer: duplicate ${firstName}`);
  }
  return source.slice(0, start) + replacement + '\n' + source.slice(end);
}

let editorTools = await readFile(EDITOR_TOOLS, 'utf8');

requireText(editorTools, 'markdownEditorEditorHistoryPort', '5.9 History port');
requireText(editorTools, "wrapSelection('**', '**')", 'legacy bold transform');
requireText(editorTools, "selected.includes('\\n') ? '```\\n'", 'legacy code transform');
requireText(editorTools, 'function prefixLines(prefix)', 'legacy list transform');
requireText(editorTools, "currentLine.replace(/^#{0,6}\\s*/, '')", 'legacy heading transform');

editorTools = replaceOnce(
  editorTools,
  'const editorToolsHistoryPort = editorToolsCompatibilityHost?.markdownEditorEditorHistoryPort;\n',
  'const editorToolsHistoryPort = editorToolsCompatibilityHost?.markdownEditorEditorHistoryPort;\n' +
    'const editorToolsCommandPort = editorToolsCompatibilityHost?.markdownEditorEditorCommandPort;\n',
  'command port declaration anchor'
);
editorTools = replaceOnce(
  editorTools,
  "if (!editorToolsHistoryPort) throw new Error('Editor History compatibility port is unavailable.');\n",
  "if (!editorToolsHistoryPort) throw new Error('Editor History compatibility port is unavailable.');\n" +
    "if (!editorToolsCommandPort) throw new Error('Editor Command compatibility port is unavailable.');\n",
  'command port validation anchor'
);

editorTools = replaceFunctionRange(editorTools, 'formatBold', 'formatItalic', `    function formatBold() {
      pushHistory();
      editorToolsCommandPort.bold();
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }`);
editorTools = replaceFunctionRange(editorTools, 'formatItalic', 'formatUnderline', `    function formatItalic() {
      pushHistory();
      editorToolsCommandPort.italic();
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }`);
editorTools = replaceFunctionRange(editorTools, 'formatStrikethrough', 'formatSubscript', `    function formatStrikethrough() {
      pushHistory();
      editorToolsCommandPort.strikethrough();
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }`);
editorTools = replaceFunctionRange(editorTools, 'insertCodeRow', 'insertCode', `    function insertCodeRow() {
      pushHistory();
      editorToolsCommandPort.inlineCode();
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }`);
editorTools = replaceFunctionRange(editorTools, 'insertCode', 'wrapSelection', `    function insertCode() {
      pushHistory();
      editorToolsCommandPort.code();
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }`);
editorTools = replaceFunctionRange(editorTools, 'formatQuote', 'formatUnorderedList', `    function formatQuote() {
      pushHistory();
      editorToolsCommandPort.quote(t('quote'));
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }`);
editorTools = replaceFunctionRange(editorTools, 'formatUnorderedList', 'insertHeading', `    function commitBasicListCommand(method) {
      pushHistory();
      editorToolsCommandPort[method](t('unordered'));
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }

    function formatUnorderedList() {
      commitBasicListCommand('unorderedList');
    }
    function formatOrderedList() {
      commitBasicListCommand('orderedList');
    }
    function formatTaskList() {
      commitBasicListCommand('taskList');
    }`);
editorTools = replaceFunctionRange(editorTools, 'insertHeading', 'toggleHeadingMenu', `    function insertHeading(level) {
      pushHistory();
      editorToolsCommandPort.heading(level);
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }`);

for (const forbidden of [
  "wrapSelection('**', '**')",
  "wrapSelection('*', '*')",
  "wrapSelection('~~', '~~')",
  "selected.includes('\\n') ? '```\\n'",
  'function prefixLines(prefix)',
  "currentLine.replace(/^#{0,6}\\s*/, '')"
]) {
  if (editorTools.includes(forbidden)) throw new Error(`Atomic 5.10 materializer: migrated transform remains: ${forbidden}`);
}
await writeFile(EDITOR_TOOLS, editorTools, 'utf8');

const fixture = JSON.parse(await readFile(MODULE_FIXTURE, 'utf8'));
const modules = fixture.modules;
const byPath = new Map(modules.map(record => [record[0], record]));
const editorToolsRecord = byPath.get('public/app/editor-tools.js');
if (!editorToolsRecord) throw new Error('Atomic 5.10 materializer: editor-tools ownership record is missing');
editorToolsRecord[3] = 'Legacy editing UI wrappers and remaining insertion tools; Atomic 5.10 basic Markdown transformations delegate through the scoped Editor Command port while history grouping delegates through the scoped History Adapter.';

const additions = [
  ['src/features/editor/application/editor-command-service.js','esm-module','editor-application','Basic editor command service composing the Atomic 5.10 formatting command modules over the neutral editor adapter without owning document state.','editor-command-service-lifecycle','explicit-instance','retain',false],
  ['src/features/editor/commands/inline-format-commands.js','esm-module','editor-commands','Pure basic inline Markdown marker commands for bold, italic and strikethrough using one neutral editor replacement transaction.','none','pure-with-editor-adapter','retain',false],
  ['src/features/editor/commands/block-format-commands.js','esm-module','editor-commands','Pure heading and quote commands using neutral selection, line and replacement operations.','none','pure-with-editor-adapter','retain',false],
  ['src/features/editor/commands/list-commands.js','esm-module','editor-commands','Pure unordered, ordered and task-list prefix commands preserving existing line anchoring semantics.','none','pure-with-editor-adapter','retain',false],
  ['src/features/editor/commands/code-commands.js','esm-module','editor-commands','Pure inline and fenced code commands using one neutral editor replacement transaction.','none','pure-with-editor-adapter','retain',false],
  ['src/features/editor/compatibility/classic-editor-command-port.js','esm-module','editor-compatibility','Scoped temporary Editor Command Service bridge for remaining classic UI callers without owning document text or command state.','classic-editor-command-port-mount','explicit-instance','remove-with-classic-editor-callers',false]
];
for (const record of additions) {
  if (byPath.has(record[0])) throw new Error(`Atomic 5.10 materializer: duplicate ownership record ${record[0]}`);
}
const insertAt = modules.findIndex(record => record[0] === 'src/features/editor/compatibility/classic-editor-controller-port.js');
if (insertAt < 0) throw new Error('Atomic 5.10 materializer: editor compatibility insertion anchor is missing');
modules.splice(insertAt, 0, ...additions);
const editorIndex = modules.find(record => record[0] === 'src/features/editor/index.js');
if (!editorIndex) throw new Error('Atomic 5.10 materializer: editor public entry ownership record is missing');
editorIndex[3] = 'Public Stage 5 Editor feature entry exporting neutral CodeMirror adapter/extension contracts, Editor Controller, History Adapter, Editor Command Service and scoped classic compatibility mounts without leaking raw CodeMirror objects.';
if (modules.length !== 269) throw new Error(`Atomic 5.10 materializer: expected 269 production modules, got ${modules.length}`);
await writeFile(MODULE_FIXTURE, JSON.stringify(fixture) + '\n', 'utf8');

console.log('[Atomic 5.10] materialized editor-tools command cutover and 269-module ownership fixture.');
