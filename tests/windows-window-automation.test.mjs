import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Windows native window workflow is pinned, isolated and evidence-producing', async () => {
  const [
    workflow,
    hostBuilder,
    runner,
    sessionOwner,
    nativeHelper,
    packageJson,
    tauriConfig,
    cargoManifest,
    cargoLock,
    rustEntry,
    capability
  ] = await Promise.all([
    readFile('.github/workflows/stage-03-windows-window.yml', 'utf8'),
    readFile('scripts/stage-03/windows/prepare-embedded-driver-host.ps1', 'utf8'),
    readFile('tests/e2e/windows/run-window-automation.mjs', 'utf8'),
    readFile('tests/e2e/windows/embedded-webdriver-session.mjs', 'utf8'),
    readFile('tests/e2e/windows/native-window-system.mjs', 'utf8'),
    readFile('package.json', 'utf8'),
    readFile('src-tauri/tauri.conf.json', 'utf8'),
    readFile('src-tauri/Cargo.toml', 'utf8'),
    readFile('src-tauri/Cargo.lock', 'utf8'),
    readFile('src-tauri/src/main.rs', 'utf8'),
    readFile('src-tauri/capabilities/default.json', 'utf8')
  ]);

  assert.match(workflow, /runs-on: windows-2025/);
  assert.match(
    workflow,
    /MARKDOWN_EDITOR_BINARY: \.windows-driver-host\/src-tauri\/target\/debug\/markdown-editor\.exe/
  );
  assert.match(workflow, /cargo build --release --locked --manifest-path src-tauri\/Cargo\.toml/);
  assert.match(workflow, /prepare-embedded-driver-host\.ps1/);
  assert.match(
    workflow,
    /cargo build --locked --manifest-path \.windows-driver-host\/src-tauri\/Cargo\.toml/
  );
  assert.match(workflow, /selenium-webdriver@4\.34\.0/);
  assert.match(workflow, /driverProvider = 'embedded-isolated-host'/);
  assert.match(workflow, /--no-save --no-package-lock/);
  assert.match(workflow, /upload-artifact@v4/);
  assert.match(
    workflow,
    /stage-03-windows-window-\$\{\{ github\.event\.pull_request\.head\.ref \|\| github\.ref_name \}\}-\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/
  );
  assert.doesNotMatch(workflow, /contents: write|INTERNAL CONCURRENCY REPAIR/);
  assert.doesNotMatch(workflow, /tauri-driver|MSEDGEDRIVER|install-edge-driver/);

  assert.match(hostBuilder, /git -C \$repositoryRoot archive/);
  assert.match(hostBuilder, /Copy-Item.+dist/s);
  assert.match(hostBuilder, /tauri-plugin-wdio-webdriver/);
  assert.match(hostBuilder, /tauri_plugin_wdio_webdriver::init\(\)/);
  assert.match(hostBuilder, /wdio-webdriver:default/);
  assert.match(hostBuilder, /cargo generate-lockfile/);
  assert.match(hostBuilder, /Production Cargo\.toml already contains/);
  assert.match(hostBuilder, /Production capability already exposes/);
  assert.match(hostBuilder, /Properties\.Remove\('devUrl'\)/);
  assert.match(hostBuilder, /Properties\.Remove\('beforeDevCommand'\)/);
  assert.match(hostBuilder, /frontendSource = 'embedded-dist'/);
  assert.match(hostBuilder, /productionConfigUnchanged = \$true/);

  for (const contract of [
    'native-window-state-subscriptions-and-close-cancellation',
    'application-close-button-save-and-native-exit',
    'force-close-destroys-native-window',
    'onWindowResized',
    'resizeDisposer',
    'isWindowMaximized',
    'destroyWindow',
    'waitForProcessExit',
    'waitForNativeWindow',
    'snapshot.pid === child.pid',
    'dragFromViewportPoint',
    'dragCalls'
  ]) {
    assert.match(runner, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(runner, /withEmbeddedSession/);
  assert.match(runner, /driverProvider: 'embedded'/);
  assert.doesNotMatch(runner, /dragWindow|Builder, By, Capabilities|tauri-driver|MSEDGEDRIVER_PATH/);

  assert.match(sessionOwner, /TAURI_WEBDRIVER_PORT/);
  assert.match(sessionOwner, /\/status/);
  assert.match(sessionOwner, /setBrowserName\('tauri'\)/);
  assert.match(sessionOwner, /Builder, By, Capabilities/);
  assert.match(sessionOwner, /getAllWindowHandles\(\)/);
  assert.match(sessionOwner, /switchTo\(\)\.window/);
  assert.match(sessionOwner, /isWindowStartupRace/);
  assert.match(sessionOwner, /assertApplicationRunning/);
  assert.match(sessionOwner, /dragFromViewportPoint/);
  assert.match(sessionOwner, /driver\.actions\(\)/);
  assert.match(sessionOwner, /\.press\(\)/);
  assert.match(sessionOwner, /\.release\(\)/);
  assert.doesNotMatch(sessionOwner, /tauri:options|--native-driver|node:net/);

  assert.match(nativeHelper, /GetWindowPlacement/);
  assert.match(nativeHelper, /GetWindowRect/);
  assert.match(nativeHelper, /EnumWindows/);
  assert.match(nativeHelper, /GetWindowThreadProcessId/);
  assert.match(nativeHelper, /IsWindowVisible/);
  assert.match(nativeHelper, /FindMainWindow/);
  assert.match(nativeHelper, /Markdown Editor/);
  assert.doesNotMatch(nativeHelper, /MainWindowHandle|SetCursorPos|mouse_event|dragWindow/);

  assert.doesNotMatch(cargoManifest, /tauri-plugin-wdio-webdriver/);
  assert.doesNotMatch(cargoLock, /tauri-plugin-wdio-webdriver/);
  assert.doesNotMatch(rustEntry, /tauri_plugin_wdio_webdriver/);
  assert.doesNotMatch(capability, /wdio-webdriver:default/);
  assert.doesNotMatch(packageJson, /selenium-webdriver|webdriverio|tauri-driver/);
  assert.match(tauriConfig, /"withGlobalTauri": false/);
  assert.match(tauriConfig, /"devUrl": "http:\/\/127\.0\.0\.1:16663"/);
  assert.match(tauriConfig, /"beforeDevCommand": "npm run dev"/);
  assert.doesNotMatch(runner, /browser\.tauri|@wdio\/tauri-plugin/);
});
