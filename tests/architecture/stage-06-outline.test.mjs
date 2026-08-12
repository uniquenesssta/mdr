import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = path => readFile(resolve(ROOT, path), 'utf8');

const OUTLINE_MODULES = [
  'src/features/sidebar/outline/outline-controller.js',
  'src/features/sidebar/outline/outline-tree-builder.js',
  'src/features/sidebar/outline/outline-collapse-store.js',
  'src/features/sidebar/outline/outline-active-heading.js',
  'src/features/sidebar/outline/outline-view.js',
  'src/features/sidebar/compatibility/classic-outline-controller-port.js'
];

function assertNoDirectBrowserGlobalAccess(source) {
  assert.doesNotMatch(source, /(?:^|[=(:,]\s*)window\s*[.[]/m);
  assert.doesNotMatch(source, /(?:^|[=(:,]\s*)document\s*[.[]/m);
  assert.doesNotMatch(source, /(?:^|[=(:,]\s*)localStorage\s*[.[]/m);
}

test('Atomic 6.8 exposes the responsibility-split Outline feature through one public Sidebar entry', async () => {
  const index = await read('src/features/sidebar/index.js');
  for (const symbol of [
    'createOutlineController', 'buildOutlineTree', 'createOutlineCollapseStore',
    'resolveActiveOutlineHeading', 'createOutlineView', 'mountClassicOutlineControllerPort'
  ]) assert.match(index, new RegExp(symbol));
  for (const path of OUTLINE_MODULES) assert.ok((await read(path)).includes('Responsibility:'));
});

test('Atomic 6.8 consumes model/preview heading indexes and never reparses the full editor document', async () => {
  const [controller, builder, previewWorker] = await Promise.all([
    read('src/features/sidebar/outline/outline-controller.js'),
    read('src/features/sidebar/outline/outline-tree-builder.js'),
    read('src/preview/preview-worker.js')
  ]);
  assert.match(previewWorker, /updateHeadingIndex/);
  assert.match(previewWorker, /headingPatch/);
  assert.match(controller, /normalizeOutlineHeadingIndex/);
  assert.match(controller, /normalizePreviewHeadingBlocks/);
  for (const source of [controller, builder]) {
    assert.doesNotMatch(source, /createSnapshot|sliceText|getText\(|editor\.value|documentModel|markdownEditorDocumentModel/);
  }
  assert.doesNotMatch(controller, /marked\.lexer|split\(['"]\\n['"]\)/);
});

test('Atomic 6.8 removes classic Outline state/render/parser authority and routes all remaining callers through the compatibility port', async () => {
  const [core, bootstrap, events, preview, scroll] = await Promise.all([
    read('public/app/core.js'), read('public/app/bootstrap.js'), read('public/app/events.js'),
    read('public/app/preview.js'), read('public/app/scroll-sync.js')
  ]);
  for (const legacy of [
    /\boutlineDirty\b/, /\bcachedHeadings\b/, /\bcachedHeadingSource\b/, /\boutlineCollapsed\b/,
    /function\s+renderOutline\s*\(/, /function\s+getMarkdownHeadings\s*\(/,
    /function\s+updateActiveOutlineByLine\s*\(/, /function\s+jumpToLine\s*\(/
  ]) assert.doesNotMatch(core, legacy);
  assert.doesNotMatch(core, /OUTLINE_COLLAPSED_KEY/);
  assert.doesNotMatch(bootstrap, /parseOutlineCollapsed/);
  assert.doesNotMatch(events, /outlineDirty|cachedHeadingSource/);
  assert.match(core, /coreOutlineControllerPort\.replaceIndex/);
  assert.match(preview, /previewOutlineControllerPort\.replaceIndex/);
  assert.match(preview, /previewOutlineControllerPort\.replacePreviewBlocks/);
  assert.doesNotMatch(preview, /\brenderOutline\s*\(/);
  assert.match(scroll, /scrollSyncOutlineControllerPort\.updateActiveLine/);
  assert.doesNotMatch(scroll, /\bupdateActiveOutlineByLine\s*\(/);
  assert.match(core, /function\s+persistCurrentDocumentIndex\s*\(/);
});

test('Atomic 6.8 Outline view owns DOM/context actions without executable inline handlers', async () => {
  const [view, html] = await Promise.all([
    read('src/features/sidebar/outline/outline-view.js'),
    read('public/compatibility/business-content.html')
  ]);
  assert.match(view, /createElement/);
  assert.match(view, /replaceChildren/);
  assert.match(view, /addEventListener\('click'/);
  assert.match(view, /addEventListener\('contextmenu'/);
  assert.doesNotMatch(view, /\.innerHTML\s*=/);
  assert.doesNotMatch(html, /oncontextmenu="openOutlineContextMenu/);
  assert.doesNotMatch(html, /onclick="(?:expandAllOutline|collapseAllOutline|collapseContextOutlineNode)/);
  assert.match(html, /data-outline-context-action="expand-all"/);
  assert.match(html, /data-outline-context-action="collapse-all"/);
  assert.match(html, /data-outline-context-action="collapse-node"/);
});

test('Atomic 6.8 composition registers only the Outline lifecycle and does not begin 6.9 Folder Tree', async () => {
  const [main, folderTree] = await Promise.all([read('src/main.js'), read('src/sidebar/folder-file-tree.js')]);
  assert.match(main, /createOutlineCollapseStore/);
  assert.match(main, /createOutlineView/);
  assert.match(main, /createOutlineController/);
  assert.match(main, /registerLifecycle\('outline', outlineController\)/);
  assert.match(main, /mountClassicOutlineControllerPort/);
  assert.match(main, /outlineController\.start\(\)/);
  assert.match(main, /outlineController\?\.destroy\(\)/);
  assert.match(folderTree, /export function createFolderFileTreeController/);
  await assert.rejects(read('src/features/sidebar/files/folder-tree-controller.js'), /ENOENT/);
});

test('Atomic 6.8 production Outline modules have no direct browser-global authority', async () => {
  for (const path of OUTLINE_MODULES) assertNoDirectBrowserGlobalAccess(await read(path));
});
