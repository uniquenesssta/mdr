import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getNativeParentPath,
  isNativePathWithinDirectory,
  isSameNativePath,
  normalizeFolderFileTreeResult
} from '../src/sidebar/folder-file-tree.js';

test('folder file tree normalizes Windows paths and parent directories', () => {
  assert.equal(getNativeParentPath('F:\\Notes\\daily\\today.md'), 'F:\\Notes\\daily');
  assert.equal(getNativeParentPath('/home/user/notes/today.md'), '/home/user/notes');
  assert.equal(isSameNativePath('F:\\Notes\\Today.MD', 'f:/notes/today.md'), true);
  assert.equal(isNativePathWithinDirectory('F:\\Notes\\Archive\\old.md', 'f:/notes'), true);
  assert.equal(isNativePathWithinDirectory('F:\\Other\\old.md', 'f:/notes'), false);
  assert.equal(isSameNativePath('/Notes/Today.md', '/notes/today.md'), false);
});

test('folder file tree keeps supported files, sorts directories first, and normalizes counts', () => {
  const tree = normalizeFolderFileTreeResult({
    rootPath: 'F:\\Notes',
    rootName: 'Notes',
    fileCount: 3,
    directoryCount: 1,
    skippedCount: 2,
    truncated: true,
    nodes: [
      { kind: 'file', name: 'z.txt', path: 'F:\\Notes\\z.txt' },
      { kind: 'file', name: 'ignore.png', path: 'F:\\Notes\\ignore.png' },
      {
        kind: 'directory',
        name: 'Archive',
        path: 'F:\\Notes\\Archive',
        children: [{ kind: 'file', name: 'old.md', path: 'F:\\Notes\\Archive\\old.md' }]
      },
      { kind: 'file', name: 'a.markdown', path: 'F:\\Notes\\a.markdown' }
    ]
  });
  assert.equal(tree.rootName, 'Notes');
  assert.equal(tree.fileCount, 3);
  assert.equal(tree.skippedCount, 2);
  assert.equal(tree.truncated, true);
  assert.deepEqual(tree.nodes.map(node => node.name), ['Archive', 'a.markdown', 'z.txt']);
  assert.equal(tree.nodes.some(node => node.name === 'ignore.png'), false);
});

test('folder file tree is wired through the sidebar, runtime bridge, core state, and Rust command', async () => {
  const [index, main, core, tauri, rustMain, rustLocal] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/app/core.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/runtime/tauri.js', import.meta.url), 'utf8'),
    readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8'),
    readFile(new URL('../src-tauri/src/local_file.rs', import.meta.url), 'utf8')
  ]);
  assert.match(index, /id="sidebar-files-tab"/);
  assert.match(index, /id="folder-file-tree"/);
  assert.match(main, /createFolderFileTreeController/);
  assert.match(core, /\['docs', 'files', 'outline'\]/);
  assert.match(core, /openFolderTreeFile/);
  assert.match(tauri, /listTextFileTree/);
  assert.match(rustMain, /local_file::list_text_file_tree/);
  assert.match(rustLocal, /pub async fn list_text_file_tree/);
  assert.match(rustLocal, /MAX_FILE_TREE_ENTRIES/);
});
