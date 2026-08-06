import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Windows native window workflow is pinned, isolated and evidence-producing', async () => {
  const [workflow, runner, helper, installer, packageJson, tauriConfig] = await Promise.all([
    readFile('.github/workflows/stage-03-windows-window.yml', 'utf8'),
    readFile('tests/e2e/windows/run-window-automation.mjs', 'utf8'),
    readFile('tests/e2e/windows/native-window-system.mjs', 'utf8'),
    readFile('scripts/stage-03/windows/install-edge-driver.ps1', 'utf8'),
    readFile('package.json', 'utf8'),
    readFile('src-tauri/tauri.conf.json', 'utf8')
  ]);

  assert.match(workflow, /runs-on: windows-2025/);
  assert.match(workflow, /webdriverio@9\.30\.0/);
  assert.match(workflow, /tauri-driver --version 2\.0\.6 --locked/);
  assert.match(workflow, /--no-save --no-package-lock/);
  assert.match(workflow, /upload-artifact@v4/);

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

  assert.match(helper, /GetWindowPlacement/);
  assert.match(helper, /GetWindowRect/);
  assert.match(helper, /mouse_event/);
  assert.match(installer, /Microsoft\\EdgeWebView\\Application/);
  assert.match(installer, /msedgedriver\.microsoft\.com/);

  assert.doesNotMatch(packageJson, /webdriverio|tauri-driver/);
  assert.match(tauriConfig, /"withGlobalTauri": false/);
  assert.doesNotMatch(runner, /browser\.tauri|@wdio\/tauri-plugin/);
});
