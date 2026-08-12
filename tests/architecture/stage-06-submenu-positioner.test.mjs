import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

test('Atomic 6.11 owns submenu geometry outside MenuView and removes the classic implementation path', async () => {
  const [positioner, port, menuView, menuIndex, moduleEntry, core, events] = await Promise.all([
    readFile('src/features/menu/submenu-positioner.js', 'utf8'),
    readFile('src/features/menu/compatibility/classic-submenu-positioner-port.js', 'utf8'),
    readFile('src/features/menu/menu-view.js', 'utf8'),
    readFile('src/features/menu/index.js', 'utf8'),
    readFile('src/bootstrap/module-entry.js', 'utf8'),
    readFile('public/app/core.js', 'utf8'),
    readFile('public/app/events.js', 'utf8')
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
  assert.match(menuIndex, /mountClassicSubmenuPositionerPort/);
  assert.match(port, /markdownEditorSubmenuPositionerPort/);
  assert.doesNotMatch(port, /getBoundingClientRect|setTimeout|localStorage/);

  assert.match(moduleEntry, /createSubmenuPositioner/);
  assert.match(moduleEntry, /mountClassicSubmenuPositionerPort/);
  assert.match(moduleEntry, /submenuPositioner\.start\(\)/);
  assert.match(core, /markdownEditorSubmenuPositionerPort/);
  assert.match(core, /coreSubmenuPositionerPort\.closeAll\(\)/);
  assert.doesNotMatch(core, /function positionAppSubmenu|function resetAppSubmenuPosition|function initializeAppSubmenus|__markdownEditorCancelSubmenuClose/);
  assert.doesNotMatch(events, /initializeAppSubmenus/);

  await assert.rejects(access('src/features/menu/recent-files-menu-controller.js'));
});
