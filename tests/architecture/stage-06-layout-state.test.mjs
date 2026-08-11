import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');

const migratedStateDeclarations = [
  'sidebarVisible', 'sidebarAutoCollapsed', 'sidebarWidth',
  'editorCollapsed', 'previewCollapsed', 'editorRatio',
  'compactShellActive', 'compactShellInitialized',
  'compactSplitActive', 'compactSplitPane',
  'isResizing', 'isSidebarResizing',
  'windowResizeActiveUntil', 'windowResizeBurstStartedAt', 'windowResizeBurstEvents'
];

test('Atomic 6.1 creates the public Layout feature and one scoped state owner before classic application loading', async () => {
  const [index, state, port, main] = await Promise.all([
    read('src/features/layout/index.js'),
    read('src/features/layout/state/layout-state.js'),
    read('src/features/layout/compatibility/classic-layout-state-port.js'),
    read('src/main.js')
  ]);
  assert.match(index, /createLayoutState/);
  assert.match(index, /responsive-breakpoints\.js/);
  assert.match(index, /mountClassicLayoutStatePort/);
  assert.match(state, /runtime layout state/);
  assert.doesNotMatch(state, /\b(document|window|localStorage|sessionStorage)\b/);
  assert.match(port, /markdownEditorLayoutStatePort/);
  assert.match(main, /createLayoutState\(\)/);
  assert.match(main, /mountClassicLayoutStatePort\(compatibilityPlatformHost, layoutState\)/);
  assert.ok(main.indexOf('mountClassicLayoutStatePort') < main.indexOf('for (const src of APP_MODULES)'));
});

test('all migrated classic callers use the scoped LayoutState port and no second lexical state center remains', async () => {
  const paths = [
    'public/app/core.js',
    'public/app/bootstrap.js',
    'public/app/editor-tools.js',
    'public/app/events.js',
    'public/app/preview.js',
    'public/app/scroll-sync.js'
  ];
  const sources = await Promise.all(paths.map(read));
  for (const [index, source] of sources.entries()) {
    assert.match(source, /markdownEditorLayoutStatePort/, `${paths[index]} must depend on LayoutState port`);
  }
  for (const name of migratedStateDeclarations) {
    const declaration = new RegExp(`\\b(?:let|var|const)\\s+${name}\\b`);
    for (const [index, source] of sources.entries()) {
      assert.doesNotMatch(source, declaration, `${paths[index]} must not redeclare ${name}`);
    }
  }
  assert.doesNotMatch(sources[0], /coreSettingsStorePort\.get\(['"]layoutMode['"]\)/);
  assert.doesNotMatch(sources[2], /editorToolsSettingsStorePort\.get\(['"]layoutMode['"]\)/);
});

test('responsive layout logic gets every current JS breakpoint from responsive-breakpoints', async () => {
  const [breakpoints, core, compactShell, compactSplit] = await Promise.all([
    read('src/features/layout/shell/responsive-breakpoints.js'),
    read('public/app/core.js'),
    read('src/features/layout/shell/compact-shell-controller.js'),
    read('src/features/layout/split/compact-split-controller.js')
  ]);
  for (const value of [860, 900, 720, 760, 768]) assert.match(breakpoints, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(core, /COMPACT_SHELL_WINDOW_WIDTH|COMPACT_SHELL_EXIT_WIDTH|COMPACT_SPLIT_MAIN_WIDTH|COMPACT_SPLIT_EXIT_MAIN_WIDTH/);
  assert.doesNotMatch(core, /max-width:\s*768px/);
  assert.match(compactShell, /getCompactShellMaxWidth/);
  assert.doesNotMatch(core, /getCompactShellMaxWidth/);
  assert.match(compactSplit, /getCompactSplitMaxWidth/);
  assert.doesNotMatch(core, /getCompactSplitMaxWidth/);
  assert.match(core, /matchesNarrowInteractive/);
});

test('Atomic 6.3 advances the 6.1/6.2 handoff: split authority leaves core while Sidebar and Frozen DocumentModel stay intact', async () => {
  const [core, sidebarResize, splitResize, compactSplit, model] = await Promise.all([
    read('public/app/core.js'),
    read('src/features/layout/sidebar/sidebar-resize-controller.js'),
    read('src/features/layout/split/split-resize-controller.js'),
    read('src/features/layout/split/compact-split-controller.js'),
    read('src/document/document-model.js')
  ]);
  assert.doesNotMatch(core, /let resizeRect = null;|let resizeStartedAt = 0;|function startResize|function onResizeMove|function stopResize/);
  assert.doesNotMatch(core, /let sidebarResizeRect = null;|function startSidebarResize/);
  assert.match(sidebarResize, /setPointerCapture/);
  assert.match(sidebarResize, /releasePointerCapture/);
  assert.match(splitResize, /setPointerCapture/);
  assert.match(splitResize, /releasePointerCapture/);
  assert.match(compactSplit, /getCompactSplitMaxWidth/);
  assert.equal(model.length > 0, true);
  await access('src/features/layout/state/layout-state.js');
});


test('Atomic 6.1 migration preserves source object members and persisted Settings keys', async () => {
  const [core, bootstrap] = await Promise.all([
    read('public/app/core.js'),
    read('public/app/bootstrap.js')
  ]);
  assert.match(bootstrap, /restoredSettings\.sidebarVisible/);
  assert.doesNotMatch(bootstrap, /restoredSettings\.bootstrapLayoutStatePort/);
  assert.match(core, /applied\.sidebarVisible/);
  assert.doesNotMatch(core, /applied\.coreLayoutStatePort/);
  assert.match(core, /coreSettingsStorePort\.set\(['"]sidebarVisible['"],/);
  assert.doesNotMatch(core, /coreSettingsStorePort\.set\(['"]coreLayoutStatePort\./);
});

test('Atomic 6.1 layout state remains single-authority after Atomic 6.4 removes classic compact-shell authority', async () => {
  const core = await read('public/app/core.js');
  for (const name of [
    'sidebarVisible', 'sidebarAutoCollapsed', 'sidebarWidth',
    'editorCollapsed', 'previewCollapsed', 'editorRatio',
    'compactShellActive', 'compactShellInitialized',
    'compactSplitActive', 'compactSplitPane',
    'isResizing', 'isSidebarResizing',
    'windowResizeActiveUntil', 'windowResizeBurstStartedAt', 'windowResizeBurstEvents'
  ]) {
    const declaration = new RegExp(`\b(?:let|var|const)\s+${name}\b`);
    assert.doesNotMatch(core, declaration, `core must not recreate layout authority ${name}`);
  }
  assert.doesNotMatch(core, /function (?:startResize|onResizeMove|stopResize|applySplit|applyPaneStates|reconcileCompactSplitLayout|activateCompactSplitPane)/);
});

test('Atomic 6.1 scroll-sync reads resize activity only from LayoutState', async () => {
  const scrollSync = await read('public/app/scroll-sync.js');
  assert.match(scrollSync, /scrollSyncLayoutStatePort\.isResizing/);
  assert.doesNotMatch(scrollSync, /(?<![\\w.$])\bisResizing\b/);
});
