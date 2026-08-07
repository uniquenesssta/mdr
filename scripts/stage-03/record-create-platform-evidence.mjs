import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  PLATFORM_PORT_NAMES,
  PlatformCapabilityUnavailableError,
  createPlatform
} from '../../src/platform/index.js';

const OUTPUT_DIRECTORY = 'artifacts/stage-03';
const MODULE_FIXTURE_PATH = 'tests/architecture/fixtures/production-modules.json';

class EvidenceFileReader {
  constructor() {
    this.result = null;
    this.error = null;
    this.onload = null;
    this.onerror = null;
    this.onabort = null;
  }

  readAsText(file) {
    this.result = `text:${file.name}`;
    this.onload?.();
  }

  readAsDataURL(file) {
    this.result = `data:${file.name}`;
    this.onload?.();
  }
}

function createBrowserRuntime() {
  const log = [];
  const values = new Map();
  const listeners = new Map();
  class Element {}

  const runtime = {
    Blob,
    Element,
    FileReader: EvidenceFileReader,
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); },
      clear() { values.clear(); }
    },
    URL: {
      createObjectURL() { log.push('object-url:create'); return 'blob:evidence'; },
      revokeObjectURL(url) { log.push(['object-url:revoke', url]); }
    },
    navigator: {
      clipboard: {
        async writeText(value) { log.push(['clipboard', value]); }
      }
    },
    document: null,
    async fetch(url) {
      log.push(['fetch', url]);
      return { ok: true, async text() { return `fetched:${url}`; } };
    },
    open(url, target, features) {
      log.push(['open', url, target, features]);
      return {};
    },
    print() { log.push('print'); return 'printed'; },
    confirm(message) { log.push(['confirm', message]); return true; }
  };

  Element.prototype.requestFullscreen = async function () {
    runtime.document.fullscreenElement = this;
    log.push('fullscreen:enter');
  };

  const body = {
    appendChild(node) { node.parentNode = body; log.push(['append', node.download]); },
    removeChild(node) { node.parentNode = null; log.push(['remove', node.download]); }
  };
  runtime.document = {
    body,
    documentElement: new Element(),
    fullscreenEnabled: true,
    fullscreenElement: null,
    createElement(tag) {
      if (tag === 'a') {
        return {
          href: '',
          download: '',
          parentNode: null,
          click() { log.push(['download', this.href, this.download]); },
          remove() { if (this.parentNode) body.removeChild(this); }
        };
      }
      return {
        value: '', style: {}, parentNode: null,
        setAttribute() {}, select() {}, setSelectionRange() {}, remove() {}
      };
    },
    execCommand() { return true; },
    async exitFullscreen() {
      runtime.document.fullscreenElement = null;
      log.push('fullscreen:exit');
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); }
  };

  return { runtime, log, listeners };
}

function createDesktopImplementations(log) {
  return Object.freeze({
    files: {
      async readText(path) { log.push(['desktop.files.readText', path]); return 'desktop-text'; },
      async writeText() {}, async writeBinary() {}, async listTextTree() { return {}; },
      async readImage() { return 'data:desktop'; }, async getInitialPath() { return 'desktop.md'; }
    },
    dialogs: {
      async openFile() { return 'desktop.md'; }, async openDirectory() { return '/desktop'; },
      async saveFile() { return 'save.md'; }, async confirm() { return true; }
    },
    window: {
      async startDrag() {}, async minimize() {}, async toggleMaximize() { return true; },
      async isMaximized() { return true; }, async subscribeResize() { return () => {}; },
      async subscribeCloseRequest() { return () => {}; }, async requestClose() {}, async forceClose() {}
    },
    dragDrop: { async subscribe() { return () => {}; } },
    documentStore: {
      async save(request) { return request; }, async beginSnapshotUpload() {}, async appendSnapshotChunk() {},
      async commitSnapshotUpload(request) { return request; }, async abortSnapshotUpload() {},
      async load() { return null; }, async loadManifest() { return null; }, async readChunk() { return null; },
      async search() { return null; }, async remove() {}
    },
    web: { async fetchText(url) { log.push(['desktop.web.fetchText', url]); return 'desktop-web'; } },
    links: { async openExternal(url) { log.push(['desktop.links.openExternal', url]); } },
    logs: { async writePerformance(entries) { log.push(['desktop.logs.writePerformance', entries]); return 'log-path'; } }
  });
}

function captureUnsupported(callback) {
  try {
    callback();
    return null;
  } catch (error) {
    if (!(error instanceof PlatformCapabilityUnavailableError)) throw error;
    return Object.freeze({
      name: error.name,
      code: error.code,
      port: error.port,
      method: error.method,
      capability: error.capability
    });
  }
}

const moduleFixture = JSON.parse(await readFile(MODULE_FIXTURE_PATH, 'utf8'));
const platformModules = moduleFixture.modules
  .map(record => record[0])
  .filter(path => String(path).startsWith('src/platform/'))
  .sort();
const createPlatformSource = await readFile('src/platform/create-platform.js', 'utf8');
const desktopPlatformSource = await readFile('src/platform/desktop/desktop-platform.js', 'utf8');
const mainSource = await readFile('src/main.js', 'utf8');
const classicBridgeSource = await readFile('src/platform/compatibility/classic-platform-port.js', 'utf8');

const browserSurface = createBrowserRuntime();
const browserPlatform = createPlatform({ runtime: browserSurface.runtime });
browserPlatform.storage.set('theme', 'dark');
const browserText = await browserPlatform.files.readText({ name: 'evidence.md' });
const browserImage = await browserPlatform.files.readImage({ name: 'evidence.png' });
const browserWeb = await browserPlatform.web.fetchText('https://example.com');
await browserPlatform.clipboard.writeText('evidence');
const browserFullscreenStates = [];
const disposeFullscreen = browserPlatform.fullscreen.subscribe(active => browserFullscreenStates.push(active));
await browserPlatform.fullscreen.enter();
browserSurface.listeners.get('fullscreenchange')();
await browserPlatform.fullscreen.exit();
browserSurface.listeners.get('webkitfullscreenchange')();
await disposeFullscreen();
const browserPrint = browserPlatform.print.print();
const unsupportedWindow = captureUnsupported(() => browserPlatform.window.minimize());
const unsupportedTree = captureUnsupported(() => browserPlatform.files.listTextTree());

const missingPlatform = createPlatform({ runtime: {} });
const unsupportedStorage = captureUnsupported(() => missingPlatform.storage.get('theme'));
const unsupportedFetch = captureUnsupported(() => missingPlatform.web.fetchText('https://example.com'));

const desktopSurface = createBrowserRuntime();
desktopSurface.runtime.__TAURI_INTERNALS__ = {};
const desktopLog = [];
const desktopPlatform = createPlatform({
  runtime: desktopSurface.runtime,
  desktopPlatform: createDesktopImplementations(desktopLog)
});
const desktopText = await desktopPlatform.files.readText('native.md');
const desktopWeb = await desktopPlatform.web.fetchText('https://desktop.example');
await desktopPlatform.clipboard.writeText('browser-webview-clipboard');

if (moduleFixture.modules.length !== 174 || platformModules.length !== 36) process.exit(1);
if (!platformModules.includes('src/platform/create-platform.js')) process.exit(1);
if (!platformModules.includes('src/platform/desktop/desktop-platform.js')) process.exit(1);
if (JSON.stringify(Object.keys(browserPlatform)) !== JSON.stringify(['capabilities', ...PLATFORM_PORT_NAMES, 'destroy'])) process.exit(1);
if (!Object.isFrozen(browserPlatform) || !Object.isFrozen(browserPlatform.capabilities)) process.exit(1);
if (browserPlatform.capabilities.runtime !== 'browser') process.exit(1);
if (browserText !== 'text:evidence.md' || browserImage !== 'data:evidence.png') process.exit(1);
if (browserWeb !== 'fetched:https://example.com' || browserPrint !== 'printed') process.exit(1);
if (browserFullscreenStates.join(',') !== 'true,false') process.exit(1);
if (unsupportedWindow?.code !== 'PLATFORM_CAPABILITY_UNAVAILABLE' || unsupportedWindow.capability !== 'desktop.window') process.exit(1);
if (unsupportedTree?.code !== 'PLATFORM_CAPABILITY_UNAVAILABLE' || unsupportedTree.method !== 'listTextTree') process.exit(1);
if (unsupportedStorage?.code !== 'PLATFORM_CAPABILITY_UNAVAILABLE' || unsupportedStorage.capability !== 'browser.storage') process.exit(1);
if (unsupportedFetch?.code !== 'PLATFORM_CAPABILITY_UNAVAILABLE' || unsupportedFetch.capability !== 'browser.webFetch') process.exit(1);
if (desktopPlatform.capabilities.runtime !== 'desktop') process.exit(1);
if (desktopText !== 'desktop-text' || desktopWeb !== 'desktop-web') process.exit(1);
if (!desktopLog.some(entry => entry[0] === 'desktop.files.readText')) process.exit(1);
if (!desktopLog.some(entry => entry[0] === 'desktop.web.fetchText')) process.exit(1);
if (/public\/app|features\/|src\/runtime|markdownEditorNative|showToast/.test(createPlatformSource)) process.exit(1);
if (/public\/app|features\/|markdownEditorNative|showToast|localStorage|document\.|window\./.test(desktopPlatformSource)) process.exit(1);
if (!createPlatformSource.includes('PlatformCapabilityUnavailableError')) process.exit(1);
if (!createPlatformSource.includes('createPlatformPortSet')) process.exit(1);
if (!createPlatformSource.includes('createDesktopPlatform')) process.exit(1);
if (!mainSource.includes('createPlatform({')) process.exit(1);
if (!mainSource.includes('mountClassicPlatformPort')) process.exit(1);
if (/markdownEditorNative|window\.markdownEditorPlatform/.test(mainSource)) process.exit(1);
if (!classicBridgeSource.includes('call(portName, methodName')) process.exit(1);
if (!classicBridgeSource.includes('supports(capability)')) process.exit(1);

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
await writeFile(`${OUTPUT_DIRECTORY}/03-11-create-platform-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-11',
  atomicTask: '3.11',
  status: 'passed',
  commit: process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'capability-driven-unified-platform-composition-with-controlled-unsupported-results',
  publicEntry: 'src/platform/index.js',
  implementationFiles: [
    'src/platform/create-platform.js',
    'src/platform/desktop/desktop-platform.js'
  ],
  productionModuleCount: moduleFixture.modules.length,
  platformModuleCount: platformModules.length,
  samples: {
    browser: {
      capabilities: browserPlatform.capabilities,
      text: browserText,
      image: browserImage,
      web: browserWeb,
      fullscreenStates: browserFullscreenStates,
      print: browserPrint,
      unsupportedWindow,
      unsupportedTree
    },
    missingBrowserCapabilities: {
      capabilities: missingPlatform.capabilities,
      unsupportedStorage,
      unsupportedFetch
    },
    desktop: {
      capabilities: desktopPlatform.capabilities,
      text: desktopText,
      web: desktopWeb,
      calls: desktopLog
    }
  },
  guarantees: [
    'one-create-platform-composition-root-exposes-capabilities-and-all-twelve-runtime-neutral-ports',
    'desktop-command-clients-are-normalized-by-one-desktop-platform-composition-module',
    'browser-and-desktop-selection-is-driven-by-the-immutable-capability-snapshot',
    'missing-capabilities-throw-platform-capability-unavailable-instead-of-no-op-success',
    'browser-file-reader-download-storage-clipboard-fullscreen-print-web-and-link-adapters-remain-responsibility-focused',
    'desktop-files-and-web-results-are-normalized-to-the-frozen-port-contract-without-business-state',
    'webkit-only-fullscreen-is-detected-consistently-with-the-browser-fullscreen-adapter',
    'platform-destroy-is-owned-by-the-existing-port-set-lifecycle',
    'atomic-task-3.12-removes-the-legacy-native-facade-and-consumers-use-platform-ports'
  ]
}, null, 2)}\n`, 'utf8');
