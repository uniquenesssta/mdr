import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Builder, By, Capabilities } from 'selenium-webdriver';
import { prepareWindowTestSurface } from './window-test-surface.mjs';
import { getWindowSnapshot, waitForWindowSnapshot } from './native-window-system.mjs';
import { runEmbeddedSession } from './embedded-session-lifecycle.mjs';

function pause(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

function assertApplicationRunning(process, logPath, stage) {
  if (process.exitCode === null && process.signalCode === null) return;
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

  const application = {
    child,
    logPath,
    isRunning: () => child.exitCode === null && child.signalCode === null,
    async stop() {
      try {
        if (child.pid && application.isRunning()) {
          // Register before kill so a quick native exit cannot be missed.
          const stopped = new Promise(resolvePromise => child.once('exit', resolvePromise));
          child.kill();
          await Promise.race([stopped, pause(5_000)]);
          if (application.isRunning()) throw new Error(`Native test host ${child.pid} did not exit; restart is blocked. See ${logPath}.`);
        }
      } finally {
        await new Promise((accept, reject) => {
          if (log.writableFinished) return accept();
          log.once('finish', accept);log.once('error', reject);log.end();
        });
      }
    }
  };
  await pause(250);
  if (startupError) { await application.stop();throw startupError; }
  return application;
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
      if (!isWindowStartupRace(error)) throw error;
      lastError = error;
    }

    await pause(150);
  }

  const error = new Error(
    `WebDriver session did not attach to a Tauri window. `
    + `Last error: ${lastError?.message || 'unknown error'}. See ${logPath}.`
  );
  error.code = 'EMBEDDED_WINDOW_STARTUP_TIMEOUT';
  throw error;
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

  const error = new Error(
    `Embedded WebDriver session was not created after the native window became available. `
    + `Last error: ${lastError?.message || 'unknown error'}. See ${logPath}.`
  );
  error.code = 'EMBEDDED_WINDOW_STARTUP_TIMEOUT';
  throw error;
}

async function createSession({ port, process, logPath }) {
  const driver = await buildDriver({ port, process, logPath });
  try {
    await waitForWindowHandle({ driver, process, logPath });
    await driver.manage().setTimeouts({implicit:0,pageLoad:30_000,script:30_000});
    const adapter = createBrowserAdapter(driver);
    return Object.freeze({...adapter,async deleteSession(){
      try {await adapter.deleteSession();}
      catch(error){
        // Close-button/force-close cases legitimately invalidate an exited host's session.
        if(process.exitCode===null&&process.signalCode===null)throw error;
      }
    }});
  } catch(error) {
    try {await driver.quit();}
    catch(cleanupError){throw new AggregateError([error,cleanupError],'Partial WebDriver session cleanup failed.');}
    throw error;
  }
}

export async function withEmbeddedSession(options, run) {
  return runEmbeddedSession({
    start:attempt=>startApplication({...options,label:attempt===1?options.label:`${options.label}-recovery`}),
    async connect(application) {
      await waitForEmbeddedServer({port:options.port,process:application.child,logPath:application.logPath});
      try {
        const snapshot = typeof options.waitForNativeWindow === 'function'
          ? await options.waitForNativeWindow(application.child)
          : await waitForWindowSnapshot(snapshot=>snapshot.pid===application.child.pid&&snapshot.handle!==0,{timeoutMs:30_000,intervalMs:150});
        await writeFile(`${application.logPath}.native-window.json`,JSON.stringify(snapshot??{customBarrierPassed:true},null,2));
      } catch(error) {
        assertApplicationRunning(application.child,application.logPath,'native window readiness');
        if(!/Timed out waiting for native window state/.test(error.message))throw error;
        error.code='EMBEDDED_WINDOW_STARTUP_TIMEOUT';throw error;
      }
      return createSession({port:options.port,process:application.child,logPath:application.logPath});
    },
    prepare:async browser=>await prepareWindowTestSurface(browser),
    isRecoverable:error=>error.code==='EMBEDDED_WINDOW_STARTUP_TIMEOUT',
    async recordFailure({attempt,stage,application,error,recover}) {
      let nativeWindow=null,nativeWindowError=null;
      try {nativeWindow=getWindowSnapshot();}catch(error){nativeWindowError=error.message;}
      await writeFile(resolve(options.artifactDirectory,`${options.label}-startup-${attempt}.json`),JSON.stringify({
        attempt,stage,recover,port:options.port,pid:application?.child.pid??null,
        exitCode:application?.child.exitCode??null,signalCode:application?.child.signalCode??null,
        applicationLog:application?.logPath??null,error:String(error.stack||error),nativeWindow,nativeWindowError
      },null,2));
    }
  },run);
}
