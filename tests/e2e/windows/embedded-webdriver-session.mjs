import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Builder, By, Capabilities } from 'selenium-webdriver';

function pause(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

function assertApplicationRunning(process, logPath, stage) {
  if (process.exitCode === null) return;
  throw new Error(
    `Markdown Editor exited during ${stage} (code ${process.exitCode}). See ${logPath}.`
  );
}

async function waitForEmbeddedServer({ port, process, logPath, timeout = 30_000 }) {
  const deadline = Date.now() + timeout;
  let lastError = null;

  while (Date.now() < deadline) {
    assertApplicationRunning(process, logPath, 'embedded WebDriver startup');

    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, {
        signal: AbortSignal.timeout(1_000)
      });
      if (response.ok) return;
      lastError = new Error(`Embedded WebDriver status returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await pause(150);
  }

  throw new Error(
    `Embedded WebDriver server did not become ready on port ${port}. `
    + `Last error: ${lastError?.message || 'unknown error'}. See ${logPath}.`
  );
}

async function startApplication({ binaryPath, repositoryRoot, artifactDirectory, label, port }) {
  const logPath = resolve(artifactDirectory, `${label}-application.log`);
  await mkdir(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: 'w' });
  const child = spawn(binaryPath, [], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      TAURI_WEBDRIVER_PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);

  let startupError = null;
  child.once('error', error => {
    startupError = error;
  });

  await pause(250);
  if (startupError) throw startupError;
  await waitForEmbeddedServer({ port, process: child, logPath });

  return {
    child,
    logPath,
    async stop() {
      if (child.exitCode === null && !child.killed) child.kill();
      if (child.exitCode === null) {
        await Promise.race([
          new Promise(resolvePromise => child.once('exit', resolvePromise)),
          pause(5_000)
        ]);
      }
      log.end();
    }
  };
}

function assertFinitePoint(name, point) {
  if (!point || typeof point !== 'object') {
    throw new TypeError(`${name} must be a point object.`);
  }
  for (const axis of ['x', 'y']) {
    if (!Number.isFinite(point[axis])) {
      throw new TypeError(`${name}.${axis} must be a finite number.`);
    }
  }
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
    async dragFromViewportPoint({ start, end, durationMs = 450 }) {
      assertFinitePoint('start', start);
      assertFinitePoint('end', end);
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new TypeError('durationMs must be a non-negative finite number.');
      }

      await driver.actions()
        .move({
          x: Math.round(start.x),
          y: Math.round(start.y),
          duration: 100
        })
        .press()
        .move({
          x: Math.round(end.x),
          y: Math.round(end.y),
          duration: Math.max(100, Math.round(durationMs))
        })
        .release()
        .perform();
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
      await import('node:fs/promises').then(({ writeFile }) => writeFile(path, screenshot, 'base64'));
    },
    deleteSession: () => driver.quit()
  });
}

async function waitForWindowHandle({ driver, process, logPath, timeout = 20_000 }) {
  const deadline = Date.now() + timeout;
  let lastError = null;

  while (Date.now() < deadline) {
    assertApplicationRunning(process, logPath, 'WebDriver window attachment');

    try {
      const handles = await driver.getAllWindowHandles();
      if (handles.length > 0) {
        await driver.switchTo().window(handles[0]);
        return handles[0];
      }
      lastError = new Error('WebDriver session returned no window handles.');
    } catch (error) {
      lastError = error;
    }

    await pause(150);
  }

  throw new Error(
    `WebDriver session did not attach to a Tauri window. `
    + `Last error: ${lastError?.message || 'unknown error'}. See ${logPath}.`
  );
}

function isWindowStartupRace(error) {
  return error?.name === 'NoSuchWindowError'
    || /no window could be found|no such window/i.test(String(error?.message || error));
}

async function buildDriver({ port, process, logPath, timeout = 20_000 }) {
  const deadline = Date.now() + timeout;
  let lastError = null;

  while (Date.now() < deadline) {
    assertApplicationRunning(process, logPath, 'WebDriver session creation');

    const capabilities = new Capabilities();
    capabilities.setBrowserName('tauri');

    try {
      return await new Builder()
        .usingServer(`http://127.0.0.1:${port}/`)
        .withCapabilities(capabilities)
        .build();
    } catch (error) {
      if (!isWindowStartupRace(error)) throw error;
      lastError = error;
      await pause(200);
    }
  }

  throw new Error(
    `Embedded WebDriver session was not created after the native window became available. `
    + `Last error: ${lastError?.message || 'unknown error'}. See ${logPath}.`
  );
}

async function createSession({ port, process, logPath }) {
  const driver = await buildDriver({ port, process, logPath });
  await waitForWindowHandle({ driver, process, logPath });
  await driver.manage().setTimeouts({
    implicit: 0,
    pageLoad: 30_000,
    script: 30_000
  });

  return createBrowserAdapter(driver);
}

async function closeSession(browser) {
  if (!browser) return;
  try {
    await browser.deleteSession();
  } catch (_) {
    // Native close and force-close tests intentionally invalidate the WebDriver session.
  }
}

export async function withEmbeddedSession(options, run) {
  const application = await startApplication(options);
  let browser = null;

  try {
    if (typeof options.waitForNativeWindow === 'function') {
      await options.waitForNativeWindow(application.child);
    }
    browser = await createSession({
      port: options.port,
      process: application.child,
      logPath: application.logPath
    });
    return await run(browser);
  } finally {
    await closeSession(browser);
    await application.stop();
  }
}
