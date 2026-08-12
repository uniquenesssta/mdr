import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = path => readFile(resolve(ROOT, path), 'utf8');

test('Atomic 6.7 exposes Sidebar state/tab/compatibility only through one public feature entry', async () => {
  const index = await read('src/features/sidebar/index.js');
  assert.match(index, /createSidebarState/);
  assert.match(index, /createSidebarTabController/);
  assert.match(index, /mountClassicSidebarControllerPort/);
});

test('Atomic 6.7 removes classic tab state, persistence, projection and inline click authority', async () => {
  const [core, bootstrap, preview, html] = await Promise.all([
    read('public/app/core.js'), read('public/app/bootstrap.js'), read('public/app/preview.js'), read('public/compatibility/business-content.html')
  ]);
  for (const source of [core, bootstrap, preview]) {
    assert.doesNotMatch(source, /\bactiveSidebarTab\b/);
    assert.doesNotMatch(source, /\bSIDEBAR_TAB_KEY\b/);
  }
  assert.doesNotMatch(core, /function\s+setSidebarTab\s*\(/);
  assert.doesNotMatch(html, /onclick="setSidebarTab\(/);
  assert.match(core, /coreSidebarControllerPort\.isActive\('outline'\)/);
  assert.match(preview, /previewSidebarControllerPort\.isActive\('outline'\)/);
});

test('Atomic 6.7 composition registers files and outline lifecycles while Documents keeps document-list ownership', async () => {
  const [main, core, documentListView] = await Promise.all([
    read('src/main.js'), read('public/app/core.js'), read('src/features/documents/ui/document-list-view.js')
  ]);
  assert.match(main, /createSidebarState/);
  assert.match(main, /createSidebarTabController/);
  assert.match(main, /mountClassicSidebarControllerPort/);
  assert.match(main, /registerLifecycle\('files', folderFileTreeController\)/);
  assert.match(main, /sidebarTabController\.start\(\)/);
  assert.match(main, /createDocumentListView\(\{[\s\S]*?#document-list/);
  assert.match(documentListView, /session\.subscribe/);
  assert.doesNotMatch(await read('src/features/sidebar/tabs/sidebar-tab-controller.js'), /document-list|DocumentSession|records/);
  assert.match(core, /registerLifecycle\('outline'/);
});

test('Atomic 6.7 does not begin 6.8 Outline or 6.9 Folder Tree decomposition', async () => {
  const [core, folderTree] = await Promise.all([read('public/app/core.js'), read('src/sidebar/folder-file-tree.js')]);
  assert.match(core, /function\s+renderOutline\s*\(/);
  assert.match(core, /OUTLINE_COLLAPSED_KEY/);
  assert.match(folderTree, /export function createFolderFileTreeController/);
  await assert.rejects(read('src/features/sidebar/outline/outline-controller.js'), /ENOENT/);
  await assert.rejects(read('src/features/sidebar/files/folder-tree-controller.js'), /ENOENT/);
});

test('Atomic 6.7 Sidebar modules avoid direct browser-global authority', async () => {
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
