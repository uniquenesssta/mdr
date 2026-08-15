import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Atomic 6.4 exposes Compact Shell and Sidebar Layout only through the Layout public entrypoint', async () => {
  const [entry, compact, sidebar] = await Promise.all([
    read('src/features/layout/index.js'),
    read('src/features/layout/shell/compact-shell-controller.js'),
    read('src/features/layout/sidebar/sidebar-layout-controller.js')
  ]);
  assert.match(entry, /createCompactShellController/);
  assert.match(entry, /createSidebarLayoutController/);
  assert.match(compact, /getCompactShellMaxWidth/);
  assert.match(compact, /WINDOW_RESIZE_SETTLE_MS = 220/);
  assert.match(compact, /windowActiveUntil/);
  assert.match(compact, /windowBurstStartedAt/);
  assert.match(compact, /windowBurstEvents/);
  assert.match(sidebar, /aria-hidden/);
  for (const source of [compact, sidebar]) {
    assert.doesNotMatch(source, /\bwindow\s*(?:\.|\[)/);
    assert.doesNotMatch(source, /\bdocument\b/);
    assert.doesNotMatch(source, /\blocalStorage\b/);
  }
});

test('Atomic 6.4 removes classic Compact Shell and sidebar projection authority while keeping View Transition burst gating', async () => {
  const [core, bootstrap] = await Promise.all([read('public/app/core.js'), read('public/app/bootstrap.js')]);
  for (const legacy of [
    'WINDOW_RESIZE_SETTLE_MS', 'compactShellRaf', 'windowResizeSettleTimer', 'markWindowResizeActivity',
    'evaluateCompactShellLayout', 'scheduleCompactShellEvaluation', 'initializeCompactShellLayout',
    'applySidebarVisibility', 'isSidebarEffectivelyVisible'
  ]) {
    assert.doesNotMatch(core, new RegExp(`\\b${legacy}\\b`), `core must not retain ${legacy}`);
    assert.doesNotMatch(bootstrap, new RegExp(`\\b${legacy}\\b`), `bootstrap must not retain ${legacy}`);
  }
  assert.match(core, /function isWindowResizeBurstActive\(\)/);
  assert.match(core, /performance\.now\(\) < coreLayoutStatePort\.windowResizeActiveUntil/);
  assert.match(core, /&& !isWindowResizeBurstActive\(\)/);
  assert.doesNotMatch(core, /(^|\n)\s*sidebarVisible\s*=\s*applied\.sidebarVisible/m);
  assert.match(core, /coreLayoutStatePort\.sidebarVisible = applied\.sidebarVisible/);
});

test('Atomic 6.4 main composition remains intact after the 6.5 Toolbar Boundary migration', async () => {
  const [main, core] = await Promise.all([read('src/main.js'), read('public/app/core.js')]);
  assert.match(main, /createCompactShellController/);
  assert.match(main, /createSidebarLayoutController/);
  assert.match(main, /sidebarLayoutController\.start\(\)/);
  assert.match(main, /compactShellController\.start\(\)/);
  assert.match(main, /compactShellController\?\.destroy\(\)/);
  assert.match(main, /sidebarLayoutController\?\.destroy\(\)/);
  assert.match(main, /onGeometryChanged\(\) \{ scrollController\.notifyGeometryChanged\(\); \}/);
  assert.match(main, /setTimer: layoutFrameHost\.setTimeout\.bind\(layoutFrameHost\)/);
  assert.doesNotMatch(core, /function evaluateToolbarBoundary\(\)/);
  assert.doesNotMatch(core, /function initializeToolbarBoundaryLayout\(\)/);
});

test('Atomic 6.4 Preview keeps LayoutState and Outline boundaries after Atomic 7.14 removes the classic Preview script', async () => {
  const [previewController, renderEngine] = await Promise.all([
    read('src/features/preview/application/preview-controller.js'),
    read('src/features/preview/pipeline/preview-render-engine.js')
  ]);
  assert.match(previewController, /layoutState\.snapshot\.mode/);
  assert.match(previewController, /const isHybrid = \(\) => layoutState\.snapshot\.mode === 'hybrid'/);
  assert.doesNotMatch(previewController, /markdownEditorLayoutStatePort|sidebarVisible/);
  assert.match(renderEngine, /outline\?\.replaceIndex/);
  assert.match(renderEngine, /outline\?\.replacePreviewBlocks/);
  assert.doesNotMatch(renderEngine, /previewOutlineControllerPort/);
});
