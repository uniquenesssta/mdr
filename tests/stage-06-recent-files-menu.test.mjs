import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');

test('Atomic 6.12 public contract keeps Recent Files Menu read-only and command-driven', async () => {
  const [controller, readSource, core, bootstrap, main] = await Promise.all([
    read('src/features/menu/recent-files-menu-controller.js'),
    read('src/features/documents/application/recent-files-read-source.js'),
    read('public/app/core.js'),
    read('public/app/bootstrap.js'),
    read('src/main.js')
  ]);
  assert.match(controller, /source\.subscribe/);
  assert.match(controller, /RECENT_FILE_OPEN/);
  assert.match(controller, /RECENT_FILES_CLEAR/);
  assert.doesNotMatch(controller, /localStorage|sessionStorage/);
  assert.doesNotMatch(readSource, /localStorage|sessionStorage|\.add\(|\.clear\(/);
  assert.doesNotMatch(core, /function (loadRecentFiles|renderRecentFilesMenu|openRecentFile|clearRecentFiles)\s*\(/);
  assert.doesNotMatch(bootstrap, /loadRecentFiles\(|renderRecentFilesMenu\(/);
  assert.match(main, /recentFilesRepository\.load\(\)/);
  assert.match(main, /recentFilesMenuController\.start\(\)/);
});
