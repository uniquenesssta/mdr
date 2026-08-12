import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');
const exists = path => access(new URL(path, ROOT), constants.F_OK).then(() => true, () => false);

const RESOURCE_OWNERS = Object.freeze([
  'src/features/layout/sidebar/sidebar-resize-controller.js',
  'src/features/layout/sidebar/sidebar-layout-controller.js',
  'src/features/layout/split/split-resize-controller.js',
  'src/features/layout/split/split-pane-controller.js',
  'src/features/layout/split/compact-split-controller.js',
  'src/features/layout/shell/compact-shell-controller.js',
  'src/features/layout/toolbar/toolbar-boundary-controller.js',
  'src/features/layout/fullscreen/system-fullscreen-controller.js',
  'src/features/sidebar/tabs/sidebar-tab-controller.js',
  'src/features/sidebar/outline/outline-view.js',
  'src/features/sidebar/folder-tree/folder-tree-view.js',
  'src/features/sidebar/folder-tree/folder-tree-node-view.js',
  'src/features/menu/menu-view.js',
  'src/features/menu/menu-controller.js',
  'src/features/menu/submenu-positioner.js',
  'src/features/menu/recent-files-menu-controller.js',
  'src/features/window/window-controls-view.js',
  'src/features/window/window-drag-region.js',
  'src/features/window/window-close-controller.js',
  'src/features/window/window-controller.js'
]);

const VALIDATION_FILES = Object.freeze([
  'tests/helpers/lifecycle-resource-ledger.mjs',
  'tests/unit/layout/stage-06-layout-destroy-validation.test.mjs',
  'tests/unit/sidebar/stage-06-sidebar-destroy-validation.test.mjs',
  'tests/unit/menu/stage-06-menu-destroy-validation.test.mjs',
  'tests/unit/window/stage-06-window-destroy-validation.test.mjs'
]);

test('Atomic 6.14 keeps lifecycle validation modular by resource-owning domain', async () => {
  for (const path of VALIDATION_FILES) assert.equal(await exists(path), true, `${path} must exist`);
  const helper = await read(VALIDATION_FILES[0]);
  for (const category of ['listeners', 'pointerCaptures', 'observers', 'frames', 'timers', 'subscriptions']) {
    assert.match(helper, new RegExp(`\\b${category}\\b`), `resource ledger must count ${category}`);
  }
  assert.match(helper, /assertLifecycleZero/);
});

test('every audited Stage 6 resource owner retains an explicit destroy boundary', async () => {
  for (const path of RESOURCE_OWNERS) {
    const source = await read(path);
    assert.match(source, /destroy\s*\(\)/, `${path} must expose or own destroy cleanup`);
  }
});

test('Atomic 6.14 resource-ledger tests require stable repeated start and zero-after-destroy semantics', async () => {
  const tests = (await Promise.all(VALIDATION_FILES.slice(1).map(read))).join('\n');
  assert.match(tests, /repeated start/i);
  assert.match(tests, /assertLifecycleZero/);
  assert.match(tests, /pointerCaptures/);
  assert.match(tests, /observers/);
  assert.match(tests, /frames/);
  assert.match(tests, /timers/);
  assert.match(tests, /subscriptions/);
});

test('Compact Split rejects stale observer scheduling after destroy instead of relying on callback timing', async () => {
  const source = await read('src/features/layout/split/compact-split-controller.js');
  const schedule = source.match(/function scheduleEvaluation\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(schedule, /if \(destroyed\) return false;/);
  assert.match(schedule, /requestFrame/);
  assert.match(source, /observer\?\.disconnect\?\.\(\)/);
  assert.match(source, /cancelFrame\(evaluationFrame\)/);
});

test('Stage 6 composition still destroys every Layout, Sidebar, Menu and Window lifecycle owner through existing roots', async () => {
  const [main, moduleEntry] = await Promise.all([
    read('src/main.js'),
    read('src/bootstrap/module-entry.js')
  ]);
  for (const token of [
    'sidebarResizeController?.destroy()',
    'splitResizeController?.destroy()',
    'splitPaneController?.destroy()',
    'compactSplitController?.destroy()',
    'compactShellController?.destroy()',
    'toolbarBoundaryController?.destroy()',
    'sidebarLayoutController?.destroy()',
    'systemFullscreenController?.destroy()',
    'sidebarTabController?.destroy()',
    'outlineController?.destroy()',
    'folderTreeController?.destroy()',
    'recentFilesMenuController?.destroy()',
    'windowController.destroy()'
  ]) assert.match(main, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const token of [
    'menuController?.destroy()',
    'submenuPositioner?.destroy()',
    'menuCommandBindings?.destroy()',
    'menuState?.destroy()'
  ]) assert.match(moduleEntry, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
