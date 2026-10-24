import { readFile, access } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('Atomic 6.11 owns submenu geometry outside MenuView and removes the classic implementation path', async () => {
  const [positioner, port, menuView, menuIndex, moduleEntry, core, events] = await Promise.all([
    readFile('src/features/menu/submenu-positioner.js', 'utf8'),
    readFile('src/features/menu/index.js', 'utf8'),
    readFile('src/features/menu/menu-view.js', 'utf8'),
    readFile('src/features/menu/index.js', 'utf8'),
    readFile('src/bootstrap/module-entry.js', 'utf8'),
    Promise.all([
      readFile('src/features/documents/ui/document-workspace.js', 'utf8'),
      readFile('src/features/menu/shell-menus.js', 'utf8'),
      readFile('src/features/persistence/ui/workspace-status.js', 'utf8'),
      readFile('src/features/layout/workspace-preferences.js', 'utf8')
    ]).then(sources => sources.join('\n')),
    readFile('src/bootstrap/application-events.js', 'utf8')
  ]);

  assert.match(positioner, /getBoundingClientRect\(\)/);
  assert.match(positioner, /innerWidth/);
  assert.match(positioner, /innerHeight/);
  assert.match(positioner, /pointerenter/);
  assert.match(positioner, /focusin/);
  assert.match(positioner, /closeDelayMs/);
  assert.match(positioner, /cancelAnimationFrame|cancelFrame/);
  assert.doesNotMatch(positioner, /localStorage|recentFiles|RecentFiles|saveCurrentFile|exportPDF/);

  assert.doesNotMatch(menuView, /getBoundingClientRect|innerWidth|innerHeight|setTimeout|is-submenu-open/);
  assert.match(menuIndex, /createSubmenuPositioner/);
  assert.doesNotMatch(menuIndex, /mountClassicSubmenuPositionerPort/);
  assert.doesNotMatch(port, /markdownEditorSubmenuPositionerPort/);
  assert.doesNotMatch(port, /getBoundingClientRect|setTimeout|localStorage/);

  assert.match(moduleEntry, /createSubmenuPositioner/);
  assert.doesNotMatch(moduleEntry, /mountClassicSubmenuPositionerPort/);
  assert.match(moduleEntry, /submenuPositioner\.start\(\)/);
  assert.match(core, /coreSubmenuPositionerPort/);
  assert.match(core, /coreSubmenuPositionerPort\.closeAll\(\)/);
  assert.doesNotMatch(core, /function positionAppSubmenu|function resetAppSubmenuPosition|function initializeAppSubmenus|__markdownEditorCancelSubmenuClose/);
  assert.doesNotMatch(events, /initializeAppSubmenus/);

  await access('src/features/menu/recent-files-menu-controller.js');
  const recentFilesController = await readFile('src/features/menu/recent-files-menu-controller.js', 'utf8');
  assert.doesNotMatch(recentFilesController, /getBoundingClientRect|innerWidth|innerHeight|requestAnimationFrame/);
});
