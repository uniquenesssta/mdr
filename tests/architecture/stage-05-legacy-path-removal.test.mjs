import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const read = path => readFile(path, 'utf8');
const mustBeMissing = async path => {
  await assert.rejects(access(path), error => error?.code === 'ENOENT');
};
const classicSyntaxPaths = [
  'public/app/core.js',
  'public/app/editor-tools.js',
  'public/app/events.js',
  'public/app/preview.js',
  'public/app/web-clipper.js'
];
const awaitableSource = Object.fromEntries(await Promise.all(classicSyntaxPaths.map(async path => [path, await read(path)])));

test('Atomic 5.13 removes hidden textarea compatibility from production callers and presentation', async () => {
  const [html, core, events, preview, clipper, performance, previewCss, exportCss] = await Promise.all([
    read('public/compatibility/business-content.html'),
    read('public/app/core.js'),
    read('public/app/events.js'),
    read('public/app/preview.js'),
    read('public/app/web-clipper.js'),
    read('src/runtime/performance.js'),
    read('src/styles/features/preview.css'),
    read('src/styles/features/export.css')
  ]);
  assert.doesNotMatch(html, /id="preview-source"|class="preview-source"/);
  for (const [name, source] of Object.entries({ core, events, preview, clipper })) {
    assert.doesNotMatch(source, /\bpreviewSource\b|preview-source/, `${name} retains hidden textarea compatibility`);
  }
  assert.doesNotMatch(performance, /#preview-source/);
  assert.doesNotMatch(previewCss, /\.preview-source\s*\{/);
  assert.doesNotMatch(exportCss, /\.preview-source\b/);
});

test('Atomic 5.13 deletes migrated command/history wrappers instead of retaining aliases or facades', async () => {
  await mustBeMissing('src/features/editor/compatibility/classic-editor-command-port.js');
  await mustBeMissing('src/features/editor/compatibility/classic-editor-history-port.js');
  const [editorTools, main, editorIndex, fixture] = await Promise.all([
    read('public/app/editor-tools.js'),
    read('src/main.js'),
    read('src/features/editor/index.js'),
    read('tests/architecture/fixtures/production-modules.json')
  ]);
  assert.doesNotMatch(editorTools, /editorTools(?:Command|History|EditorController)Port|markdownEditorEditor(?:Command|History)Port/);
  assert.doesNotMatch(editorTools, /function\s+(?:clearDoc|pushHistory|undo|redo|formatBold|formatItalic|formatUnderline|formatStrikethrough|formatSubscript|formatSuperscript|insertCodeRow|insertCode|formatQuote|formatUnorderedList|formatOrderedList|formatTaskList|insertHeading|syncEditorFromActive|insertImageMarkdown)\s*\(/);
  assert.doesNotMatch(main, /mountClassicEditor(?:Command|History)Port/);
  assert.doesNotMatch(editorIndex, /classic-editor-(?:command|history)-port/);
  assert.doesNotMatch(fixture, /classic-editor-(?:command|history)-port\.js/);
});

test('Atomic 5.13 preserves later-stage editor-tools responsibilities without starting Stage 6-8 rewrites', async () => {
  const source = await read('public/app/editor-tools.js');
  for (const responsibility of [
    'applyTableVisualEditingSetting',
    'applyCodeVisualEditingSetting',
    'renderMermaidBlocks',
    'getLayoutMode',
    'setLayoutMode',
    'togglePageFullscreen',
    'toggleFullscreen'
  ]) {
    assert.match(source, new RegExp(`function\\s+${responsibility}\\s*\\(`), `later-stage responsibility disappeared: ${responsibility}`);
  }
});

test('Atomic 5.13 routes migrated menu actions through declarative Editor View commands', async () => {
  const [html, main] = await Promise.all([
    read('public/compatibility/business-content.html'),
    read('src/main.js')
  ]);
  assert.match(html, /data-editor-action="open-find"/);
  assert.match(html, /data-editor-action="clear"/);
  assert.match(html, /data-editor-action="insert-table" data-rows="3" data-cols="3"/);
  assert.doesNotMatch(html, /openFindModal\(\)|clearDoc\(\)|insertTable\(3, 3\)/);
  assert.match(main, /action === 'clear'/);
  assert.match(main, /window\.confirm\(t\('confirmClear'\)\)/);
  assert.match(main, /editorController\.setText\(''\)/);
});

test('Atomic 5.13 web clipper mutates only the authoritative DocumentModel path', async () => {
  const clipper = await read('public/app/web-clipper.js');
  assert.match(clipper, /documentModel\.replaceRange\(/);
  assert.match(clipper, /documentModel\.getTextLength\(\)/);
  assert.doesNotMatch(clipper, /webClipperEditorControllerPort|webClipperEditorCommandPort|\beditor\.value\s*(?:\+?=)/);
});


test('Atomic 5.13 modified classic scripts remain parseable before browser execution', async () => {
  for (const path of [
    'public/app/core.js',
    'public/app/editor-tools.js',
    'public/app/events.js',
    'public/app/preview.js',
    'public/app/web-clipper.js'
  ]) {
    assert.doesNotThrow(() => new Script(awaitableSource[path] || '', { filename: path }));
  }
});
