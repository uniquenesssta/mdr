// Records machine-readable Stage 3 platform-foundation evidence for the verified commit.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import {
  BrowserFileReadCancelledError,
  CLIPBOARD_PORT_METHODS,
  DIALOGS_PORT_METHODS,
  DOCUMENT_STORE_PORT_METHODS,
  DRAG_DROP_PORT_METHODS,
  FILES_PORT_METHODS,
  FULLSCREEN_PORT_METHODS,
  LINKS_PORT_METHODS,
  LOGS_PORT_METHODS,
  PLATFORM_PORT_NAMES,
  PRINT_PORT_METHODS,
  STORAGE_PORT_METHODS,
  WEB_PORT_METHODS,
  WINDOW_PORT_METHODS,
  createBrowserClipboard,
  createBrowserFileDownload,
  createBrowserFileReader,
  createBrowserFullscreen,
  createBrowserPrint,
  createBrowserStorage,
  createDialogClient,
  createDocumentStoreClient,
  createDragDropClient,
  createFileSystemClient,
  createInvokeClient,
  createLinkClient,
  createPerformanceLogClient,
  createRuntimeCapabilities,
  createWebFetchClient,
  createWindowClient,
  detectPlatformEnvironment
} from '../../src/platform/index.js';

const OUTPUT_DIRECTORY = 'artifacts/stage-03';
const PLATFORM_ROOT = 'src/platform';
const PORT_DIRECTORY = `${PLATFORM_ROOT}/ports`;
const ENVIRONMENT_DIRECTORY = `${PLATFORM_ROOT}/environment`;
const BROWSER_DIRECTORY = `${PLATFORM_ROOT}/browser`;
const DESKTOP_DIRECTORY = `${PLATFORM_ROOT}/desktop`;
const INVENTORY_PATH = 'tests/unit/platform/fixtures/platform-port-inventory.json';
const MODULE_FIXTURE_PATH = 'tests/architecture/fixtures/production-modules.json';
const HISTORICAL_STAGE_3_PRODUCTION_MODULE_COUNT = 174;
const STAGE_3_PLATFORM_MODULE_COUNT = 36;

const methodsByPort = Object.freeze({
  storage: STORAGE_PORT_METHODS,
  files: FILES_PORT_METHODS,
  dialogs: DIALOGS_PORT_METHODS,
  window: WINDOW_PORT_METHODS,
  dragDrop: DRAG_DROP_PORT_METHODS,
  documentStore: DOCUMENT_STORE_PORT_METHODS,
  web: WEB_PORT_METHODS,
  links: LINKS_PORT_METHODS,
  logs: LOGS_PORT_METHODS,
  clipboard: CLIPBOARD_PORT_METHODS,
  fullscreen: FULLSCREEN_PORT_METHODS,
  print: PRINT_PORT_METHODS
});

const expectedPortNames = Object.freeze([
  'storage', 'files', 'dialogs', 'window', 'dragDrop', 'documentStore',
  'web', 'links', 'logs', 'clipboard', 'fullscreen', 'print'
]);
const expectedPortFiles = Object.freeze([
  'clipboard-port.js', 'dialogs-port.js', 'document-store-port.js', 'drag-drop-port.js',
  'files-port.js', 'fullscreen-port.js', 'index.js', 'links-port.js', 'logs-port.js',
  'platform-port-set.js', 'port-contract.js', 'print-port.js', 'storage-port.js',
  'web-port.js', 'window-port.js'
]);
const expectedEnvironmentFiles = Object.freeze(['platform-detection.js', 'runtime-capabilities.js']);
const expectedBrowserFiles = Object.freeze([
  'browser-clipboard.js', 'browser-file-download.js', 'browser-file-reader.js',
  'browser-fullscreen.js', 'browser-print.js', 'browser-storage.js'
]);
const expectedDesktopFiles = Object.freeze([
  'desktop-platform.js', 'dialog-client.js', 'document-store-client.js', 'drag-drop-client.js',
  'file-system-client.js', 'invoke-client.js', 'link-client.js',
  'performance-log-client.js', 'web-fetch-client.js', 'window-client.js'
]);

function createBrowserRuntime() {
  class Element {}
  Element.prototype.requestFullscreen = async () => {};
  return {
    localStorage: { getItem() {}, setItem() {}, removeItem() {}, clear() {} },
    FileReader: class FileReader {},
    URL: { createObjectURL() {}, revokeObjectURL() {} },
    Element,
    document: {
      fullscreenEnabled: true,
      createElement() {},
      execCommand() {},
      exitFullscreen() {},
      addEventListener() {}
    },
    navigator: { clipboard: { writeText() {} } },
    fetch() {}, open() {}, print() {}, confirm() {}
  };
}

const inventory = JSON.parse(await readFile(INVENTORY_PATH, 'utf8'));
const moduleFixture = JSON.parse(await readFile(MODULE_FIXTURE_PATH, 'utf8'));
const portFiles = (await readdir(PORT_DIRECTORY)).sort();
const environmentFiles = (await readdir(ENVIRONMENT_DIRECTORY)).sort();
const browserFiles = (await readdir(BROWSER_DIRECTORY)).sort();
const desktopFiles = (await readdir(DESKTOP_DIRECTORY)).sort();
const portSources = await Promise.all(portFiles.map(file => readFile(`${PORT_DIRECTORY}/${file}`, 'utf8')));
const environmentSources = Object.fromEntries(await Promise.all(
  environmentFiles.map(async file => [file, await readFile(`${ENVIRONMENT_DIRECTORY}/${file}`, 'utf8')])
));
const browserSources = Object.fromEntries(await Promise.all(
  browserFiles.map(async file => [file, await readFile(`${BROWSER_DIRECTORY}/${file}`, 'utf8')])
));
const desktopSources = Object.fromEntries(await Promise.all(
  desktopFiles.map(async file => [file, await readFile(`${DESKTOP_DIRECTORY}/${file}`, 'utf8')])
));
const desktopPlatformSource = await readFile('src/platform/desktop/desktop-platform.js', 'utf8');
const mainSource = await readFile('src/main.js', 'utf8');
const platformModules = moduleFixture.modules
  .filter(record => String(record[0]).startsWith('src/platform/'))
  .map(record => record[0])
  .sort();
const legacyNativeTargets = Object.values(inventory.legacyNativeMethods).flat();
const browserTargets = Object.values(inventory.browserSurfaces).flat();
const declaredTargets = new Set(
  Object.entries(methodsByPort).flatMap(([portName, methods]) => methods.map(method => `${portName}.${method}`))
);
const sentinelOwners = [];
const dialogPluginOwners = [];
const webviewApiOwners = [];
const windowApiOwners = [];
for (const [path] of moduleFixture.modules) {
  const source = await readFile(path, 'utf8');
  if (source.includes('__TAURI_INTERNALS__')) sentinelOwners.push(path);
  if (source.includes('@tauri-apps/plugin-dialog')) dialogPluginOwners.push(path);
  if (source.includes('@tauri-apps/api/webview')) webviewApiOwners.push(path);
  if (source.includes('@tauri-apps/api/window')) windowApiOwners.push(path);
}

const browserRuntime = createBrowserRuntime();
const desktopRuntime = { ...createBrowserRuntime(), __TAURI_INTERNALS__: {} };
const browserEnvironment = detectPlatformEnvironment(browserRuntime);
const desktopEnvironment = detectPlatformEnvironment(desktopRuntime);
const browserCapabilities = createRuntimeCapabilities(browserEnvironment, browserRuntime);
const desktopCapabilities = createRuntimeCapabilities(desktopEnvironment, desktopRuntime);

const invokeCalls = [];
const invokeTelemetry = [];
let invokeNow = 100;
const invokeClient = createInvokeClient({
  invoke: async (operation, args) => {
    invokeCalls.push({ operation, args });
    return Object.freeze({ operation, args });
  },
  now: () => (invokeNow += 5),
  record: (operation, entry) => invokeTelemetry.push({ operation, entry })
});
const invokeArgs = Object.freeze({ documentId: 'evidence-document' });
const invokeResult = await invokeClient.invoke('load_document_state', invokeArgs, { documentId: 'evidence-document' });
const invokeError = new Error('evidence invoke error');
const failingInvokeClient = createInvokeClient({
  invoke: async () => { throw invokeError; },
  now: () => (invokeNow += 5),
  record: (operation, entry) => invokeTelemetry.push({ operation, entry })
});
let capturedInvokeError = null;
try {
  await failingInvokeClient.invoke('fetch_url', { url: 'https://example.com' }, { inputLength: 19 });
} catch (error) {
  capturedInvokeError = error;
}

const dialogCalls = [];
const dialogTelemetry = [];
let dialogNow = 200;
const dialogClient = createDialogClient({
  open: async options => {
    dialogCalls.push({ method: 'open', options });
    return options.directory ? null : '/tmp/evidence.md';
  },
  save: async options => {
    dialogCalls.push({ method: 'save', options });
    return '/tmp/evidence';
  },
  confirm: async (message, options) => {
    dialogCalls.push({ method: 'confirm', message, options });
    return false;
  },
  now: () => (dialogNow += 5),
  record: (operation, entry) => dialogTelemetry.push({ operation, entry })
});
const dialogResults = {
  openFile: await dialogClient.openFile({ extensions: ['.md'] }),
  openDirectory: await dialogClient.openDirectory({ defaultPath: '/tmp' }),
  saveFile: await dialogClient.saveFile('evidence', { extension: 'md', defaultDirectory: '/tmp' }),
  confirm: await dialogClient.confirm('Continue?')
};

const dragDropCalls = [];
const dragDropDisposals = [];
let dragDropNativeHandler = null;
const evidenceWebview = {
  async onDragDropEvent(handler) {
    dragDropNativeHandler = handler;
    dragDropCalls.push({ method: 'onDragDropEvent', handler });
    return () => dragDropDisposals.push('drag-drop');
  }
};
const dragDropClient = createDragDropClient({ getCurrentWebview: () => evidenceWebview });
const normalizedDragDropEvents = [];
const dragDropDisposer = await dragDropClient.subscribe(event => normalizedDragDropEvents.push(event));
dragDropNativeHandler({
  payload: {
    type: 'drop',
    paths: ['/tmp/evidence.md'],
    position: { x: 12, y: 34 }
  }
});
await dragDropClient.destroy();
await dragDropDisposer();

const fileSystemCalls = [];
const fileSystemClient = createFileSystemClient({
  invoke: async (operation, args, details) => {
    fileSystemCalls.push({ operation, args, details });
    return Object.freeze({ operation, args });
  }
});
const fileSystemResults = {
  dropped: await fileSystemClient.readDroppedFile('/tmp/evidence.md'),
  tree: await fileSystemClient.listTextFileTree('/tmp/evidence.md'),
  image: await fileSystemClient.readLocalImage('image.png', '/tmp/evidence.md'),
  initialPath: await fileSystemClient.getInitialFilePath(),
  textWrite: await fileSystemClient.writeTextFile('/tmp/evidence.md', 'hello', { extension: 'md', reason: 'evidence' }),
  binaryWrite: await fileSystemClient.writeBinaryFile('/tmp/evidence.bin', new Uint8Array([1, 2, 3]), { extension: 'bin', reason: 'evidence' })
};

const documentStoreCalls = [];
const documentStoreClient = createDocumentStoreClient({
  invoke: async (operation, args, details) => {
    documentStoreCalls.push({ operation, args, details });
    return Object.freeze({ operation, args });
  }
});
const documentStoreRequest = Object.freeze({
  documentId: 'evidence-document',
  title: 'Evidence',
  baseVersion: 2,
  nextVersion: 3,
  fullContent: null,
  transactions: Object.freeze([]),
  updatedAt: 123,
  forceSnapshot: false
});
const documentStoreSearchRequest = Object.freeze({
  documentId: 'evidence-document', query: 'needle', from: 4, wrap: true
});
const documentStoreResults = {
  save: await documentStoreClient.save(documentStoreRequest),
  begin: await documentStoreClient.beginSnapshotUpload('evidence-document', 'upload-evidence'),
  append: await documentStoreClient.appendSnapshotChunk('evidence-document', 'upload-evidence', 'chunk', 1),
  commit: await documentStoreClient.commitSnapshotUpload(documentStoreRequest, 'upload-evidence'),
  abort: await documentStoreClient.abortSnapshotUpload('evidence-document', 'upload-evidence'),
  load: await documentStoreClient.load('evidence-document'),
  manifest: await documentStoreClient.loadManifest('evidence-document'),
  chunk: await documentStoreClient.readChunk('evidence-document', 32, 64 * 1024),
  search: await documentStoreClient.search(documentStoreSearchRequest),
  remove: await documentStoreClient.remove('evidence-document')
};

const webFetchCalls = [];
const webFetchResult = Object.freeze({ success: true, html: '<p>evidence</p>', final_url: 'https://example.com/' });
const webFetchClient = createWebFetchClient({
  invoke: async (operation, args, details, options) => {
    webFetchCalls.push({ operation, args, details, options });
    return webFetchResult;
  }
});
const webFetchEvidenceResult = await webFetchClient.fetchUrl('example.com');

const linkCalls = [];
const linkClient = createLinkClient({
  invoke: async (operation, args, details, options) => {
    linkCalls.push({ operation, args, details, options });
    return undefined;
  }
});
const linkEvidenceResult = await linkClient.openExternal(' HTTPS://example.com/path ');

const performanceLogCalls = [];
const performanceEntries = Object.freeze([{ operation: 'evidence.operation' }]);
const performanceLogClient = createPerformanceLogClient({
  invoke: async (operation, args, details, options) => {
    performanceLogCalls.push({ operation, args, details, options });
    return 'logs/performance.jsonl';
  }
});
const performanceLogEvidenceResult = await performanceLogClient.writePerformance(performanceEntries);

const browserStorageValues = new Map();
const browserStorageCalls = [];
const browserStorage = createBrowserStorage({
  storage: {
    getItem(key) { browserStorageCalls.push(['get', key]); return browserStorageValues.has(key) ? browserStorageValues.get(key) : null; },
    setItem(key, value) { browserStorageCalls.push(['set', key, value]); browserStorageValues.set(key, value); },
    removeItem(key) { browserStorageCalls.push(['remove', key]); browserStorageValues.delete(key); },
    clear() { browserStorageCalls.push(['clear']); browserStorageValues.clear(); }
  }
});
browserStorage.set('theme', 'dark');
const browserStoredTheme = browserStorage.get('theme');
browserStorage.remove('theme');
browserStorage.set('temporary', 1);
browserStorage.clear();

const browserDownloadCalls = [];
const browserDownloadBody = {
  appendChild(node) { node.parentNode = browserDownloadBody; browserDownloadCalls.push(['append']); },
  removeChild(node) { node.parentNode = null; browserDownloadCalls.push(['remove']); }
};
const browserDownload = createBrowserFileDownload({
  documentObject: {
    body: browserDownloadBody,
    createElement() {
      return {
        href: '', download: '', parentNode: null,
        click() { browserDownloadCalls.push(['click', this.href, this.download]); },
        remove() { if (this.parentNode) browserDownloadBody.removeChild(this); }
      };
    }
  },
  urlApi: {
    createObjectURL(blob) { browserDownloadCalls.push(['createObjectURL', blob]); return 'blob:evidence'; },
    revokeObjectURL(url) { browserDownloadCalls.push(['revokeObjectURL', url]); }
  }
});
const browserDownloadBlob = Object.freeze({ type: 'text/plain' });
browserDownload.downloadBlob(browserDownloadBlob, 'evidence.txt');

const browserClipboardCalls = [];
const browserClipboard = createBrowserClipboard({
  navigatorObject: {
    clipboard: {
      async writeText(value) { browserClipboardCalls.push(value); }
    }
  },
  documentObject: null
});
const browserClipboardResult = await browserClipboard.writeText('evidence');

const browserFullscreenCalls = [];
const browserFullscreenStates = [];
const browserFullscreenListeners = new Map();
let browserFullscreenTarget = null;
const browserFullscreenDocument = {
  fullscreenEnabled: true,
  fullscreenElement: null,
  documentElement: null,
  async exitFullscreen() {
    browserFullscreenCalls.push('exit');
    browserFullscreenDocument.fullscreenElement = null;
  },
  addEventListener(type, handler) {
    browserFullscreenCalls.push(['add', type]);
    browserFullscreenListeners.set(type, handler);
  },
  removeEventListener(type, handler) {
    browserFullscreenCalls.push(['remove', type]);
    if (browserFullscreenListeners.get(type) === handler) browserFullscreenListeners.delete(type);
  }
};
browserFullscreenTarget = {
  async requestFullscreen() {
    browserFullscreenCalls.push('enter');
    browserFullscreenDocument.fullscreenElement = browserFullscreenTarget;
  }
};
browserFullscreenDocument.documentElement = browserFullscreenTarget;
const browserFullscreen = createBrowserFullscreen({ documentObject: browserFullscreenDocument });
const disposeBrowserFullscreen = browserFullscreen.subscribe(active => browserFullscreenStates.push(active));
await browserFullscreen.enter();
browserFullscreenListeners.get('fullscreenchange')();
await browserFullscreen.exit();
browserFullscreenListeners.get('webkitfullscreenchange')();
disposeBrowserFullscreen();
disposeBrowserFullscreen();

const browserPrintCalls = [];
const browserPrint = createBrowserPrint({
  windowObject: {
    print() { browserPrintCalls.push('print'); return 'printed'; }
  }
});
const browserPrintResult = browserPrint.print();

class EvidenceFileReader {
  static mode = 'load';
  constructor() {
    this.result = null;
    this.error = null;
    this.onload = null;
    this.onerror = null;
    this.onabort = null;
  }
  readAsText(file) {
    if (EvidenceFileReader.mode === 'abort') return this.onabort?.();
    this.result = `text:${file.name}`;
    this.onload?.();
  }
  readAsDataURL(file) {
    if (EvidenceFileReader.mode === 'abort') return this.onabort?.();
    this.result = `data:${file.name}`;
    this.onload?.();
  }
}
const browserFileReader = createBrowserFileReader({ FileReaderClass: EvidenceFileReader });
const browserReadTextResult = await browserFileReader.readText({ name: 'evidence.md' });
EvidenceFileReader.mode = 'abort';
let browserReadCancellationCode = null;
try {
  await browserFileReader.readDataUrl({ name: 'evidence.png' });
} catch (error) {
  if (!(error instanceof BrowserFileReadCancelledError)) throw error;
  browserReadCancellationCode = error.code;
}
EvidenceFileReader.mode = 'load';

const windowCalls = [];
const windowDisposals = [];
const evidenceWindow = {
  async startDragging() { windowCalls.push('startDragging'); },
  async minimize() { windowCalls.push('minimize'); },
  async toggleMaximize() { windowCalls.push('toggleMaximize'); },
  async isMaximized() { windowCalls.push('isMaximized'); return true; },
  async onResized(handler) { windowCalls.push({ method: 'onResized', handler }); return () => windowDisposals.push('resize'); },
  async onCloseRequested(handler) { windowCalls.push({ method: 'onCloseRequested', handler }); return () => windowDisposals.push('close'); },
  async close() { windowCalls.push('close'); },
  async destroy() { windowCalls.push('destroy'); }
};
const windowClient = createWindowClient({ getCurrentWindow: () => evidenceWindow });
const resizeHandler = () => {};
const closeHandler = () => {};
await windowClient.startDrag();
await windowClient.minimize();
const toggledMaximized = await windowClient.toggleMaximize();
const maximized = await windowClient.isMaximized();
await windowClient.subscribeResize(resizeHandler);
await windowClient.subscribeCloseRequest(closeHandler);
await windowClient.requestClose();
await windowClient.forceClose();
await windowClient.destroy();

if (JSON.stringify(PLATFORM_PORT_NAMES) !== JSON.stringify(expectedPortNames)) process.exit(1);
if (JSON.stringify(portFiles) !== JSON.stringify(expectedPortFiles)) process.exit(1);
if (JSON.stringify(environmentFiles) !== JSON.stringify(expectedEnvironmentFiles)) process.exit(1);
if (JSON.stringify(browserFiles) !== JSON.stringify(expectedBrowserFiles)) process.exit(1);
if (JSON.stringify(desktopFiles) !== JSON.stringify(expectedDesktopFiles)) process.exit(1);
if (platformModules.length !== STAGE_3_PLATFORM_MODULE_COUNT) process.exit(1);
if (Object.keys(inventory.legacyNativeMethods).length !== 33) process.exit(1);
if (Object.keys(inventory.browserSurfaces).length !== 13) process.exit(1);
if ([...legacyNativeTargets, ...browserTargets].some(target => !declaredTargets.has(target))) process.exit(1);
if (portSources.some(source => /@tauri|__TAURI|markdownEditorNative|getCurrentWindow|getCurrentWebview/.test(source))) process.exit(1);
if (portSources.some(source => /\bwindow\.|\bdocument\.|\blocalStorage\b|\bnavigator\./.test(source))) process.exit(1);
if (sentinelOwners.length !== 1 || sentinelOwners[0] !== 'src/platform/environment/platform-detection.js') process.exit(1);
if (dialogPluginOwners.length !== 1 || dialogPluginOwners[0] !== 'src/platform/desktop/dialog-client.js') process.exit(1);
if (webviewApiOwners.length !== 1 || webviewApiOwners[0] !== 'src/platform/desktop/drag-drop-client.js') process.exit(1);
if (windowApiOwners.length !== 1 || windowApiOwners[0] !== 'src/platform/desktop/window-client.js') process.exit(1);
if (!environmentSources['platform-detection.js'].includes('__TAURI_INTERNALS__')) process.exit(1);
if (/@tauri|__TAURI|\binvoke\s*\(/.test(environmentSources['runtime-capabilities.js'])) process.exit(1);
if (/\bwindow\.|\bdocument\.|\bnavigator\./.test(environmentSources['runtime-capabilities.js'])) process.exit(1);
if (!browserSources['browser-storage.js'].includes('getItem')) process.exit(1);
if (/JSON\.parse|JSON\.stringify|md_editor_|autosave/.test(browserSources['browser-storage.js'])) process.exit(1);
if (!browserSources['browser-file-download.js'].includes('createObjectURL') || !browserSources['browser-file-download.js'].includes('revokeObjectURL')) process.exit(1);
if (/showToast|exportDocument|saveCurrentDocument/.test(browserSources['browser-file-download.js'])) process.exit(1);
if (!browserSources['browser-clipboard.js'].includes("execCommand('copy')")) process.exit(1);
if (/showToast|copyContextDocumentTitle/.test(browserSources['browser-clipboard.js'])) process.exit(1);
if (!browserSources['browser-fullscreen.js'].includes('fullscreenchange') || !browserSources['browser-fullscreen.js'].includes('webkitfullscreenchange')) process.exit(1);
if (/classList|localStorage|togglePageFullscreen/.test(browserSources['browser-fullscreen.js'])) process.exit(1);
if (!browserSources['browser-print.js'].includes('windowObject.print')) process.exit(1);
if (/afterprint|restorePreview|markdown-body/.test(browserSources['browser-print.js'])) process.exit(1);
if (!browserSources['browser-file-reader.js'].includes('BROWSER_FILE_READ_CANCELLED')) process.exit(1);
if (/showToast|newDocument|insertImageMarkdown|loadTextContentAsDocument/.test(browserSources['browser-file-reader.js'])) process.exit(1);
if (!desktopPlatformSource.includes('createInvokeClient')) process.exit(1);
if (!desktopPlatformSource.includes('createFileSystemClient')) process.exit(1);
if (!desktopPlatformSource.includes('createDocumentStoreClient')) process.exit(1);
if (!desktopPlatformSource.includes('createWebFetchClient')) process.exit(1);
if (!desktopPlatformSource.includes('createLinkClient')) process.exit(1);
if (!desktopPlatformSource.includes('createPerformanceLogClient')) process.exit(1);
if (!desktopPlatformSource.includes('createWindowClient')) process.exit(1);
if (!mainSource.includes('createPlatform({') || !mainSource.includes('mountClassicPlatformPort')) process.exit(1);
if (/markdownEditorNative|window\.markdownEditorPlatform/.test(mainSource)) process.exit(1);
if (invokeCalls.length !== 1 || invokeCalls[0].operation !== 'load_document_state' || invokeCalls[0].args !== invokeArgs) process.exit(1);
if (invokeResult.args !== invokeArgs || capturedInvokeError !== invokeError) process.exit(1);
if (invokeTelemetry.length !== 2 || invokeTelemetry[0].entry.status === 'error' || invokeTelemetry[1].entry.status !== 'error') process.exit(1);
if (dialogCalls.length !== 4) process.exit(1);
if (dialogResults.openFile !== '/tmp/evidence.md' || dialogResults.openDirectory !== null) process.exit(1);
if (dialogResults.saveFile !== '/tmp/evidence.md' || dialogResults.confirm !== false) process.exit(1);
if (dialogTelemetry.length !== 3 || dialogTelemetry[1].entry.status !== 'cancelled') process.exit(1);
if (dragDropCalls.length !== 1 || dragDropDisposals.join(',') !== 'drag-drop') process.exit(1);
if (JSON.stringify(normalizedDragDropEvents) !== JSON.stringify([{
  type: 'drop', paths: ['/tmp/evidence.md'], position: { x: 12, y: 34 }
}])) process.exit(1);
if (!Object.isFrozen(normalizedDragDropEvents[0]) || !Object.isFrozen(normalizedDragDropEvents[0].paths) || !Object.isFrozen(normalizedDragDropEvents[0].position)) process.exit(1);
if (fileSystemCalls.length !== 6) process.exit(1);
if (fileSystemCalls.map(call => call.operation).join(',') !== [
  'read_dropped_file', 'list_text_file_tree', 'read_local_image',
  'initial_file_path', 'write_local_text_file', 'write_local_binary_file'
].join(',')) process.exit(1);
if (fileSystemCalls[0].args.path !== '/tmp/evidence.md') process.exit(1);
if (fileSystemCalls[1].args.documentPath !== '/tmp/evidence.md') process.exit(1);
if (fileSystemCalls[2].args.documentPath !== '/tmp/evidence.md') process.exit(1);
if (fileSystemCalls[4].args.content !== 'hello') process.exit(1);
if (fileSystemCalls[5].args.contentBase64 !== 'AQID') process.exit(1);
if (fileSystemResults.dropped.operation !== 'read_dropped_file') process.exit(1);
if (fileSystemResults.binaryWrite.operation !== 'write_local_binary_file') process.exit(1);
if (documentStoreCalls.length !== 10) process.exit(1);
if (documentStoreCalls.map(call => call.operation).join(',') !== [
  'save_document_state', 'begin_document_snapshot_upload', 'append_document_snapshot_chunk',
  'commit_document_snapshot_upload', 'abort_document_snapshot_upload', 'load_document_state',
  'load_document_manifest', 'read_document_chunk', 'search_document_state', 'delete_document_state'
].join(',')) process.exit(1);
if (documentStoreCalls[0].args.request !== documentStoreRequest) process.exit(1);
if (documentStoreCalls[1].args.documentId !== 'evidence-document' || documentStoreCalls[1].args.uploadId !== 'upload-evidence') process.exit(1);
if (documentStoreCalls[2].args.chunk !== 'chunk' || documentStoreCalls[2].details.chunkIndex !== 1) process.exit(1);
if (documentStoreCalls[3].args.request !== documentStoreRequest || documentStoreCalls[3].args.uploadId !== 'upload-evidence') process.exit(1);
if (documentStoreCalls[7].args.byteOffset !== 32 || documentStoreCalls[7].args.maxBytes !== 64 * 1024) process.exit(1);
if (documentStoreCalls[8].args.request !== documentStoreSearchRequest) process.exit(1);
if (documentStoreResults.save.operation !== 'save_document_state' || documentStoreResults.remove.operation !== 'delete_document_state') process.exit(1);
if (webFetchCalls.length !== 1 || webFetchCalls[0].operation !== 'fetch_url') process.exit(1);
if (webFetchCalls[0].args.url !== 'example.com' || webFetchCalls[0].details.inputLength !== 11) process.exit(1);
if (webFetchEvidenceResult !== webFetchResult) process.exit(1);
if (linkCalls.length !== 1 || linkCalls[0].operation !== 'open_external_url') process.exit(1);
if (linkCalls[0].args.url !== 'HTTPS://example.com/path' || linkCalls[0].details.scheme !== 'https') process.exit(1);
if (linkEvidenceResult !== undefined) process.exit(1);
if (performanceLogCalls.length !== 1 || performanceLogCalls[0].operation !== 'write_performance_logs') process.exit(1);
if (performanceLogCalls[0].args.entries !== performanceEntries || performanceLogCalls[0].options?.record !== false) process.exit(1);
if (performanceLogEvidenceResult !== 'logs/performance.jsonl') process.exit(1);
if (browserStoredTheme !== 'dark') process.exit(1);
if (browserStorageCalls.map(call => call[0]).join(',') !== 'set,get,remove,set,clear') process.exit(1);
if (browserDownloadCalls.map(call => call[0]).join(',') !== 'createObjectURL,append,click,remove,revokeObjectURL') process.exit(1);
if (browserDownloadCalls[2][1] !== 'blob:evidence' || browserDownloadCalls[2][2] !== 'evidence.txt') process.exit(1);
if (browserClipboardResult !== true || browserClipboardCalls.join(',') !== 'evidence') process.exit(1);
if (browserFullscreenStates.join(',') !== 'true,false') process.exit(1);
if (browserFullscreenCalls.filter(call => Array.isArray(call) && call[0] === 'remove').length !== 2) process.exit(1);
if (browserPrintResult !== 'printed' || browserPrintCalls.join(',') !== 'print') process.exit(1);
if (browserReadTextResult !== 'text:evidence.md') process.exit(1);
if (browserReadCancellationCode !== 'BROWSER_FILE_READ_CANCELLED') process.exit(1);
if (!toggledMaximized || !maximized) process.exit(1);
if (windowCalls.length !== 9 || windowDisposals.join(',') !== 'close,resize') process.exit(1);
if (windowCalls[5].handler !== resizeHandler || windowCalls[6].handler !== closeHandler) process.exit(1);
if (browserEnvironment.kind !== 'browser' || desktopEnvironment.kind !== 'desktop') process.exit(1);
if (!Object.isFrozen(browserEnvironment) || !Object.isFrozen(desktopEnvironment)) process.exit(1);
if (!Object.isFrozen(browserCapabilities) || !Object.isFrozen(browserCapabilities.browser) || !Object.isFrozen(browserCapabilities.desktop)) process.exit(1);
if (!Object.isFrozen(desktopCapabilities) || !Object.values(desktopCapabilities.desktop).every(Boolean)) process.exit(1);

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
await writeFile(`${OUTPUT_DIRECTORY}/03-01-platform-ports-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-01', atomicTask: '3.1', status: 'passed',
  commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'business-neutral-platform-port-contracts', publicEntry: 'src/platform/index.js',
  portCount: PLATFORM_PORT_NAMES.length,
  ports: Object.fromEntries(PLATFORM_PORT_NAMES.map(name => [name, [...methodsByPort[name]]])),
  implementationFiles: ['src/platform/index.js', ...portFiles.map(file => `${PORT_DIRECTORY}/${file}`)],
  historicalStage3ProductionModuleCount: HISTORICAL_STAGE_3_PRODUCTION_MODULE_COUNT,
  productionModuleCount: moduleFixture.modules.length, platformModuleCount: platformModules.length,
  platformModules,
  legacyInventory: {
    path: INVENTORY_PATH,
    nativeMethodCount: Object.keys(inventory.legacyNativeMethods).length,
    browserSurfaceCount: Object.keys(inventory.browserSurfaces).length
  },
  guarantees: [
    'twelve-separate-business-neutral-port-responsibilities',
    'single-public-platform-contract-entry',
    'no-tauri-types-runtime-detection-or-browser-globals-in-port-contracts',
    'exact-method-validation-and-immutable-public-surfaces',
    'arguments-results-cancellation-values-and-errors-pass-through-unchanged',
    'subscription-methods-require-owned-disposers',
    'late-subscription-results-are-disposed-after-destroy',
    'port-and-aggregate-destroy-are-idempotent-and-reverse-ordered',
    'all-thirty-three-legacy-native-methods-have-explicit-destination-mappings',
    'atomic-task-3.1-contracts-remain-runtime-neutral',
    'capability-detection-is-owned-by-atomic-task-3.2',
    'desktop-command-cutovers-through-web-link-log-are-owned-by-atomic-tasks-3.3-through-3.9',
    'browser-runtime-adapters-are-owned-by-atomic-task-3.10'
  ]
}, null, 2)}\n`, 'utf8');

await writeFile(`${OUTPUT_DIRECTORY}/03-02-runtime-capabilities-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-02', atomicTask: '3.2', status: 'passed',
  commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'immutable-runtime-environment-and-capability-detection', publicEntry: 'src/platform/index.js',
  implementationFiles: environmentFiles.map(file => `${ENVIRONMENT_DIRECTORY}/${file}`),
  productionModuleCount: moduleFixture.modules.length, platformModuleCount: platformModules.length,
  sentinelOwners,
  environments: { browser: browserEnvironment, desktop: desktopEnvironment },
  capabilitySnapshots: { browser: browserCapabilities, desktop: desktopCapabilities },
  guarantees: [
    'one-authoritative-tauri-sentinel-owner',
    'runtime-kind-detection-separated-from-platform-behavior',
    'deeply-immutable-environment-and-capability-snapshots',
    'guarded-browser-surface-probes-do-not-execute-behavior',
    'missing-or-inaccessible-runtime-surfaces-degrade-to-false-capabilities',
    'legacy-runtime-availability-derived-from-public-capabilities',
    'no-production-business-module-checks-tauri-internals',
    'existing-native-method-contracts-and-command-fields-remain-unchanged',
    'desktop-command-clients-through-web-link-log-are-owned-by-atomic-tasks-3.3-through-3.9',
    'browser-adapter-availability-is-implemented-by-atomic-task-3.10-without-platform-composition'
  ]
}, null, 2)}\n`, 'utf8');

await writeFile(`${OUTPUT_DIRECTORY}/03-03-invoke-client-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-03', atomicTask: '3.3', status: 'passed',
  commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'single-measured-tauri-invoke-client', publicEntry: 'src/platform/index.js',
  implementationFiles: [`${DESKTOP_DIRECTORY}/invoke-client.js`],
  productionModuleCount: moduleFixture.modules.length, platformModuleCount: platformModules.length,
  compositionOwner: 'src/platform/desktop/desktop-platform.js',
  sample: { calls: invokeCalls, telemetry: invokeTelemetry, errorIdentityPreserved: capturedInvokeError === invokeError },
  guarantees: [
    'single-production-owner-of-tauri-core-invoke-import',
    'command-name-and-argument-object-pass-through-unchanged',
    'native-roundtrip-duration-recorded-for-success-and-error',
    'original-invoke-result-and-error-identity-preserved',
    'telemetry-failures-cannot-replace-native-semantics',
    'performance-log-transport-explicitly-suppresses-recursive-telemetry',
    'legacy-runtime-has-zero-direct-invoke-calls-after-atomic-task-3.9',
    'all-current-desktop-command-mappings-use-responsibility-focused-clients'
  ]
}, null, 2)}\n`, 'utf8');

await writeFile(`${OUTPUT_DIRECTORY}/03-04-dialog-client-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-04', atomicTask: '3.4', status: 'passed',
  commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'desktop-open-save-directory-confirm-dialog-client',
  publicEntry: 'src/platform/index.js',
  implementationFiles: [`${DESKTOP_DIRECTORY}/dialog-client.js`],
  productionModuleCount: moduleFixture.modules.length, platformModuleCount: platformModules.length,
  dialogPluginOwners,
  compositionOwner: 'src/platform/desktop/desktop-platform.js',
  sample: { calls: dialogCalls, results: dialogResults, telemetry: dialogTelemetry },
  guarantees: [
    'single-production-owner-of-tauri-dialog-plugin-import',
    'open-file-open-directory-save-file-and-confirm-have-one-desktop-client',
    'file-and-directory-cancellation-resolve-to-null',
    'confirmation-cancellation-resolves-to-false',
    'save-filename-cleaning-default-path-joining-and-extension-completion-remain-compatible',
    'native-dialog-errors-are-rethrown-with-original-identity',
    'dialog-telemetry-failures-cannot-replace-native-results-or-errors',
    'final-platform-callers-preserve-dialog-cancellation-and-browser-confirm-semantics'
  ]
}, null, 2)}\n`, 'utf8');

await writeFile(`${OUTPUT_DIRECTORY}/03-05-window-client-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-05', atomicTask: '3.5', status: 'passed',
  commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'desktop-window-controls-and-owned-subscriptions',
  publicEntry: 'src/platform/index.js',
  implementationFiles: [`${DESKTOP_DIRECTORY}/window-client.js`],
  productionModuleCount: moduleFixture.modules.length, platformModuleCount: platformModules.length,
  windowApiOwners,
  compositionOwner: 'src/platform/desktop/desktop-platform.js',
  sample: { calls: windowCalls, disposals: windowDisposals, toggledMaximized, maximized },
  guarantees: [
    'single-production-owner-of-tauri-window-api-import',
    'drag-minimize-toggle-maximize-state-query-close-and-force-close-have-one-desktop-client',
    'resize-and-close-request-subscriptions-return-idempotent-owned-disposers',
    'client-destroy-disposes-active-subscriptions-in-reverse-order',
    'late-subscription-results-are-disposed-after-client-destroy',
    'request-close-preserves-close-request-events-while-force-close-preserves-native-destroy-fallback',
    'native-window-results-and-error-identity-remain-unchanged',
    'save-before-close-policy-remains-in-the-application-layer'
  ]
}, null, 2)}\n`, 'utf8');

await writeFile(`${OUTPUT_DIRECTORY}/03-06-drag-drop-client-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-06', atomicTask: '3.6', status: 'passed',
  commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'desktop-webview-drag-drop-event-normalization-and-owned-subscriptions',
  publicEntry: 'src/platform/index.js',
  implementationFiles: [`${DESKTOP_DIRECTORY}/drag-drop-client.js`],
  productionModuleCount: moduleFixture.modules.length, platformModuleCount: platformModules.length,
  webviewApiOwners,
  compositionOwner: 'src/platform/desktop/desktop-platform.js',
  sample: { calls: dragDropCalls.length, events: normalizedDragDropEvents, disposals: dragDropDisposals },
  guarantees: [
    'single-production-owner-of-tauri-webview-drag-drop-import',
    'native-drag-drop-events-normalize-to-immutable-type-paths-and-position-data',
    'file-extension-mime-and-content-type-interpretation-remain-outside-the-drag-drop-client',
    'subscriptions-return-idempotent-owned-disposers',
    'client-destroy-disposes-active-subscriptions-in-reverse-order',
    'late-subscription-results-are-disposed-after-client-destroy',
    'native-registration-cleanup-and-handler-errors-retain-original-semantics',
    'final-events-caller-consumes-normalized-drag-drop-platform-events'
  ]
}, null, 2)}\n`, 'utf8');

await writeFile(`${OUTPUT_DIRECTORY}/03-07-file-system-client-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-07', atomicTask: '3.7', status: 'passed',
  commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'desktop-local-file-command-mapping-with-rust-owned-path-and-mime-semantics',
  publicEntry: 'src/platform/index.js',
  implementationFiles: [`${DESKTOP_DIRECTORY}/file-system-client.js`],
  productionModuleCount: moduleFixture.modules.length, platformModuleCount: platformModules.length,
  compositionOwner: 'src/platform/desktop/desktop-platform.js',
  sample: { calls: fileSystemCalls, results: fileSystemResults },
  guarantees: [
    'exactly-six-existing-rust-local-file-commands-are-mapped',
    'legacy-path-normalization-command-fields-and-telemetry-details-remain-compatible',
    'binary-write-transport-keeps-the-existing-base64-encoding',
    'rust-dropped-file-tree-image-and-write-results-pass-through-without-client-interpretation',
    'rust-remains-the-authority-for-native-path-resolution-file-kind-rules-and-image-mime-generation',
    'file-system-client-does-not-create-documents-insert-images-or-show-toasts',
    'native-file-command-results-and-error-identity-remain-unchanged',
    'final-files-port-preserves-six-runtime-neutral-file-responsibilities'
  ]
}, null, 2)}\n`, 'utf8');

await writeFile(`${OUTPUT_DIRECTORY}/03-08-document-store-client-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-08', atomicTask: '3.8', status: 'passed',
  commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'desktop-document-store-command-mapping-with-rust-owned-camelcase-dtos-and-storage-owned-session-policy',
  publicEntry: 'src/platform/index.js',
  implementationFiles: [`${DESKTOP_DIRECTORY}/document-store-client.js`],
  productionModuleCount: moduleFixture.modules.length, platformModuleCount: platformModules.length,
  compositionOwner: 'src/platform/desktop/desktop-platform.js',
  sample: { calls: documentStoreCalls, results: documentStoreResults },
  guarantees: [
    'exactly-ten-existing-rust-document-store-commands-are-mapped',
    'save-search-version-and-snapshot-request-objects-preserve-existing-camelcase-fields',
    'snapshot-upload-document-id-upload-id-chunk-and-chunk-index-semantics-remain-compatible',
    'chunk-read-default-and-minimum-byte-normalization-remain-compatible',
    'rust-document-store-results-null-values-and-errors-pass-through-without-client-interpretation',
    'native-document-store-retains-session-version-mismatch-retry-load-cancellation-and-snapshot-policy',
    'final-document-store-port-preserves-ten-versioned-storage-responsibilities'
  ]
}, null, 2)}\n`, 'utf8');

await writeFile(`${OUTPUT_DIRECTORY}/03-09-web-link-log-clients-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-09', atomicTask: '3.9', status: 'passed',
  commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'three-separate-desktop-web-link-and-performance-log-command-adapters',
  publicEntry: 'src/platform/index.js',
  implementationFiles: [
    `${DESKTOP_DIRECTORY}/web-fetch-client.js`,
    `${DESKTOP_DIRECTORY}/link-client.js`,
    `${DESKTOP_DIRECTORY}/performance-log-client.js`
  ],
  productionModuleCount: moduleFixture.modules.length,
  platformModuleCount: platformModules.length,
  legacyFacadeDeleted: true,
  samples: {
    webFetch: { calls: webFetchCalls, result: webFetchEvidenceResult },
    link: { calls: linkCalls, result: linkEvidenceResult },
    performanceLog: { calls: performanceLogCalls, result: performanceLogEvidenceResult }
  },
  guarantees: [
    'web-link-and-performance-log-commands-have-three-separate-clients-not-one-generic-native-client',
    'web-fetch-client-preserves-fetch-url-argument-and-native-result-error-semantics',
    'rust-web-fetch-remains-authority-for-url-normalization-redirects-timeout-http-and-body-validation',
    'link-client-preserves-legacy-trimming-scheme-and-input-length-telemetry',
    'rust-external-link-command-remains-authority-for-supported-schemes-and-os-launch',
    'performance-log-client-passes-the-original-entry-array-and-disables-recursive-invoke-telemetry',
    'performance-runtime-retains-queue-aggregation-diagnostics-retry-and-flush-policy',
    'final-web-link-log-callers-consume-three-separate-platform-ports',
    'legacy-runtime-facade-is-deleted-after-the-final-cutover'
  ]
}, null, 2)}\n`, 'utf8');

await writeFile(`${OUTPUT_DIRECTORY}/03-10-browser-adapters-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-10', atomicTask: '3.10', status: 'passed',
  commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'six-separate-browser-runtime-adapters-with-explicit-errors-cancellation-and-cleanup',
  publicEntry: 'src/platform/index.js',
  implementationFiles: browserFiles.map(file => `${BROWSER_DIRECTORY}/${file}`),
  productionModuleCount: moduleFixture.modules.length,
  platformModuleCount: platformModules.length,
  samples: {
    storage: { calls: browserStorageCalls, storedTheme: browserStoredTheme },
    download: { calls: browserDownloadCalls },
    clipboard: { calls: browserClipboardCalls, result: browserClipboardResult },
    fullscreen: { calls: browserFullscreenCalls, states: browserFullscreenStates },
    print: { calls: browserPrintCalls, result: browserPrintResult },
    fileReader: { textResult: browserReadTextResult, cancellationCode: browserReadCancellationCode }
  },
  guarantees: [
    'local-storage-download-clipboard-fullscreen-print-and-file-reader-have-six-separate-browser-adapters',
    'browser-storage-preserves-string-and-null-semantics-without-owning-json-or-settings-policy',
    'download-adapter-owns-temporary-anchor-and-object-url-cleanup-without-export-format-or-filename-policy',
    'clipboard-prefers-native-write-text-and-uses-exec-command-only-when-native-api-is-unavailable',
    'clipboard-errors-are-explicit-and-temporary-fallback-dom-is-always-cleaned',
    'fullscreen-standard-and-webkit-events-share-one-idempotent-subscription-disposer',
    'fullscreen-adapter-does-not-own-layout-css-or-page-fullscreen-policy',
    'print-adapter-does-not-own-export-preparation-afterprint-or-preview-restoration',
    'file-reader-abort-is-an-explicit-browser-file-read-cancelled-error',
    'file-reader-native-errors-and-synchronous-read-errors-preserve-original-identity',
    'browser-adapters-are-exported-but-not-yet-composed-into-create-platform-until-atomic-task-3.11'
  ]
}, null, 2)}\n`, 'utf8');

await import('./record-create-platform-evidence.mjs');
await import('./record-platform-cutover-evidence.mjs');
