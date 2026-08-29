import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');
const exists = path => access(new URL(path, ROOT), constants.F_OK).then(() => true, () => false);

test('Atomic 6.13 exposes the responsibility-split Window feature through one public entry', async () => {
  const entry = await read('src/features/window/index.js');
  for (const symbol of [
    'createCloseSavePort',
    'createWindowState',
    'createWindowControlsView',
    'createWindowDragRegion',
    'createWindowCloseController',
    'createWindowController',
    'mountClassicCloseSavePort'
  ]) assert.match(entry, new RegExp(symbol));

  for (const path of [
    'src/features/window/close-save-port.js',
    'src/features/window/window-state.js',
    'src/features/window/window-controls-view.js',
    'src/features/window/window-drag-region.js',
    'src/features/window/window-close-controller.js',
    'src/features/window/window-controller.js',
    'src/features/window/compatibility/classic-close-save-port.js'
  ]) assert.equal(await exists(path), true, `${path} must exist`);
});

test('Atomic 6.13 removes classic Window authority while preserving close-save policy in the application layer', async () => {
  const [events, main, closeController, closeSavePort, classicPort] = await Promise.all([
    read('public/app/events.js'),
    read('src/main.js'),
    read('src/features/window/window-close-controller.js'),
    read('src/features/window/close-save-port.js'),
    read('src/features/window/compatibility/classic-close-save-port.js')
  ]);
  for (const token of [
    'applyWindowMaximizedState', 'refreshWindowChromeState', 'setupWindowChrome',
    'windowCloseCommitted', 'windowCloseSaving', 'commitWindowClose'
  ]) assert.doesNotMatch(events, new RegExp(token));
  assert.doesNotMatch(events, /call\('window'/);
  assert.match(events, /eventsCloseSavePort\.register/);
  assert.match(events, /saveCurrentDocumentState\(false, \{ waitForNative: true, forceSnapshot: true \}\)/);
  assert.match(events, /confirmUserAction\('关闭前保存失败/);
  assert.match(main, /mountClassicCloseSavePort\(compatibilityPlatformHost, closeSavePort\)/);
  assert.match(closeController, /closeSave\.prepareClose\(\)/);
  assert.doesNotMatch(closeController, /saveCurrentDocumentState|confirmUserAction|localStorage|sessionStorage/);
  assert.doesNotMatch(closeSavePort, /WindowPort|saveCurrentDocumentState|confirmUserAction|localStorage|sessionStorage/);
  assert.match(classicPort, /register\(handler\)/);
  assert.doesNotMatch(classicPort, /prepareClose|requestClose|forceClose|saveCurrentDocumentState/);
});

test('WindowState is the unique desktop-window state owner and DOM geometry/control responsibilities stay separated', async () => {
  const [state, controls, drag, close, controller] = await Promise.all([
    read('src/features/window/window-state.js'),
    read('src/features/window/window-controls-view.js'),
    read('src/features/window/window-drag-region.js'),
    read('src/features/window/window-close-controller.js'),
    read('src/features/window/window-controller.js')
  ]);
  assert.match(state, /available/);
  assert.match(state, /maximized/);
  assert.match(state, /closePhase/);
  assert.doesNotMatch(state, /document\.|window\.|localStorage|sessionStorage|WindowPort|createElement/);

  assert.match(controls, /window-maximized/);
  assert.match(controls, /icon-restore/);
  assert.match(controls, /addEventListener\('click'/);
  assert.doesNotMatch(controls, /windowPort|CloseSavePort|saveCurrentDocumentState|localStorage|sessionStorage/);

  assert.match(drag, /addEventListener\('mousedown'/);
  assert.match(drag, /INTERACTIVE_SELECTOR/);
  assert.doesNotMatch(drag, /windowPort|CloseSavePort|localStorage|sessionStorage/);

  assert.match(close, /setClosePhase/);
  assert.match(close, /subscribeCloseRequest/);
  assert.match(close, /requestClose/);
  assert.match(close, /forceClose/);
  assert.doesNotMatch(close, /querySelector|classList|addEventListener\('click'|startDrag|minimize|toggleMaximize/);

  assert.match(controller, /subscribeResize/);
  assert.match(controller, /isMaximized/);
  assert.match(controller, /startDrag/);
  assert.match(controller, /minimize/);
  assert.match(controller, /toggleMaximize/);
  assert.doesNotMatch(controller, /querySelector|createElement|saveCurrentDocumentState|confirmUserAction|localStorage|sessionStorage/);
});

test('Atomic 6.13 composition uses only public Window/Platform entries and keeps Tauri ownership in Stage 3 WindowClient', async () => {
  const [main, platformClient, fixture] = await Promise.all([
    read('src/main.js'),
    read('src/platform/desktop/window-client.js'),
    read('tests/architecture/fixtures/production-modules.json')
  ]);
  assert.match(main, /from '\.\/features\/window\/index\.js'/);
  assert.doesNotMatch(main, /features\/window\/(window-controller|window-state|window-controls-view|window-drag-region|window-close-controller|close-save-port)\.js/);
  assert.match(main, /windowPort: platform\.window/);
  assert.match(main, /await windowController\.start\(\)/);
  assert.match(main, /windowController\.destroy\(\)/);
  assert.match(platformClient, /@tauri-apps\/api\/window/);

  const production = JSON.parse(fixture);
  const tauriOwners = [];
  for (const [path] of production.modules) {
    const source = await read(path);
    if (source.includes('@tauri-apps/api/window')) tauriOwners.push(path);
  }
  assert.deepEqual(tauriOwners, ['src/platform/desktop/window-client.js']);
});

test('Atomic 6.13 stale/destroy ownership remains local after Atomic 6.14 adds lifecycle validation', async () => {
  const [controller, close, controls, drag, state] = await Promise.all([
    read('src/features/window/window-controller.js'),
    read('src/features/window/window-close-controller.js'),
    read('src/features/window/window-controls-view.js'),
    read('src/features/window/window-drag-region.js'),
    read('src/features/window/window-state.js')
  ]);
  assert.match(controller, /stateRequestGeneration/);
  assert.match(controller, /lifecycleGeneration/);
  assert.match(controller, /resizeDisposer/);
  assert.match(controller, /dragRegion\.destroy\(\)/);
  assert.match(controller, /closeController\.destroy\(\)/);
  assert.match(controller, /controlsView\.destroy\(\)/);
  assert.match(controller, /state\.destroy\(\)/);
  assert.match(close, /operationGeneration/);
  assert.match(close, /subscriptionDisposer/);
  assert.match(controls, /removeEventListener\('click'/);
  assert.match(drag, /removeEventListener\('mousedown'/);
  assert.match(state, /listeners\.clear\(\)/);
  assert.equal(await exists('tests/architecture/stage-06-destroy-validation.test.mjs'), true);
  assert.doesNotMatch(controller, /lifecycle-resource-ledger|stage-06-destroy-validation/);
});
