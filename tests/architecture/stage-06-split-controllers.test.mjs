import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Atomic 6.3 exposes three split responsibilities only through Layout public entrypoint', async () => {
  const [entry, pane, resize, compact] = await Promise.all([
    read('src/features/layout/index.js'),
    read('src/features/layout/split/split-pane-controller.js'),
    read('src/features/layout/split/split-resize-controller.js'),
    read('src/features/layout/split/compact-split-controller.js')
  ]);
  for (const name of ['createSplitPaneController', 'createSplitResizeController', 'createCompactSplitController']) assert.match(entry, new RegExp(name));
  assert.match(resize, /setPointerCapture/);
  assert.match(resize, /releasePointerCapture/);
  assert.match(resize, /onGeometryChanged/);
  assert.match(compact, /getCompactSplitMaxWidth/);
  assert.match(compact, /compactPane/);
  assert.match(pane, /Split panes cannot both be collapsed/);
  for (const source of [pane, resize, compact]) {
    assert.match(source, /destroy\(\)/);
    assert.doesNotMatch(source, /\bwindow\b/);
    assert.doesNotMatch(source, /\bdocument\b/);
    assert.doesNotMatch(source, /refreshPreviewAfterLayout|scheduleEditorMetricsRebuild|invalidatePreviewAnchorMetrics/);
  }
});

test('Atomic 6.3 removes classic split authority and direct split listeners', async () => {
  const [core, bootstrap, events, editorTools, html] = await Promise.all([
    read('public/app/core.js'), read('public/app/bootstrap.js'), read('public/app/events.js'),
    read('public/app/editor-tools.js'), read('public/compatibility/business-content.html')
  ]);
  for (const legacy of ['startResize', 'stopResize', 'onResizeMove', 'applySplit', 'applyPaneStates', 'reconcileCompactSplitLayout', 'activateCompactSplitPane', 'initializeCompactSplitObserver', 'scheduleCompactSplitEvaluation']) {
    assert.doesNotMatch(core, new RegExp(`\\b${legacy}\\b`), `core must not retain ${legacy}`);
  }
  assert.doesNotMatch(core, /addEventListener\(['"](?:mouse|touch)(?:down|move|up|end)/);
  assert.doesNotMatch(events, /bindCompactPaneActivation|activateCompactSplitPane/);
  assert.doesNotMatch(bootstrap, /RATIO_KEY|EDITOR_COLLAPSED_KEY|PREVIEW_COLLAPSED_KEY|initializeCompactSplitObserver/);
  assert.match(editorTools, /markdownEditorSplitControllerPort/);
  assert.match(editorTools, /editorToolsSplitControllerPort\.applyMode/);
  assert.doesNotMatch(editorTools, /editorToolsLayoutStatePort\.editorCollapsed\s*=/);
  assert.doesNotMatch(editorTools, /editorToolsLayoutStatePort\.previewCollapsed\s*=/);
  assert.doesNotMatch(html, /preview-collapse-btn[^>]*onclick=/);
});

test('Atomic 6.3 composition owns start/destroy and routes split geometry to Scroll Controller', async () => {
  const main = await read('src/main.js');
  for (const name of ['createSplitPaneController', 'createSplitResizeController', 'createCompactSplitController']) assert.match(main, new RegExp(`${name}\\(\\{`));
  assert.match(main, /splitResizeController\.start\(\)/);
  assert.match(main, /splitPaneController\.start\(\)/);
  assert.match(main, /compactSplitController\.start\(\)/);
  assert.match(main, /splitResizeController\?\.destroy\(\)/);
  assert.match(main, /splitPaneController\?\.destroy\(\)/);
  assert.match(main, /compactSplitController\?\.destroy\(\)/);
  assert.match(main, /onGeometryChanged\(\) \{ scrollController\.notifyGeometryChanged\(\); \}/);
});
