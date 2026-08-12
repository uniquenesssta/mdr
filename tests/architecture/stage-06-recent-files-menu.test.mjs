import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');
const exists = path => access(new URL(path, ROOT), constants.F_OK).then(() => true, () => false);

test('Atomic 6.12 Recent Files Menu has one dedicated controller behind public Menu/Documents entries', async () => {
  const [menuEntry, documentsEntry, controller, readSource, main, bootstrap] = await Promise.all([
    read('src/features/menu/index.js'),
    read('src/features/documents/index.js'),
    read('src/features/menu/recent-files-menu-controller.js'),
    read('src/features/documents/application/recent-files-read-source.js'),
    read('src/main.js'),
    read('src/bootstrap/module-entry.js')
  ]);
  assert.match(menuEntry, /createRecentFilesMenuController/);
  assert.match(menuEntry, /mountClassicMenuCommandPort/);
  assert.match(documentsEntry, /createRecentFilesReadSource/);
  assert.match(main, /from '\.\/features\/documents\/index\.js'/);
  assert.match(main, /from '\.\/features\/menu\/index\.js'/);
  assert.match(bootstrap, /from '\.\.\/features\/menu\/index\.js'/);
  assert.doesNotMatch(main, /features\/menu\/recent-files-menu-controller\.js|features\/documents\/application\/recent-files-read-source\.js/);
  assert.doesNotMatch(controller, /localStorage|sessionStorage|RecentFilesRepository|recent-files-repository|platform\.files|handleNativeDroppedPath|markdownEditorRecentFilesPort/);
  assert.doesNotMatch(readSource, /localStorage|sessionStorage|\.add\(|\.clear\(|document\.|window\.|createElement/);
});

test('Atomic 6.12 keeps Documents as the sole Recent Files persistence authority and classic as write-only compatibility', async () => {
  const [repository, classicPort, core, classicBootstrap, events, main] = await Promise.all([
    read('src/features/documents/infrastructure/recent-files-repository.js'),
    read('src/features/documents/compatibility/classic-recent-files-port.js'),
    read('public/app/core.js'),
    read('public/app/bootstrap.js'),
    read('public/app/events.js'),
    read('src/main.js')
  ]);
  assert.match(repository, /md_editor_recent_files/);
  assert.match(repository, /storage\.getItem/);
  assert.match(repository, /storage\.setItem/);
  assert.match(repository, /subscribe\(listener\)/);
  assert.doesNotMatch(classicPort, /get entries|\bload\s*:|call\('load'\)|repository\.load/);
  assert.match(classicPort, /add: call\('add'\)/);
  assert.match(classicPort, /clear: call\('clear'\)/);
  assert.doesNotMatch(core, /function (loadRecentFiles|renderRecentFilesMenu|openRecentFile|clearRecentFiles)\s*\(/);
  assert.doesNotMatch(core, /coreRecentFilesPort\.(load|clear|entries)/);
  assert.match(core, /coreRecentFilesPort\.add/);
  assert.doesNotMatch(classicBootstrap, /loadRecentFiles\(|renderRecentFilesMenu\(/);
  assert.match(events, /if \(opened\) addRecentFile\(resolvedPath, name\)/);
  assert.match(main, /recentFilesRepository\.load\(\)/);
  assert.match(main, /createRecentFilesReadSource\(recentFilesRepository\)/);
});

test('Atomic 6.12 emits stable Menu commands and does not leak Recent Files into MenuView or Submenu Positioner', async () => {
  const [bindings, controller, view, positioner, adapter, commandPort] = await Promise.all([
    read('src/features/menu/menu-command-bindings.js'),
    read('src/features/menu/recent-files-menu-controller.js'),
    read('src/features/menu/menu-view.js'),
    read('src/features/menu/submenu-positioner.js'),
    read('src/features/menu/compatibility/classic-menu-command-adapter.js'),
    read('src/features/menu/compatibility/classic-menu-command-port.js')
  ]);
  assert.match(bindings, /RECENT_FILE_OPEN: 'document\.open-recent'/);
  assert.match(bindings, /RECENT_FILES_CLEAR: 'document\.clear-recent'/);
  assert.match(controller, /C\.RECENT_FILE_OPEN/);
  assert.match(controller, /C\.RECENT_FILES_CLEAR/);
  assert.doesNotMatch(view, /RecentFiles|recentFiles|recent-files-menu-controller/);
  assert.doesNotMatch(positioner, /RecentFiles|recentFiles|localStorage|sessionStorage/);
  assert.match(adapter, /C\.RECENT_FILE_OPEN/);
  assert.match(adapter, /C\.RECENT_FILES_CLEAR/);
  assert.match(commandPort, /bindings\.execute/);
  assert.doesNotMatch(commandPort, /RecentFilesRepository|localStorage|createElement|handleNativeDroppedPath/);
});

test('Atomic 6.12 owns subscription/listener destroy paths and does not pre-implement Atomic 6.13 Window Controller', async () => {
  const [controller, main] = await Promise.all([
    read('src/features/menu/recent-files-menu-controller.js'),
    read('src/main.js')
  ]);
  assert.match(controller, /unsubscribe = source\.subscribe/);
  assert.match(controller, /dispose\?\.\(\)/);
  assert.match(controller, /removeEventListener\('click'/);
  assert.match(main, /recentFilesMenuController\?\.destroy/);
  assert.equal(await exists('src/features/window/window-controller.js'), false);
});
