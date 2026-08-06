import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Builder, By, Capabilities } from 'selenium-webdriver';
import {
  dragWindow,
  getWindowSnapshot,
  restoreWindow,
  waitForProcessExit,
  waitForWindowSnapshot
} from './native-window-system.mjs';
import { createWindowEvidence } from './window-evidence.mjs';

const repositoryRoot = resolve(new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const binaryPath = resolve(
  process.env.MARKDOWN_EDITOR_BINARY || 'src-tauri/target/release/markdown-editor.exe'
);
const artifactDirectory = resolve('artifacts/stage-03/windows-window');
const tauriDriverPath = resolve(
  process.env.TAURI_DRIVER_PATH || `${homedir()}/.cargo/bin/tauri-driver.exe`
);
const edgeDriverPath = process.env.MSEDGEDRIVER_PATH;

function pause(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

async function startDriver(label, port) {
  if (!edgeDriverPath) {
    throw new Error('MSEDGEDRIVER_PATH is required for deterministic Windows automation.');
  }

  const logPath = resolve(artifactDirectory, `${label}-tauri-driver.log`);
  await mkdir(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: 'w' });
  const child = spawn(
    tauriDriverPath,
    ['--port', String(port), '--native-driver', edgeDriverPath],
    {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false
    }
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);

  let startupError = null;
  let startupExitCode = null;
  child.once('error', error => {
    startupError = error;
  });
  child.once('exit', code => {
    startupExitCode = code;
  });

  await pause(750);
  if (startupError) throw startupError;
  if (startupExitCode !== null) {
    throw new Error(`tauri-driver exited during startup with code ${startupExitCode}.`);
  }

  return {
    child,
    logPath,
    async stop() {
      if (!child.killed) child.kill();
      await Promise.race([
        new Promise(resolvePromise => child.once('exit', resolvePromise)),
        pause(5_000)
      ]);
      log.end();
    }
  };
}

function createBrowserAdapter(driver) {
  return Object.freeze({
    async $(selector) {
      const element = await driver.findElement(By.css(selector));
      return Object.freeze({
        click: () => element.click(),
        isDisplayed: () => element.isDisplayed()
      });
    },
    async execute(script, ...args) {
      const result = await driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        const values = Array.prototype.slice.call(arguments, 0, -1);
        Promise.resolve((${script.toString()})(...values)).then(
          value => done({ ok: true, value }),
          error => done({ ok: false, error: String(error?.stack || error) })
        );
      `, ...args);

      if (!result?.ok) {
        throw new Error(result?.error || 'Browser script execution failed without an error message.');
      }
      return result.value;
    },
    async waitUntil(predicate, options = {}) {
      const timeout = options.timeout ?? 10_000;
      const interval = options.interval ?? 100;
      const deadline = Date.now() + timeout;
      let lastError = null;

      while (Date.now() < deadline) {
        try {
          if (await predicate()) return;
        } catch (error) {
          lastError = error;
        }
        await pause(interval);
      }

      throw new Error(
        `${options.timeoutMsg || 'Condition was not met before timeout.'}${
          lastError ? ` Last error: ${lastError.message}` : ''
        }`
      );
    },
    async getWindowSize() {
      const rect = await driver.manage().window().getRect();
      return { width: rect.width, height: rect.height };
    },
    async setWindowSize(width, height) {
      await driver.manage().window().setRect({ width, height });
    },
    async saveScreenshot(path) {
      const screenshot = await driver.takeScreenshot();
      await writeFile(path, screenshot, 'base64');
    },
    deleteSession: () => driver.quit()
  });
}

async function createSession(port) {
  const capabilities = new Capabilities();
  capabilities.setBrowserName('wry');
  capabilities.set('tauri:options', { application: binaryPath });

  const driver = await new Builder()
    .usingServer(`http://127.0.0.1:${port}/`)
    .withCapabilities(capabilities)
    .build();

  await driver.manage().setTimeouts({
    implicit: 0,
    pageLoad: 30_000,
    script: 30_000
  });

  return createBrowserAdapter(driver);
}

async function waitForApplication(browser) {
  await browser.waitUntil(
    async () => browser.execute(() => Boolean(
      window.markdownEditorNative?.isAvailable
      && document.getElementById('window-controls')
      && document.querySelector('.menu-bar')
    )),
    {
      timeout: 30_000,
      interval: 150,
      timeoutMsg: 'Markdown Editor native bridge and window chrome were not ready.'
    }
  );
}

async function closeSession(browser) {
  if (!browser) return;
  try {
    await browser.deleteSession();
  } catch (_) {
    // Native close and force-close tests intentionally invalidate the WebDriver session.
  }
}

async function withSession(label, port, run) {
  const driver = await startDriver(label, port);
  let browser = null;

  try {
    browser = await createSession(port);
    await waitForApplication(browser);
    return await run(browser);
  } finally {
    await closeSession(browser);
    await driver.stop();
  }
}

function movedEnough(before, after, threshold = 20) {
  return Math.abs(after.left - before.left) >= threshold
    || Math.abs(after.top - before.top) >= threshold;
}

const evidence = createWindowEvidence({
  metadata: {
    repositoryRoot,
    binaryPath,
    tauriDriverPath,
    edgeDriverPath,
    edgeDriverVersion: process.env.MSEDGEDRIVER_VERSION || null,
    webdriverClient: 'selenium-webdriver@4.34.0'
  }
});

let finalStatus = 'failed';

try {
  await evidence.record('native-window-state-subscriptions-and-close-cancellation', async () => (
    withSession('state', 4444, async browser => {
      const controls = await browser.$('#window-controls');
      assert.equal(await controls.isDisplayed(), true);

      const initial = getWindowSnapshot();
      assert.equal(initial.showCmd, 1);

      const maximizeButton = await browser.$('#window-maximize-btn');
      await maximizeButton.click();
      await browser.waitUntil(
        () => browser.execute(() => window.markdownEditorNative.isWindowMaximized()),
        { timeout: 10_000, interval: 100, timeoutMsg: 'Window did not maximize.' }
      );
      const maximized = await waitForWindowSnapshot(snapshot => snapshot.showCmd === 3);
      const maximizedChrome = await browser.execute(() => ({
        dataset: document.getElementById('window-maximize-btn')?.dataset.maximized,
        classApplied: document.documentElement.classList.contains('window-maximized')
      }));
      assert.deepEqual(maximizedChrome, { dataset: 'true', classApplied: true });

      await maximizeButton.click();
      await browser.waitUntil(
        async () => !(await browser.execute(() => window.markdownEditorNative.isWindowMaximized())),
        { timeout: 10_000, interval: 100, timeoutMsg: 'Window did not restore.' }
      );
      const restored = await waitForWindowSnapshot(snapshot => snapshot.showCmd === 1);

      await browser.execute(async () => {
        const state = window.__windowsNativeAutomation = {
          resizeEvents: 0,
          disposedResizeEvents: null,
          resizeDisposer: null,
          originalCloseWindow: null,
          closeCommitCalls: 0
        };
        state.resizeDisposer = await window.markdownEditorNative.onWindowResized(() => {
          state.resizeEvents += 1;
        });
      });

      const originalSize = await browser.getWindowSize();
      const firstSize = {
        width: Math.max(760, originalSize.width - 120),
        height: Math.max(620, originalSize.height - 80)
      };
      await browser.setWindowSize(firstSize.width, firstSize.height);
      await browser.waitUntil(
        async () => (await browser.execute(() => window.__windowsNativeAutomation.resizeEvents)) > 0,
        { timeout: 10_000, interval: 100, timeoutMsg: 'Native resize subscription did not fire.' }
      );

      const subscribedResizeEvents = await browser.execute(
        () => window.__windowsNativeAutomation.resizeEvents
      );
      await browser.execute(async () => {
        const state = window.__windowsNativeAutomation;
        await state.resizeDisposer();
        await state.resizeDisposer();
        state.disposedResizeEvents = state.resizeEvents;
      });

      await browser.setWindowSize(firstSize.width + 60, firstSize.height + 40);
      await pause(800);
      const resizeAfterDispose = await browser.execute(() => ({
        count: window.__windowsNativeAutomation.resizeEvents,
        disposedAt: window.__windowsNativeAutomation.disposedResizeEvents
      }));
      assert.equal(resizeAfterDispose.count, resizeAfterDispose.disposedAt);

      const minimizeButton = await browser.$('#window-minimize-btn');
      await minimizeButton.click();
      const minimized = await waitForWindowSnapshot(snapshot => snapshot.showCmd === 2);
      restoreWindow();
      const afterMinimizeRestore = await waitForWindowSnapshot(snapshot => snapshot.showCmd === 1);
      assert.equal(
        await browser.execute(() => Boolean(window.markdownEditorNative?.isAvailable)),
        true
      );

      const dragPoint = await browser.execute(() => {
        const bar = document.querySelector('.menu-bar');
        if (!bar) throw new Error('Menu bar was not found.');
        const rect = bar.getBoundingClientRect();
        const excluded = '.menu-dropdown, .window-controls, button, input, select, textarea, a, [role="button"]';
        const y = Math.round(rect.top + rect.height / 2);

        for (let x = Math.round(rect.right - 180); x >= Math.round(rect.left + 180); x -= 20) {
          const target = document.elementFromPoint(x, y);
          if (target && !target.closest(excluded)) return { x, y };
        }
        throw new Error('No safe title-bar drag point was found.');
      });

      const beforeDrag = getWindowSnapshot();
      dragWindow({
        startX: beforeDrag.left + dragPoint.x,
        startY: beforeDrag.top + dragPoint.y,
        endX: beforeDrag.left + dragPoint.x + 120,
        endY: beforeDrag.top + dragPoint.y + 80
      });
      const afterDrag = await waitForWindowSnapshot(snapshot => movedEnough(beforeDrag, snapshot));
      assert.equal(movedEnough(beforeDrag, afterDrag), true);

      await browser.saveScreenshot(resolve(artifactDirectory, 'window-state.png'));

      await browser.execute(async () => {
        const state = window.__windowsNativeAutomation;
        const bridge = window.markdownEditorNative;
        state.originalCloseWindow = bridge.closeWindow;
        bridge.closeWindow = async () => {
          state.closeCommitCalls += 1;
        };
        await state.originalCloseWindow();
      });

      await browser.waitUntil(
        async () => (await browser.execute(() => window.__windowsNativeAutomation.closeCommitCalls)) === 1,
        {
          timeout: 15_000,
          interval: 150,
          timeoutMsg: 'Application close-request policy did not prevent and commit the native close.'
        }
      );
      const preventedClose = {
        process: getWindowSnapshot(),
        bridge: await browser.execute(() => ({
          closeCommitCalls: window.__windowsNativeAutomation.closeCommitCalls,
          isAvailable: window.markdownEditorNative.isAvailable
        }))
      };
      assert.equal(preventedClose.bridge.closeCommitCalls, 1);

      try {
        await browser.execute(async () => {
          await window.__windowsNativeAutomation.originalCloseWindow();
        });
      } catch (_) {
        // The successful close can terminate the WebDriver command before it returns.
      }
      assert.equal(await waitForProcessExit(), true);

      return {
        initial,
        maximized,
        restored,
        subscribedResizeEvents,
        resizeAfterDispose,
        minimized,
        afterMinimizeRestore,
        beforeDrag,
        afterDrag,
        preventedClose
      };
    })
  ));

  await evidence.record('application-close-button-save-and-native-exit', async () => (
    withSession('normal-close', 4445, async browser => {
      const beforeClose = getWindowSnapshot();
      try {
        await (await browser.$('#window-close-btn')).click();
      } catch (_) {
        // A completed native close can invalidate the click response.
      }
      const exited = await waitForProcessExit();
      assert.equal(exited, true);
      return { beforeClose, exited };
    })
  ));

  await evidence.record('force-close-destroys-native-window', async () => (
    withSession('force-close', 4446, async browser => {
      const beforeClose = getWindowSnapshot();
      try {
        await browser.execute(async () => {
          await window.markdownEditorNative.destroyWindow();
        });
      } catch (_) {
        // destroy() intentionally removes the WebView before the command can respond.
      }
      const exited = await waitForProcessExit();
      assert.equal(exited, true);
      return { beforeClose, exited };
    })
  ));

  finalStatus = 'passed';
} finally {
  await evidence.complete(finalStatus);
}

console.log(`Windows native window automation ${finalStatus}.`);
