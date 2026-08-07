import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  dragWindowFromViewport,
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
const TITLE_BAR_EXCLUDED_SELECTOR = '.menu-dropdown, .window-controls, button, input, select, textarea, a, [role="button"]';

function pause(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

async function waitForApplication(browser) {
  await browser.waitUntil(
    async () => browser.execute(() => Boolean(
      document.getElementById('compatibility-business-ports')?.markdownEditorPlatformPort?.supports('desktop.window')
      && document.getElementById('window-controls')
      && document.querySelector('.menu-bar')
    )),
    {
      timeout: 30_000,
      interval: 150,
      timeoutMsg: 'Markdown Editor Platform window port and window chrome were not ready.'
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

async function resolveTitleBarDragTarget(browser) {
  const target = await browser.execute(excludedSelector => {
    const bar = document.querySelector('.menu-bar');
    if (!bar) throw new Error('Menu bar was not found.');

    const describeElement = element => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        tagName: element.tagName,
        id: element.id || '',
        className: typeof element.className === 'string' ? element.className : '',
        pointerEvents: style.pointerEvents,
        position: style.position,
        zIndex: style.zIndex
      };
    };

    const regions = Array.from(bar.querySelectorAll('.window-drag-region'));
    const diagnostics = regions.map((region, regionIndex) => {
      const rect = region.getBoundingClientRect();
      return {
        regionIndex,
        tagName: region.tagName,
        className: typeof region.className === 'string' ? region.className : '',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        area: rect.width * rect.height,
        pointerEvents: getComputedStyle(region).pointerEvents
      };
    }).sort((left, right) => right.area - left.area);

    const hitDiagnostics = [];
    for (const entry of diagnostics) {
      if (entry.width < 4 || entry.height < 4) continue;
      const points = [
        { x: Math.round(entry.left + entry.width / 2), y: Math.round(entry.top + entry.height / 2) },
        { x: Math.round(entry.left + entry.width * 0.25), y: Math.round(entry.top + entry.height / 2) },
        { x: Math.round(entry.left + entry.width * 0.75), y: Math.round(entry.top + entry.height / 2) }
      ];

      for (const point of points) {
        const candidate = document.elementFromPoint(point.x, point.y);
        const stack = document.elementsFromPoint(point.x, point.y).slice(0, 8).map(describeElement);
        const belongsToBar = Boolean(candidate && (candidate === bar || bar.contains(candidate)));
        const excluded = Boolean(candidate?.closest(excludedSelector));
        hitDiagnostics.push({ regionIndex: entry.regionIndex, ...point, candidate: describeElement(candidate), stack });
        if (!belongsToBar || excluded) continue;
        return {
          ...point,
          regionIndex: entry.regionIndex,
          regionTagName: entry.tagName,
          regionClassName: entry.className,
          candidate: describeElement(candidate),
          hitStack: stack,
          regionRect: {
            left: entry.left,
            top: entry.top,
            width: entry.width,
            height: entry.height
          },
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
          diagnostics,
          hitDiagnostics
        };
      }
    }

    throw new Error(
      `No safe effective hit target was found inside a declared title-bar drag region: ${JSON.stringify({ diagnostics, hitDiagnostics })}`
    );
  }, TITLE_BAR_EXCLUDED_SELECTOR);

  const validation = await browser.execute((point, excludedSelector) => {
    const bar = document.querySelector('.menu-bar');
    const candidate = document.elementFromPoint(point.x, point.y);
    return {
      belongsToBar: Boolean(bar && candidate && (candidate === bar || bar.contains(candidate))),
      excluded: Boolean(candidate?.closest(excludedSelector)),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      tagName: candidate?.tagName || '',
      id: candidate?.id || '',
      className: typeof candidate?.className === 'string' ? candidate.className : ''
    };
  }, { x: target.x, y: target.y }, TITLE_BAR_EXCLUDED_SELECTOR);

  assert.equal(validation.belongsToBar, true, 'Resolved drag point must effectively hit .menu-bar or one of its descendants.');
  assert.equal(validation.excluded, false, 'Resolved drag point must not target an excluded control.');
  assert.equal(validation.viewportWidth, target.viewportWidth);
  assert.equal(validation.viewportHeight, target.viewportHeight);
  return { ...target, validation };
}

const evidence = createWindowEvidence({
  metadata: {
    repositoryRoot,
    binaryPath,
    driverProvider: 'embedded',
    embeddedWebDriverPortRange: [4444, 4446],
    webdriverClient: 'selenium-webdriver@4.34.0',
    webdriverPlugin: 'tauri-plugin-wdio-webdriver@1',
    nativeDragInput: 'SendInput + ClientToScreen'
  }
});

let finalStatus = 'failed';

try {
  await evidence.record('native-window-state-subscriptions-and-drag', async () => (
    withSession('state', 4444, async browser => {
      const controls = await browser.$('#window-controls');
      assert.equal(await controls.isDisplayed(), true);

      const initial = getWindowSnapshot();
      assert.equal(initial.showCmd, 1);

      const maximizeButton = await browser.$('#window-maximize-btn');
      await maximizeButton.click();
      await browser.waitUntil(
        () => browser.execute(() => document.getElementById('compatibility-business-ports').markdownEditorPlatformPort.call('window', 'isMaximized')),
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
        async () => !(await browser.execute(() => document.getElementById('compatibility-business-ports').markdownEditorPlatformPort.call('window', 'isMaximized'))),
        { timeout: 10_000, interval: 100, timeoutMsg: 'Window did not restore.' }
      );
      const restored = await waitForWindowSnapshot(snapshot => snapshot.showCmd === 1);

      await browser.execute(async () => {
        const state = window.__windowsNativeAutomation = {
          resizeEvents: 0,
          disposedResizeEvents: null,
          resizeDisposer: null,
          menuBarMouseDownEvents: 0
        };
        const port = document.getElementById('compatibility-business-ports').markdownEditorPlatformPort;
        state.resizeDisposer = await port.call('window', 'subscribeResize', () => {
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
        await browser.execute(() => Boolean(document.getElementById('compatibility-business-ports')?.markdownEditorPlatformPort?.supports('desktop.window'))),
        true
      );

      const dragTarget = await resolveTitleBarDragTarget(browser);

      await browser.execute(() => {
        const state = window.__windowsNativeAutomation;
        const bar = document.querySelector('.menu-bar');
        if (!bar) throw new Error('Menu bar was not found while installing drag instrumentation.');
        bar.addEventListener('mousedown', event => {
          if (event.buttons === 1) state.menuBarMouseDownEvents += 1;
        });
      });

      const beforeDrag = getWindowSnapshot();
      const nativeDragMapping = dragWindowFromViewport({
        startX: dragTarget.x,
        startY: dragTarget.y,
        endX: dragTarget.x + 120,
        endY: dragTarget.y + 80,
        viewportWidth: dragTarget.viewportWidth,
        viewportHeight: dragTarget.viewportHeight
      });
      await browser.waitUntil(
        async () => (await browser.execute(() => window.__windowsNativeAutomation.menuBarMouseDownEvents)) > 0,
        {
          timeout: 5_000,
          interval: 100,
          timeoutMsg: 'Native title-bar input did not dispatch mousedown inside .menu-bar.'
        }
      );
      const dragInput = await browser.execute(() => ({
        menuBarMouseDownEvents: window.__windowsNativeAutomation.menuBarMouseDownEvents
      }));
      assert.equal(dragInput.menuBarMouseDownEvents, 1);
      const afterDrag = await waitForWindowSnapshot(snapshot => movedEnough(beforeDrag, snapshot));
      assert.equal(movedEnough(beforeDrag, afterDrag), true);

      await browser.saveScreenshot(resolve(artifactDirectory, 'window-state.png'));

      return {
        initial,
        maximized,
        restored,
        subscribedResizeEvents,
        resizeAfterDispose,
        minimized,
        afterMinimizeRestore,
        dragTarget,
        beforeDrag,
        nativeDragMapping,
        dragInput,
        afterDrag
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
          await document.getElementById('compatibility-business-ports').markdownEditorPlatformPort.call('window', 'forceClose');
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
