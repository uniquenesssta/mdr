import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');

const REQUIRED_UI_MODULES = Object.freeze([
  'src/features/documents/ui/document-list-view.js',
  'src/features/documents/ui/document-list-item-view.js',
  'src/features/documents/ui/document-context-menu-view.js',
  'src/features/documents/ui/document-title-view.js',
  'src/features/editor/ui/editor-pane-view.js',
  'src/features/editor/ui/editor-toolbar-view.js',
  'src/features/editor/ui/inline-color-menu-view.js',
  'src/features/editor/ui/find-replace-dialog-view.js',
  'src/features/editor/ui/link-dialog-view.js',
  'src/features/editor/ui/image-dialog-view.js',
  'src/features/editor/ui/table-dialog-view.js',
  'src/features/editor/ui/math-dialog-view.js',
  'src/features/editor/ui/mermaid-dialog-view.js'
]);

const FORBIDDEN_VIEW_SOURCE = [
  /\bwindow\./,
  /localStorage/,
  /sessionStorage/,
  /DocumentModel|markdownEditorDocumentModel/,
  /@codemirror\//,
  /\.innerHTML\s*=\s*[^'"`]*['"`][^;]*onclick=/i
];

function extractTemplate(source, slot) {
  const marker = `<template data-compat-slot="${slot}">`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${slot} compatibility template`);
  const end = source.indexOf('</template>', start);
  assert.notEqual(end, -1, `unterminated ${slot} compatibility template`);
  return source.slice(start, end + 11);
}

function extractElement(source, id, tagName = 'div') {
  const idMarker = `id="${id}"`;
  const idIndex = source.indexOf(idMarker);
  assert.notEqual(idIndex, -1, `missing #${id}`);
  const openStart = source.lastIndexOf(`<${tagName}`, idIndex);
  assert.notEqual(openStart, -1, `missing <${tagName}> start for #${id}`);
  const tokenPattern = new RegExp(`<${tagName}\\b[^>]*>|</${tagName}>`, 'gi');
  tokenPattern.lastIndex = openStart;
  let depth = 0;
  let match;
  while ((match = tokenPattern.exec(source))) {
    if (match[0].startsWith(`</${tagName}`)) depth -= 1;
    else depth += 1;
    if (depth === 0) return source.slice(openStart, tokenPattern.lastIndex);
  }
  assert.fail(`unterminated <${tagName}> for #${id}`);
}

test('Atomic 5.12 creates the planned document/editor UI responsibility modules', async () => {
  for (const path of REQUIRED_UI_MODULES) {
    await access(path);
    const source = await read(path);
    assert.match(source, /Responsibility:/, `${path} must declare responsibility`);
    assert.match(source, /Lifecycle:/, `${path} must declare lifecycle`);
    for (const forbidden of FORBIDDEN_VIEW_SOURCE) {
      assert.doesNotMatch(source, forbidden, `${path} violates the UI dependency boundary: ${forbidden}`);
    }
  }
});

test('Atomic 5.12 migrated UI markup contains no inline event handlers', async () => {
  const html = await read('public/compatibility/business-content.html');
  const migratedMarkup = [
    extractTemplate(html, 'toolbar'),
    extractTemplate(html, 'editor'),
    extractElement(html, 'sidebar-docs-panel', 'section'),
    extractElement(html, 'document-context-menu'),
    extractElement(html, 'sidebar-context-menu'),
    extractElement(html, 'find-modal'),
    extractElement(html, 'link-modal'),
    extractElement(html, 'image-modal'),
    extractElement(html, 'mermaid-modal')
  ].join('\n');
  assert.doesNotMatch(migratedMarkup, /\son(?:click|change|input|keydown|contextmenu|mouseover|mouseleave)\s*=/i);
});

test('Atomic 5.12 removes document-list rendering and migrated dialog event ownership from classic files', async () => {
  const [bootstrap, core, events, editorTools, webClipper, toolbarView] = await Promise.all([
    read('public/app/bootstrap.js'),
    read('public/app/core.js'),
    read('public/app/events.js'),
    read('public/app/editor-tools.js'),
    read('public/app/web-clipper.js'),
    read('src/features/editor/ui/editor-toolbar-view.js')
  ]);

  assert.doesNotMatch(core, /function\s+renderDocumentList\s*\(/);
  assert.doesNotMatch(core, /document-item[^\n]*onclick=/);
  assert.doesNotMatch(events, /filenameInput\.addEventListener\(['"]input['"]/);
  assert.doesNotMatch(webClipper, /function\s+(?:openFindModal|closeFindModal)\s*\(/);
  assert.doesNotMatch(editorTools, /function\s+(?:openImageModal|closeImageModal|switchImageTab|openMermaidModal|closeMermaidModal)\s*\(/);
  assert.doesNotMatch(bootstrap, /\bupdateViewMenuLabel\b/, 'bootstrap must not call the removed classic toolbar label owner');
  assert.doesNotMatch(core, /\bupdateViewMenuLabel\b/, 'localized classic refresh must route to the scoped Toolbar View boundary');
  assert.match(core, /refreshToolbarLayoutLabel/, 'classic locale refresh may request the View to refresh through the scoped UI port');
  assert.match(toolbarView, /refreshLayoutLabel/, 'Toolbar View must own the layout label presentation');
});

test('Atomic 5.12 composes UI Views through feature public boundaries and does not start 5.13 textarea deletion', async () => {
  const documentsIndex = await read('src/features/documents/index.js');
  const editorIndex = await read('src/features/editor/index.js');
  const main = await read('src/main.js');
  const html = await read('public/compatibility/business-content.html');

  for (const name of ['createDocumentListView', 'createDocumentContextMenuView', 'createDocumentTitleView']) {
    assert.match(documentsIndex, new RegExp(name));
    assert.match(main, new RegExp(name));
  }
  for (const name of [
    'createEditorPaneView', 'createEditorToolbarView', 'createInlineColorMenuView',
    'createFindReplaceDialogView', 'createLinkDialogView', 'createImageDialogView',
    'createTableDialogView', 'createMathDialogView', 'createMermaidDialogView'
  ]) {
    assert.match(editorIndex, new RegExp(name));
    assert.match(main, new RegExp(name));
  }
  assert.match(html, /id="preview-source"/, 'Atomic 5.13 owns hidden textarea deletion and has not started');
});
