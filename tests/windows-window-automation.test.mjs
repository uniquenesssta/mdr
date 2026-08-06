import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Windows native window workflow is pinned, isolated and evidence-producing', async () => {
  const [
    workflow,
    runner,
    sessionOwner,
    nativeHelper,
    packageJson,
    tauriConfig,
    cargoManifest,
    rustEntry,
    capability
  ] = await Promise.all([
    readFile('.github/workflows/stage-03-windows-window.yml', 'utf8'),
    readFile('tests/e2e/windows/run-window-automation.mjs', 'utf8'),
    readFile('tests/e2e/windows/embedded-webdriver-session.mjs', 'utf8'),
    readFile('tests/e2e/windows/native-window-system.mjs', 'utf8'),
    readFile('package.json', 'utf8'),
    readFile('src-tauri/tauri.conf.json', 'utf8'),
    readFile('src-tauri/Cargo.toml', 'utf8'),
    readFile('src-tauri/src/main.rs', 'utf8'),
    readFile('src-tauri/capabilities/default.json', 'utf8')
  ]);

  assert.match(workflow, /runs-on: windows-2025/);
  assert.match(workflow, /MARKDOWN_EDITOR_BINARY: src-tauri\/target\/debug\/markdown-editor\.exe/);
  assert.match(workflow, /cargo build --release --locked/);
  assert.match(workflow, /cargo build --locked --manifest-path src-tauri\/Cargo\.toml/);
  assert.match(workflow, /selenium-webdriver@4\.34\.0/);
  assert.match(workflow, /driverProvider = 'embedded'/);
  assert.match(workflow, /--no-save --no-package-lock/);
  assert.match(workflow, /upload-artifact@v4/);
  assert.doesNotMatch(workflow, /tauri-driver|MSEDGEDRIVER|install-edge-driver/);

  for (const contract of [
    'native-window-state-subscriptions-and-close-cancellation',
    'application-close-button-save-and-native-exit',
    'force-close-destroys-native-window',
    'onWindowResized',
    'resizeDisposer',
    'isWindowMaximized',
    'destroyWindow',
    'waitForProcessExit'
  ]) {
    assert.match(runner, new RegExp(contract));
  }

  assert.match(runner, /withEmbeddedSession/);
  assert.match(runner, /driverProvider: 'embedded'/);
  assert.doesNotMatch(runner, /Builder, By, Capabilities|tauri-driver|MSEDGEDRIVER_PATH/);

  assert.match(sessionOwner, /TAURI_WEBDRIVER_PORT/);
  assert.match(sessionOwner, /\/status/);
  assert.match(sessionOwner, /setBrowserName\('tauri'\)/);
  assert.match(sessionOwner, /Builder, By, Capabilities/);
  assert.doesNotMatch(sessionOwner, /tauri:options|--native-driver|node:net/);

  assert.match(nativeHelper, /GetWindowPlacement/);
  assert.match(nativeHelper, /GetWindowRect/);
  assert.match(nativeHelper, /mouse_event/);

  assert.match(cargoManifest, /\[target\.'cfg\(debug_assertions\)'\.dependencies\]/);
  assert.match(cargoManifest, /tauri-plugin-wdio-webdriver = "1"/);
  assert.match(rustEntry, /#\[cfg\(debug_assertions\)\]/);
  assert.match(rustEntry, /tauri_plugin_wdio_webdriver::init\(\)/);
  assert.match(capability, /"wdio-webdriver:default"/);

  assert.doesNotMatch(packageJson, /selenium-webdriver|webdriverio|tauri-driver/);
  assert.match(tauriConfig, /"withGlobalTauri": false/);
  assert.doesNotMatch(runner, /browser\.tauri|@wdio\/tauri-plugin/);
});
