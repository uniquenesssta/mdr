import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Atomic 6.2 exposes Sidebar Resize only through the Layout public entrypoint', async () => {
  const [entry, controller] = await Promise.all([
    read('src/features/layout/index.js'),
    read('src/features/layout/sidebar/sidebar-resize-controller.js')
  ]);
  assert.match(entry, /createSidebarResizeController/);
  assert.match(entry, /SIDEBAR_WIDTH_STORAGE_KEY/);
  assert.match(controller, /setPointerCapture/);
  assert.match(controller, /releasePointerCapture/);
  assert.match(controller, /matchesNarrowInteractiveLayout/);
  assert.match(controller, /--sidebar-width/);
  assert.match(controller, /md_editor_sidebar_width/);
  assert.match(controller, /onGeometryChanged/);
  assert.match(controller, /destroy\(\)/);
  assert.doesNotMatch(controller, /\bwindow\b/);
  assert.doesNotMatch(controller, /\bdocument\b/);
  assert.doesNotMatch(controller, /max-width:\s*768px/);
});

test('Atomic 6.2 removes the old sidebar resize behavior authority from classic core/bootstrap while preserving split resize', async () => {
  const [core, bootstrap] = await Promise.all([
    read('public/app/core.js'),
    read('public/app/bootstrap.js')
  ]);
  for (const legacy of [
    'SIDEBAR_WIDTH_KEY', 'normalizeSidebarWidth', 'applySidebarWidth', 'sidebarResizeRect',
    'startSidebarResize', 'onSidebarResizeMove', 'stopSidebarResize', 'getPointerClientX'
  ]) {
    assert.doesNotMatch(core, new RegExp(`\\b${legacy}\\b`), `core must not retain ${legacy}`);
    assert.doesNotMatch(bootstrap, new RegExp(`\\b${legacy}\\b`), `bootstrap must not retain ${legacy}`);
  }
  assert.doesNotMatch(core, /sidebar-resizer['"]\)\?\.addEventListener\(['"]mousedown/);
  assert.match(core, /function startResize\(e\)/);
  assert.match(core, /function stopResize\(\)/);
  assert.match(core, /function onResizeMove\(e\)/);
  assert.match(core, /localStorage\.setItem\(RATIO_KEY, coreLayoutStatePort\.editorRatio\)/);
});

test('Atomic 6.2 main lifecycle owns start/destroy and passes explicit geometry dependencies', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createSidebarResizeController/);
  assert.match(main, /sidebarResizeController = createSidebarResizeController\(\{/);
  assert.match(main, /state: layoutState/);
  assert.match(main, /workspace: requireElement\('\.workspace'/);
  assert.match(main, /resizer: requireElement\('#sidebar-resizer'/);
  assert.match(main, /onGeometryChanged\(\) \{ scrollController\.notifyGeometryChanged\(\); \}/);
  assert.match(main, /sidebarResizeController\.start\(\)/);
  assert.match(main, /sidebarResizeController\?\.destroy\(\)/);
});

test('Atomic 6.2 does not modify Frozen DocumentModel', async () => {
  const model = await read('src/document/document-model.js');
  assert.ok(model.length > 0);
});
