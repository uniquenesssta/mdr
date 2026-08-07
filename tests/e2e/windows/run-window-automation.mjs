import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  getWindowSnapshot,
  restoreWindow,
  waitForProcessExit,
  waitForWindowSnapshot
} from './native-window-system.mjs';
import { withEmbeddedSession } from './embedded-webdriver-session.mjs';
import { createWindowEvidence } from './window-evidence.mjs';

const repositoryRoot = resolve(new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const binaryPath = resolve(
  process.env.MARKDOWN_EDITOR_BINARY || 'src-tauri/target/debug/markdown-editor.exe'
);
const artifactDirectory = resolve('artifacts/stage-03/windows-window');

function pause(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
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

async function withSession(label, port, run) {
  return withEmbeddedSession(
    {
      label,
      port,
      binaryPath,
      repositoryRoot,
      artifactDirectory,
      waitForNativeWindow: child => waitForWindowSnapshot(
        snapshot => snapshot.pid === child.pid && snapshot.handle !== 0,
        { timeoutMs: 30_000, intervalMs: 150 }
      )
    },
    async browser => {
      await waitForApplication(browser);
      return run(browser);
    }
  );
}

function movedEnough(before, after, threshold = 20) {
  return Math.abs(after.left - before.left) >= threshold
    || Math.abs(after.top - before.top) >= threshold;
}

const evidence = createWindowEvidence({
  metadata: {
    repositoryRoot,
    binaryPath,
    driverProvider: 'embedded',
    embeddedWebDriverPortRange: [4444, 4446],
    webdriverClient: 'selenium-webdriver@4.34.0',
    webdriverPlugin: 'tauri-plugin-wdio-webdriver@1'
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
          originalStartWindowDragging: null,
          dragCalls: 0,
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

      await browser.execute(() => {
        const state = window.__windowsNativeAutomation;
        const bridge = window.markdownEditorNative;
        state.originalStartWindowDragging = bridge.startWindowDragging;
        bridge.startWindowDragging = async (...args) => {
          state.dragCalls += 1;
          return state.originalStartWindowDragging.apply(bridge, args);
        };
      });

      const beforeDrag = getWindowSnapshot();
      await browser.dragFromViewportPoint({
        start: dragPoint,
        end: { x: dragPoint.x + 120, y: dragPoint.y + 80 },
        durationMs: 500
      });
      await browser.waitUntil(
        async () => (await browser.execute(() => window.__windowsNativeAutomation.dragCalls)) > 0,
        {
          timeout: 5_000,
          interval: 100,
          timeoutMsg: 'Title-bar pointer input did not reach the production drag handler.'
        }
      );
      const dragCalls = await browser.execute(() => window.__windowsNativeAutomation.dragCalls);
      assert.equal(dragCalls, 1);
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
        dragCalls,
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
