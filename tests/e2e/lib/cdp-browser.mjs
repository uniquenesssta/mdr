import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

function executableCandidates() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.CHROME_PATH,
    'chromium',
    'chromium-browser',
    'google-chrome',
    'google-chrome-stable',
    'chrome'
  ].filter(Boolean);
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      candidates.push(
        join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      );
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  }
  return [...new Set(candidates)];
}

export function findChromiumExecutable() {
  for (const candidate of executableCandidates()) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForJson(url, timeoutMs = 10000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`CDP endpoint did not become ready: ${lastError?.message || url}`);
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => this.#handleMessage(event.data));
    this.socket.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP connection closed'));
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  close() {
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
    await this.connection.send('Page.navigate', { url });
    await this.waitFor(() => document.readyState === 'complete', { timeoutMs: 15000, description: 'document ready' });
  }

  async evaluate(expression, options = {}) {
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
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
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

  async elementCenter(selector) {
    const rect = await this.elementRect(selector);
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }

  async click(selector, options = {}) {
    const point = await this.elementCenter(selector);
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
      if (index < count) await new Promise(resolve => setTimeout(resolve, intervalMs));
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
      await new Promise(resolve => setTimeout(resolve, Number(options.stepDelayMs) || 12));
    }
    await this.connection.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1
    });
  }

  async pressKey(key, options = {}) {
    const modifiers = Number(options.modifiers) || 0;
    await this.connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: options.code || key, modifiers });
    await this.connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: options.code || key, modifiers });
  }

  async screenshot(path) {
    const { data } = await this.connection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, Buffer.from(data, 'base64'));
  }
}

async function removeProfileDirectory(path, attempts = 8) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code) || attempt >= attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
  if (lastError) throw lastError;
}

export async function launchChromium(options = {}) {
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
  processHandle.stderr.on('data', chunk => { stderr += String(chunk); });
  processHandle.stdout.on('data', () => {});

  try {
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, 12000);
    const target = targets.find(item => item.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error('No page target was exposed by Chromium');
    const connection = await new CdpConnection(target.webSocketDebuggerUrl).open();
    const page = await new CdpPage(connection).initialize();
    return {
      executable,
      process: processHandle,
      page,
      async close() {
        connection.close();
        if (!processHandle.killed) processHandle.kill('SIGTERM');
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 1500);
          processHandle.once('exit', () => { clearTimeout(timer); resolve(); });
        });
        if (!processHandle.killed) processHandle.kill('SIGKILL');
        await removeProfileDirectory(profileDir);
      },
      get stderr() { return stderr; }
    };
  } catch (error) {
    if (!processHandle.killed) processHandle.kill('SIGKILL');
    await removeProfileDirectory(profileDir);
    throw new Error(`${error.message}${stderr ? `\nChromium: ${stderr.slice(-1200)}` : ''}`);
  }
}
