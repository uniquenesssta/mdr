import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Atomic 6.5 exposes one Toolbar Boundary controller through the Layout public entrypoint', async () => {
  const [entry, controller] = await Promise.all([
    read('src/features/layout/index.js'),
    read('src/features/layout/toolbar/toolbar-boundary-controller.js')
  ]);
  assert.match(entry, /createToolbarBoundaryController/);
  assert.match(controller, /matchesNarrowInteractiveLayout/);
  assert.match(controller, /formatGroup\.scrollWidth/);
  assert.match(controller, /actions\.scrollWidth/);
  assert.match(controller, /toolbar-boundary-wrap/);
  assert.match(controller, /observer\?\.disconnect\(\)/);
  assert.match(controller, /cancelFrame\(evaluationFrame\)/);
  assert.doesNotMatch(controller, /\bwindow\s*(?:\.|\[)/);
  assert.doesNotMatch(controller, /\bdocument\b/);
  assert.doesNotMatch(controller, /\blocalStorage\b/);
  assert.doesNotMatch(controller, /toolbarHiddenItems|toolbar-item-hidden/);
});

test('Atomic 6.5 removes classic Toolbar Boundary authority but preserves user-configured toolbar visibility', async () => {
  const core = await read('public/app/core.js');
  for (const legacy of [
    'toolbarBoundaryObserver', 'toolbarBoundaryRaf', 'toolbarBoundaryInitialized', 'toolbarBoundaryWrapped',
    'evaluateToolbarBoundary', 'scheduleToolbarBoundaryEvaluation', 'initializeToolbarBoundaryLayout'
  ]) {
    assert.doesNotMatch(core, new RegExp(`\\b${legacy}\\b`), `core must not retain ${legacy}`);
  }
  assert.match(core, /let toolbarHiddenItems = new Set\(\)/);
  assert.match(core, /function updateToolbarItemVisibility\(\)/);
  assert.match(core, /toolbar-item-hidden/);
  assert.match(core, /refreshToolbarBoundary/);
});

test('Atomic 6.5 main composition owns start, refresh registration and destroy with explicit platform dependencies', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createToolbarBoundaryController/);
  assert.match(main, /toolbarBoundaryController = createToolbarBoundaryController/);
  assert.match(main, /toolbarBoundaryController\.start\(\)/);
  assert.match(main, /toolbarBoundaryController\?\.destroy\(\)/);
  assert.match(main, /refreshToolbarBoundary: \(\) => toolbarBoundaryController\?\.refresh\(\)/);
  assert.match(main, /createResizeObserver: typeof layoutFrameHost\.ResizeObserver === 'function'/);
  assert.match(main, /matchMedia: typeof layoutFrameHost\.matchMedia === 'function'/);
  assert.match(main, /fontsReady: document\.fonts\?\.ready \?\? null/);
});

test('Atomic 6.5 toolbar shell projects a true two-row flex layout without responsive item hiding', async () => {
  const css = await read('src/styles/shell/toolbar-shell.css');
  assert.match(css, /\.l-toolbar-shell\.toolbar-boundary-wrap\s*\{\s*flex-wrap:\s*wrap;/s);
  assert.match(css, /\.l-toolbar-shell\.toolbar-boundary-wrap \.format-group/);
  assert.match(css, /\.l-toolbar-shell\.toolbar-boundary-wrap \.editor-actions/);
  assert.doesNotMatch(css, /toolbar-boundary-wrap[^,{]*\[data-toolbar-item\][^{]*\{[^}]*display:\s*none/s);
});
