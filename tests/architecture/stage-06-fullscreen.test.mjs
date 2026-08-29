import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Atomic 6.6 exposes separate page and system fullscreen controllers through the Layout entrypoint', async () => {
  const [entry, page, system] = await Promise.all([
    read('src/features/layout/index.js'),
    read('src/features/layout/fullscreen/page-fullscreen-controller.js'),
    read('src/features/layout/fullscreen/system-fullscreen-controller.js')
  ]);
  assert.match(entry, /createPageFullscreenController/);
  assert.match(entry, /PAGE_FULLSCREEN_STORAGE_KEY/);
  assert.match(entry, /createSystemFullscreenController/);
  assert.match(page, /md_editor_page_fullscreen/);
  assert.match(page, /state\.setFullscreen\(\{ page:/);
  assert.match(system, /state\.setFullscreen\(\{ system:/);
  assert.match(system, /fullscreen\.subscribe/);
  assert.match(system, /reason: 'unsupported'/);
  for (const source of [page, system]) {
    assert.doesNotMatch(source, /\bwindow\s*(?:\.|\[)/);
    assert.doesNotMatch(source, /\bdocument\s*(?:\.|\[)/);
    assert.doesNotMatch(source, /\blocalStorage\b/);
  }
});

test('Atomic 6.6 removes classic fullscreen authority and direct browser fullscreen listeners', async () => {
  const [core, bootstrap, editorTools, events] = await Promise.all([
    read('public/app/core.js'), read('public/app/bootstrap.js'), read('public/app/editor-tools.js'), read('public/app/events.js')
  ]);
  assert.doesNotMatch(core, /PAGE_FULLSCREEN_KEY/);
  assert.doesNotMatch(bootstrap, /md_editor_page_fullscreen|pageFullscreen\s*=|page-fullscreen-active|is-page-fullscreen/);
  assert.doesNotMatch(events, /addEventListener\(['"](?:webkit)?fullscreenchange/);
  assert.doesNotMatch(editorTools, /fullscreenEnabled|fullscreenElement|requestFullscreen|exitFullscreen|webkitFullscreen|localStorage\.setItem\(PAGE_FULLSCREEN_KEY/);
  assert.doesNotMatch(editorTools, /editorToolsLayoutStatePort\.(?:pageFullscreen|systemFullscreen)\s*=/);
  assert.match(editorTools, /function togglePageFullscreen\(\) \{\s*return editorToolsEditorUiCommandPort\.invoke\('togglePageFullscreen'\);\s*\}/s);
  assert.match(editorTools, /function toggleFullscreen\(\) \{\s*return editorToolsEditorUiCommandPort\.invoke\('toggleSystemFullscreen'\);\s*\}/s);
});

test('Atomic 6.6 main composition owns both fullscreen lifecycles and uses Platform ports', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createPageFullscreenController/);
  assert.match(main, /createSystemFullscreenController/);
  assert.match(main, /storage: platform\.storage/);
  assert.match(main, /fullscreen: platform\.fullscreen/);
  assert.match(main, /supported: platform\.capabilities\.browser\.fullscreen/);
  assert.match(main, /pageFullscreenController\.start\(\)/);
  assert.match(main, /systemFullscreenController\.start\(\)/);
  assert.match(main, /pageFullscreenController\?\.destroy\(\)/);
  assert.match(main, /systemFullscreenController\?\.destroy\(\)/);
  assert.match(main, /togglePageFullscreen/);
  assert.match(main, /toggleSystemFullscreen/);
  assert.match(main, /toastNoFullscreenApi/);
});

test('Atomic 6.6 leaves Stage 3 fullscreen platform ownership intact', async () => {
  const [browserAdapter, platform] = await Promise.all([
    read('src/platform/browser/browser-fullscreen.js'),
    read('src/platform/create-platform.js')
  ]);
  assert.match(browserAdapter, /requestFullscreen/);
  assert.match(browserAdapter, /webkitRequestFullscreen/);
  assert.match(browserAdapter, /fullscreenchange/);
  assert.match(platform, /createBrowserFullscreen/);
  assert.match(platform, /unsupportedPort\('fullscreen'/);
});
