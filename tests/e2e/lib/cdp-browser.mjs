import { accessSync, constants } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { readRemoteString } from './cdp-result-reader.mjs';

function cleanCandidate(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function executableExtensions(value, platform, environment) {
  if (platform !== 'win32' || extname(value)) return [''];
  const configured = String(environment.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map(item => item.trim())
    .filter(Boolean);
  return configured.length ? configured : ['.EXE'];
}

function canUseExecutable(path, platform) {
  try {
    accessSync(path, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutableCandidate(candidate, options = {}) {
  const platform = options.platform || process.platform;
  const environment = options.environment || process.env;
  const value = cleanCandidate(candidate);
  if (!value) return null;
  const extensions = executableExtensions(value, platform, environment);
  const directPath = isAbsolute(value) || value.includes('/') || value.includes('\\');
  if (directPath) {
    for (const extension of extensions) {
      const path = resolve(`${value}${extension}`);
      if (canUseExecutable(path, platform)) return path;
    }
    return null;
  }
  for (const directoryValue of String(environment.PATH || '').split(delimiter)) {
    const directory = cleanCandidate(directoryValue);
    if (!directory) continue;
    for (const extension of extensions) {
      const path = join(directory, `${value}${extension}`);
      if (canUseExecutable(path, platform)) return path;
    }
  }
  return null;
}

function executableCandidates(environment = process.env, platform = process.platform) {
  const candidates = [
    environment.CHROMIUM_PATH,
    environment.CHROME_PATH,
    'chromium',
    'chromium-browser',
    'google-chrome',
    'google-chrome-stable',
    'chrome'
  ].filter(Boolean);
  if (platform === 'win32') {
    const roots = [environment.PROGRAMFILES, environment['PROGRAMFILES(X86)'], environment.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      candidates.push(
        join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      );
    }
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  }
  return [...new Set(candidates)];
}

export function findChromiumExecutable(options = {}) {
  const platform = options.platform || process.platform;
  const environment = options.environment || process.env;
  for (const candidate of executableCandidates(environment, platform)) {
    const executable = resolveExecutableCandidate(candidate, { platform, environment });
    if (executable) return executable;
  }
  return null;
}

// Fetch's blocked service ports, matching Node's bundled Undici constants.
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080
]);

export function isFetchCompatiblePort(port) {
  return Number.isInteger(port) && port > 0 && port <= 65535 && !FETCH_BLOCKED_PORTS.has(port);
}

export async function getFreePort({ createServerImpl = createServer } = {}) {
  // Exclude blocked ports before launching a browser; ordinary ephemeral ports
  // below 10080 remain usable on hosts with a customized dynamic port range.
  for (let attempt = 0; attempt < 32; attempt++) {
    const server = createServerImpl();
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolvePromise);
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await new Promise((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
    if (isFetchCompatiblePort(port)) return port;
  }
  throw new Error('No Fetch-compatible ephemeral CDP port was allocated after 32 attempts.');
}

export async function waitForJson(url, timeoutMs = 10000, options = {}) {
  const deadline = Date.now() + timeoutMs;
  const fetchJson = options.fetch || fetch;
  const checkProcess = options.checkProcess || (() => {});
  let lastError = null;
  while (Date.now() < deadline) {
    checkProcess();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(1000, Math.max(1, deadline - Date.now())));
    try {
      const response = await fetchJson(url, { cache: 'no-store', signal: controller.signal });
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    checkProcess();
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise(resolvePromise => setTimeout(resolvePromise, Math.min(80, remaining)));
  }
  const cause = lastError?.cause;
  throw new Error(`CDP endpoint did not become ready: ${lastError?.message || url}`
    + `; endpoint=${url}; cause=${cause?.code || cause?.message || 'unavailable'}`,
    { cause: lastError });
}

export class CdpConnection {
  constructor(url, { commandTimeoutMs = 30000 } = {}) {
    this.commandTimeoutMs = commandTimeoutMs;
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener('open', resolvePromise, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => this.#handleMessage(event.data));
    this.socket.addEventListener('close', event => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error(`CDP connection closed (${event.code}: ${event.reason || 'no reason'})`));
      }
      this.pending.clear();
    });
    return this;
  }

  #handleMessage(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    if (!message.method) return;
    for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP connection is not open'));
    }
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + ': CDP response timed out'));
      }, this.commandTimeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, method, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  close() {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error('CDP connection closed'));
    }
    this.pending.clear();
    this.listeners.clear();
    this.socket?.close();
  }
}

export class CdpPage {
  constructor(connection) {
    this.connection = connection;
    this.consoleMessages = [];
    this.exceptions = [];
  }

  async initialize() {
    await Promise.all([
      this.connection.send('Page.enable'),
      this.connection.send('Runtime.enable'),
      this.connection.send('DOM.enable')
    ]);
    this.connection.on('Runtime.consoleAPICalled', event => {
      this.consoleMessages.push({
        type: event.type,
        values: (event.args || []).map(arg => arg.value ?? arg.description ?? '')
      });
    });
    this.connection.on('Runtime.exceptionThrown', event => {
      this.exceptions.push(event.exceptionDetails || event);
    });
    return this;
  }

  async addInitScript(source) {
    return this.connection.send('Page.addScriptToEvaluateOnNewDocument', { source: String(source || '') });
  }

  async setDocumentContent(html) {
    const { frameTree } = await this.connection.send('Page.getFrameTree');
    const frameId = frameTree?.frame?.id;
    if (!frameId) throw new Error('Unable to resolve the main frame');
    await this.connection.send('Page.setDocumentContent', { frameId, html: String(html || '') });
    await this.waitFor(() => document.readyState === 'complete', { timeoutMs: 5000, description: 'injected document ready' });
  }

  async navigate(url) {
    const result = await this.connection.send('Page.navigate', { url });
    if (result.errorText) throw new Error('Page navigation failed: ' + result.errorText + '; url=' + url);
    await this.waitFor(() => document.readyState === 'complete', { timeoutMs: 15000, description: 'document ready' });
  }

  async evaluate(expression, options = {}) {
    if (options.chunkedString) return this.readString(expression);
    const result = await this.connection.send('Runtime.evaluate', {
      expression: String(expression),
      awaitPromise: options.awaitPromise !== false,
      returnByValue: options.returnByValue !== false,
      userGesture: options.userGesture !== false
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Page evaluation failed');
    }
    return result.result?.value;
  }

  // Keep large Unicode responses below the transport frame boundary. The public
  // query runs once; slices read its immutable result, never changing app state.
  async readString(expression) {
    const result = await this.connection.send('Runtime.evaluate', {
      expression: `(async () => ({ value: await (${String(expression)}) }))()`,
      awaitPromise: true, returnByValue: false, userGesture: true
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return readRemoteString(this.connection, result.result?.objectId);
  }

  async waitFor(predicate, options = {}) {
    const timeoutMs = Math.max(100, Number(options.timeoutMs) || 5000);
    const intervalMs = Math.max(10, Number(options.intervalMs) || 40);
    const description = options.description || 'condition';
    const source = typeof predicate === 'function' ? `(${predicate.toString()})()` : String(predicate);
    const started = Date.now();
    let lastError = null;
    while (Date.now() - started < timeoutMs) {
      try {
        if (await this.evaluate(source)) return true;
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, intervalMs));
    }
    throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
  }

  async setViewport(options = {}) {
    const width = Math.round(Number(options.width));
    const height = Math.round(Number(options.height));
    const deviceScaleFactor = Number(options.deviceScaleFactor) || 1;
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new TypeError('Viewport width and height must be positive finite numbers');
    }
    await this.connection.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
      positionX: 0,
      positionY: 0
    });
    await this.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    return { width, height, deviceScaleFactor };
  }

  async elementRect(selector) {
    const encoded = JSON.stringify(selector);
    const rect = await this.evaluate(`(() => {
      const element = document.querySelector(${encoded});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
    if (!rect) throw new Error(`Element not found: ${selector}`);
    return rect;
  }

  async waitForElementStable(selector, options = {}) {
    const timeoutMs = Math.max(100, Number(options.timeoutMs) || 2500);
    const intervalMs = Math.max(10, Number(options.intervalMs) || 40);
    const stableSamples = Math.max(2, Math.round(Number(options.stableSamples) || 4));
    const toleranceValue = Number(options.tolerancePx);
    const tolerancePx = Number.isFinite(toleranceValue) ? Math.max(0, toleranceValue) : 0.25;
    const description = options.description || selector;
    const encoded = JSON.stringify(selector);
    const started = Date.now();
    let previous = null;
    let stableCount = 0;
    let lastRect = null;

    while (Date.now() - started < timeoutMs) {
      const rect = await this.elementRect(selector);
      lastRect = rect;
      const hittable = await this.evaluate(`(() => {
        const element = document.querySelector(${encoded});
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(hit && (hit === element || element.contains(hit)));
      })()`);
      const stable = Boolean(previous && hittable && ['x', 'y', 'width', 'height'].every(
        key => Math.abs(rect[key] - previous[key]) <= tolerancePx
      ));
      stableCount = stable ? stableCount + 1 : (hittable ? 1 : 0);
      if (stableCount >= stableSamples) return rect;
      previous = rect;
      await new Promise(resolvePromise => setTimeout(resolvePromise, intervalMs));
    }

    const detail = lastRect
      ? ` (${lastRect.x.toFixed(2)},${lastRect.y.toFixed(2)} ${lastRect.width.toFixed(2)}x${lastRect.height.toFixed(2)})`
      : '';
    throw new Error(`Timed out waiting for stable element geometry: ${description}${detail}`);
  }

  async click(selector, options = {}) {
    const rect = await this.waitForElementStable(selector, { stableSamples: 2, intervalMs: 20 });
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    await this.clickAt(point.x, point.y, options);
  }

  async clickAt(x, y, options = {}) {
    const count = Math.max(1, Number(options.count) || 1);
    const intervalMs = Math.max(20, Number(options.intervalMs) || 80);
    for (let index = 1; index <= count; index += 1) {
      await this.connection.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: index
      });
      await this.connection.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: index
      });
      if (index < count) await new Promise(resolvePromise => setTimeout(resolvePromise, intervalMs));
    }
  }

  async drag(start, end, options = {}) {
    const steps = Math.max(2, Number(options.steps) || 12);
    await this.connection.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: start.x, y: start.y, button: 'none', buttons: 0
    });
    await this.connection.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1
    });
    for (let index = 1; index <= steps; index += 1) {
      const progress = index / steps;
      await this.connection.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
        button: 'left',
        buttons: 1
      });
      await new Promise(resolvePromise => setTimeout(resolvePromise, Number(options.stepDelayMs) || 12));
    }
    await this.connection.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1
    });
  }

  async pressKey(key, options = {}) {
    const modifiers = Number(options.modifiers) || 0;
    const keys = { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Home: 36, End: 35, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, F2: 113, ',': 188 };
    const virtualKey = keys[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const event = { key, code: options.code || (key.length === 1 ? 'Key' + key.toUpperCase() : key), modifiers,
      windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey };
    await this.connection.send('Input.dispatchKeyEvent', { ...event, type: 'keyDown' });
    await this.connection.send('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
  }

  async insertText(text) {
    await this.connection.send('Input.insertText', { text: String(text) });
  }

  async fill(selector, value) {
    await this.click(selector);
    await this.pressKey('a', { modifiers: 2 });
    await this.pressKey('Backspace');
    if (String(value)) await this.insertText(value);
  }

  async selectOption(selector, value) {
    const encoded = JSON.stringify(selector), selected = String(value);
    const values = await this.evaluate(`Array.from(document.querySelector(${encoded})?.options || [])
      .filter(option => !option.disabled && !option.hidden).map(option => option.value)`);
    const index = values.indexOf(selected);
    if (index < 0) throw new Error('Selectable option not found: ' + selector);
    await this.click(selector);
    await this.pressKey('Home');
    for (let step = 0; step < index; step++) await this.pressKey('ArrowDown');
    await this.pressKey('Enter');
    const actual = await this.evaluate(`document.querySelector(${encoded})?.value`);
    if (actual !== selected) throw new Error('Keyboard option selection did not commit: ' + selector);
  }

  async screenshot(path) {
    const { data } = await this.connection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, Buffer.from(data, 'base64'));
  }
}

// taskkill can report a child-termination race even after every reported target exited.
// Accept that result only after probing every failed PID and the owned root; unknown errors fail.
export async function confirmTaskkillExit(error, rootPid, {
  isRunning = pid => { try { process.kill(pid, 0); return true; } catch (probeError) { if (probeError.code === 'ESRCH') return false; throw probeError; } },
  wait = () => new Promise(resolvePromise => setTimeout(resolvePromise, 50)), attempts = 20
} = {}) {
  const stderr = String(error?.stderr || '');
  // Each failure line names its target first, then may name a surviving parent
  // (including this Node runner). Parent context is not a failed termination target.
  const failedPids = stderr.split(/\r?\n/).map(line => line.match(/\bPID\s+(\d+)\b/i))
    .filter(Boolean).map(match => Number(match[1]));
  // Localized Windows reports an already-exited root as quoted digits without "PID".
  // Only recognize the observed status and owned root, then still probe every target.
  if (error?.status === 128 && stderr.includes('"' + rootPid + '"')) {
    failedPids.push(...[...stderr.matchAll(/"(\d+)"/g)].map(match => Number(match[1])));
  }
  if (!Number.isInteger(error?.status) || !failedPids.length) throw error;
  const targets = new Set([rootPid, ...failedPids]);
  for (let attempt = 0; attempt < attempts; attempt++) {
    await wait(); // Let child-process exit notifications catch up after execFileSync.
    if ([...targets].every(pid => !isRunning(pid))) return;
  }
  throw error;
}

async function stopChromium(processHandle) {
  // killed only means a signal was sent; it does not prove the process exited.
  const exited = () => processHandle.exitCode !== null || processHandle.signalCode !== null;
  try {
    if (!exited()) {
      if (process.platform === 'win32') {
        // Kill only this test-owned browser and its descendants, before the parent exits.
        try {
          execFileSync('taskkill', ['/PID', String(processHandle.pid), '/T', '/F'], {
            stdio: 'pipe', timeout: 10000, windowsHide: true
          });
        } catch (error) { await confirmTaskkillExit(error, processHandle.pid); }
      } else {
        processHandle.kill('SIGKILL');
      }
    }
    if (!exited()) await new Promise((resolvePromise, reject) => {
      const finish = () => { clearTimeout(timer); resolvePromise(); };
      const timer = setTimeout(() => {
        processHandle.removeListener('exit', finish);
        reject(new Error('Test browser did not exit after termination'));
      }, 5000);
      processHandle.once('exit', finish);
    });
  } finally {
    processHandle.stdout?.destroy();
    processHandle.stderr?.destroy();
    processHandle.unref();
  }
}

// Retry only a fully cleaned, refused CDP startup. Test bodies run after this returns.
export async function recoverChromiumStartup(launch, report = console.warn) {
  try {
    return await launch();
  } catch (firstError) {
    if (firstError.code !== 'CDP_STARTUP_REFUSED_CLEANED') throw firstError;
    report(`Chromium startup recovery (one fresh process): ${firstError.message}`);
    try {
      return await launch();
    } catch (secondError) {
      throw new AggregateError([firstError, secondError],
        `Both Chromium startup attempts failed. First: ${firstError.message}\nSecond: ${secondError.message}`);
    }
  }
}

export async function launchChromium(options = {}) {
  return recoverChromiumStartup(() => launchChromiumOnce(options));
}

async function launchChromiumOnce(options) {
  const executable = findChromiumExecutable();
  if (!executable) throw new Error('Chromium/Chrome was not found. Set CHROMIUM_PATH to its executable.');
  const port = await getFreePort();
  const profileDir = await mkdtemp(join(tmpdir(), 'markdown-editor-e2e-'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-features=Translate,MediaRouter',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    `--window-size=${options.width || 1280},${options.height || 900}`,
    'about:blank'
  ];
  const processHandle = spawn(executable, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: process.env.PATH?.split(delimiter).join(delimiter) }
  });
  let stderr = '';
  let stdout = '';
  let startupError = null;
  processHandle.once('error', error => { startupError = error; });
  processHandle.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-8000); });
  processHandle.stdout.on('data', chunk => { stdout = (stdout + String(chunk)).slice(-8000); });
  const checkProcess = () => {
    if (startupError) throw startupError;
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      throw new Error(`Chromium exited before CDP readiness: code=${processHandle.exitCode}; signal=${processHandle.signalCode}`);
    }
  };

  let endpointReady = false;
  try {
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, 30000, { checkProcess });
    endpointReady = true;
    const target = targets.find(item => item.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error('No page target was exposed by Chromium');
    const connection = await new CdpConnection(target.webSocketDebuggerUrl).open();
    const page = await new CdpPage(connection).initialize();
    return {
      executable,
      profileDirectory: profileDir,
      process: processHandle,
      page,
      async close() {
        // Ask the owned browser to exit before falling back to process termination.
        if (processHandle.exitCode === null && processHandle.signalCode === null) {
          await connection.send('Browser.close').catch(() => {});
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        connection.close();
        await stopChromium(processHandle);
        // Retain the owned profile; repository policy prohibits recursive deletion.
      },
      get stderr() { return stderr; }
    };
  } catch (error) {
    const refusedStartup = !endpointReady && !startupError
      && processHandle.exitCode === null && processHandle.signalCode === null
      && error.cause?.cause?.code === 'ECONNREFUSED';
    const diagnostics = JSON.stringify({ executable, args, pid: processHandle.pid,
      exitCode: processHandle.exitCode, signalCode: processHandle.signalCode,
      spawnError: startupError?.message, stdout, stderr });
    const cleanupErrors = [];
    try { await stopChromium(processHandle); } catch (cleanupError) { cleanupErrors.push(cleanupError.message); }
    // Failed-start profiles are retained as well, including their diagnostics.
    const failure = new Error(`${error.message}\nChromium startup: ${diagnostics}`
      + (cleanupErrors.length ? `\nCleanup: ${cleanupErrors.join('; ')}` : ''), { cause: error });
    if (refusedStartup && cleanupErrors.length === 0) failure.code = 'CDP_STARTUP_REFUSED_CLEANED';
    throw failure;
  }
}
