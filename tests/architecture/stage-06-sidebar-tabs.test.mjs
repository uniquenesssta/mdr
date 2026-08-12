import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = path => readFile(resolve(ROOT, path), 'utf8');

test('Atomic 6.7 exposes Sidebar state/tab/compatibility through the public Sidebar feature entry', async () => {
  const index = await read('src/features/sidebar/index.js');
  assert.match(index, /createSidebarState/);
  assert.match(index, /createSidebarTabController/);
  assert.match(index, /mountClassicSidebarControllerPort/);
});

test('Atomic 6.7 keeps classic tab state, persistence, projection and inline click authority removed', async () => {
  const [core, bootstrap, preview, html] = await Promise.all([
    read('public/app/core.js'), read('public/app/bootstrap.js'), read('public/app/preview.js'), read('public/compatibility/business-content.html')
  ]);
  for (const source of [core, bootstrap, preview]) {
    assert.doesNotMatch(source, /\bactiveSidebarTab\b/);
    assert.doesNotMatch(source, /\bSIDEBAR_TAB_KEY\b/);
  }
  assert.doesNotMatch(core, /function\s+setSidebarTab\s*\(/);
  assert.doesNotMatch(html, /onclick="setSidebarTab\(/);
  assert.match(core, /markdownEditorSidebarControllerPort/);
  assert.match(preview, /markdownEditorSidebarControllerPort/);
});

test('Atomic 6.7 composition still owns tab mount switching while Documents keeps document-list ownership', async () => {
  const [main, documentListView, tabController] = await Promise.all([
    read('src/main.js'), read('src/features/documents/ui/document-list-view.js'), read('src/features/sidebar/tabs/sidebar-tab-controller.js')
  ]);
  assert.match(main, /createSidebarState/);
  assert.match(main, /createSidebarTabController/);
  assert.match(main, /mountClassicSidebarControllerPort/);
  assert.match(main, /registerLifecycle\('files', folderFileTreeController\)/);
  assert.match(main, /registerLifecycle\('outline', outlineController\)/);
  assert.match(main, /sidebarTabController\.start\(\)/);
  assert.match(main, /createDocumentListView\(\{[\s\S]*?#document-list/);
  assert.match(documentListView, /session\.subscribe/);
  assert.doesNotMatch(tabController, /document-list|DocumentSession|records|heading|folder-file-tree/);
});

test('Atomic 6.7 remains a tab boundary after 6.8 Outline migration and 6.9 Folder Tree is still not started', async () => {
  const [outlineController, folderTree] = await Promise.all([
    read('src/features/sidebar/outline/outline-controller.js'),
    read('src/sidebar/folder-file-tree.js')
  ]);
  assert.match(outlineController, /createOutlineController/);
  assert.match(folderTree, /export function createFolderFileTreeController/);
  await assert.rejects(read('src/features/sidebar/files/folder-tree-controller.js'), /ENOENT/);
});

test('Atomic 6.7 Sidebar tab modules avoid direct browser-global authority', async () => {
  for (const path of [
    'src/features/sidebar/state/sidebar-state.js',
    'src/features/sidebar/tabs/sidebar-tab-controller.js',
    'src/features/sidebar/compatibility/classic-sidebar-controller-port.js'
  ]) {
    const source = await read(path);
    assert.doesNotMatch(source, /\bwindow\s*[.[]/);
    assert.doesNotMatch(source, /\bdocument\s*[.[]/);
    assert.doesNotMatch(source, /\blocalStorage\s*[.[]/);
  }
});
