// Records machine-readable Stage 3 platform-foundation evidence for the verified commit.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import {
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
  createDialogClient,
  createDocumentStoreClient,
  createDragDropClient,
  createFileSystemClient,
  createInvokeClient,
  createRuntimeCapabilities,
  createWindowClient,
  detectPlatformEnvironment
} from '../../src/platform/index.js';

const OUTPUT_DIRECTORY = 'artifacts/stage-03';
const PLATFORM_ROOT = 'src/platform';
const PORT_DIRECTORY = `${PLATFORM_ROOT}/ports`;
const ENVIRONMENT_DIRECTORY = `${PLATFORM_ROOT}/environment`;
const DESKTOP_DIRECTORY = `${PLATFORM_ROOT}/desktop`;
const INVENTORY_PATH = 'tests/unit/platform/fixtures/platform-port-inventory.json';
const MODULE_FIXTURE_PATH = 'tests/architecture/fixtures/production-modules.json';
const LEGACY_RUNTIME_PATH = 'src/runtime/tauri.js';

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
const expectedDesktopFiles = Object.freeze([
  'dialog-client.js', 'document-store-client.js', 'drag-drop-client.js',
  'file-system-client.js', 'invoke-client.js', 'window-client.js'
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
const desktopFiles = (await readdir(DESKTOP_DIRECTORY)).sort();
const portSources = await Promise.all(portFiles.map(file => readFile(`${PORT_DIRECTORY}/${file}`, 'utf8')));
const environmentSources = Object.fromEntries(await Promise.all(
  environmentFiles.map(async file => [file, await readFile(`${ENVIRONMENT_DIRECTORY}/${file}`, 'utf8')])
));
const desktopSources = Object.fromEntries(await Promise.all(
  desktopFiles.map(async file => [file, await readFile(`${DESKTOP_DIRECTORY}/${file}`, 'utf8')])
));
const legacyRuntimeSource = await readFile(LEGACY_RUNTIME_PATH, 'utf8');
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
if (JSON.stringify(desktopFiles) !== JSON.stringify(expectedDesktopFiles)) process.exit(1);
if (moduleFixture.modules.length !== 163 || platformModules.length !== 24) process.exit(1);
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
if (!legacyRuntimeSource.includes("from '../platform/index.js'")) process.exit(1);
if (!legacyRuntimeSource.includes('isAvailable = capabilities.desktop.invoke')) process.exit(1);
if (legacyRuntimeSource.includes('__TAURI_INTERNALS__')) process.exit(1);
if (!desktopSources['invoke-client.js'].includes("@tauri-apps/api/core")) process.exit(1);
if (!desktopSources['invoke-client.js'].includes('throw error')) process.exit(1);
if (!desktopSources['dialog-client.js'].includes("@tauri-apps/plugin-dialog")) process.exit(1);
if (!desktopSources['dialog-client.js'].includes('normalizeSaveFileName')) process.exit(1);
if (!desktopSources['dialog-client.js'].includes('joinNativePath')) process.exit(1);
if (!desktopSources['document-store-client.js'].includes("'save_document_state'")) process.exit(1);
if (!desktopSources['document-store-client.js'].includes("'read_document_chunk'")) process.exit(1);
if (!desktopSources['document-store-client.js'].includes("'delete_document_state'")) process.exit(1);
if (/sessions|loadSequence|VERSION_MISMATCH|saveSnapshotInChunks|DOCUMENT_LOAD_CANCELLED/.test(desktopSources['document-store-client.js'])) process.exit(1);
if (!desktopSources['drag-drop-client.js'].includes("@tauri-apps/api/webview")) process.exit(1);
if (!desktopSources['drag-drop-client.js'].includes('normalizeDragDropEvent')) process.exit(1);
if (!desktopSources['drag-drop-client.js'].includes('activeDisposers')) process.exit(1);
if (/readDroppedFile|dropped\.kind|\.markdown|\.txt|image\//i.test(desktopSources['drag-drop-client.js'])) process.exit(1);
if (!desktopSources['file-system-client.js'].includes("'read_dropped_file'")) process.exit(1);
if (!desktopSources['file-system-client.js'].includes("'write_local_binary_file'")) process.exit(1);
if (!desktopSources['file-system-client.js'].includes('bytesToBase64')) process.exit(1);
if (/showToast|loadTextContentAsDocument|insertImageMarkdown|newDocument|createDocument|dropped\.kind/.test(desktopSources['file-system-client.js'])) process.exit(1);
if (/image\/(?:png|jpeg|gif|webp|svg\+xml)/.test(desktopSources['file-system-client.js'])) process.exit(1);
if (!desktopSources['window-client.js'].includes("@tauri-apps/api/window")) process.exit(1);
if (!desktopSources['window-client.js'].includes('activeDisposers')) process.exit(1);
if (legacyRuntimeSource.includes("@tauri-apps/api/core") || legacyRuntimeSource.includes('invokeMeasured')) process.exit(1);
if (legacyRuntimeSource.includes('@tauri-apps/plugin-dialog') || legacyRuntimeSource.includes('showOpenDialog')) process.exit(1);
if (legacyRuntimeSource.includes('@tauri-apps/api/webview') || legacyRuntimeSource.includes('getCurrentWebview')) process.exit(1);
if (legacyRuntimeSource.includes('@tauri-apps/api/window') || legacyRuntimeSource.includes('getCurrentWindow')) process.exit(1);
if ((legacyRuntimeSource.match(/invokeClient\.invoke\('/g) || []).length !== 3) process.exit(1);
if ((legacyRuntimeSource.match(/dialogClient\.(?:openFile|openDirectory|saveFile|confirm)\(/g) || []).length !== 4) process.exit(1);
if ((legacyRuntimeSource.match(/documentStoreClient\.(?:save|beginSnapshotUpload|appendSnapshotChunk|commitSnapshotUpload|abortSnapshotUpload|load|loadManifest|readChunk|search|remove)\(/g) || []).length !== 10) process.exit(1);
if ((legacyRuntimeSource.match(/dragDropClient\.subscribe\(/g) || []).length !== 1) process.exit(1);
if ((legacyRuntimeSource.match(/fileSystemClient\.(?:readDroppedFile|listTextFileTree|readLocalImage|getInitialFilePath|writeTextFile|writeBinaryFile)\(/g) || []).length !== 6) process.exit(1);
if ((legacyRuntimeSource.match(/windowClient\.(?:subscribeCloseRequest|startDrag|minimize|toggleMaximize|isMaximized|subscribeResize|requestClose|forceClose)\(/g) || []).length !== 8) process.exit(1);
if (!legacyRuntimeSource.includes('createDocumentStoreClient({ invoke: invokeClient.invoke })')) process.exit(1);
if (!legacyRuntimeSource.includes('createFileSystemClient({ invoke: invokeClient.invoke })')) process.exit(1);
if (legacyRuntimeSource.includes('function bytesToBase64')) process.exit(1);
if (!legacyRuntimeSource.includes("write_performance_logs', { entries }, {}, { record: false }")) process.exit(1);
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
    'invoke-dialog-window-drag-drop-file-system-and-document-store-client-cutovers-are-owned-by-atomic-tasks-3.3-through-3.8'
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
    'invoke-dialog-window-drag-drop-file-system-and-document-store-clients-are-owned-by-atomic-tasks-3.3-through-3.8'
  ]
}, null, 2)}\n`, 'utf8');

await writeFile(`${OUTPUT_DIRECTORY}/03-03-invoke-client-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-03', atomicTask: '3.3', status: 'passed',
  commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'single-measured-tauri-invoke-client', publicEntry: 'src/platform/index.js',
  implementationFiles: [`${DESKTOP_DIRECTORY}/invoke-client.js`],
  productionModuleCount: moduleFixture.modules.length, platformModuleCount: platformModules.length,
  commandDelegationCount: (legacyRuntimeSource.match(/invokeClient\.invoke\('/g) || []).length,
  sample: { calls: invokeCalls, telemetry: invokeTelemetry, errorIdentityPreserved: capturedInvokeError === invokeError },
  guarantees: [
    'single-production-owner-of-tauri-core-invoke-import',
    'command-name-and-argument-object-pass-through-unchanged',
    'native-roundtrip-duration-recorded-for-success-and-error',
    'original-invoke-result-and-error-identity-preserved',
    'telemetry-failures-cannot-replace-native-semantics',
    'performance-log-transport-explicitly-suppresses-recursive-telemetry',
    'three-legacy-runtime-commands-remain-direct-while-six-file-and-ten-document-store-commands-share-the-invoke-transport-through-clients',
    'dialog-window-drag-drop-file-system-and-document-store-clients-are-owned-by-atomic-tasks-3.4-through-3.8'
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
  delegationCount: (legacyRuntimeSource.match(/dialogClient\.(?:openFile|openDirectory|saveFile|confirm)\(/g) || []).length,
  sample: { calls: dialogCalls, results: dialogResults, telemetry: dialogTelemetry },
  guarantees: [
    'single-production-owner-of-tauri-dialog-plugin-import',
    'open-file-open-directory-save-file-and-confirm-have-one-desktop-client',
    'file-and-directory-cancellation-resolve-to-null',
    'confirmation-cancellation-resolves-to-false',
    'save-filename-cleaning-default-path-joining-and-extension-completion-remain-compatible',
    'native-dialog-errors-are-rethrown-with-original-identity',
    'dialog-telemetry-failures-cannot-replace-native-results-or-errors',
    'legacy-runtime-retains-browser-confirm-and-unavailable-null-fallbacks',
    'web-link-and-log-adapters-remain-deferred'
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
  delegationCount: (legacyRuntimeSource.match(/windowClient\.(?:subscribeCloseRequest|startDrag|minimize|toggleMaximize|isMaximized|subscribeResize|requestClose|forceClose)\(/g) || []).length,
  sample: { calls: windowCalls, disposals: windowDisposals, toggledMaximized, maximized },
  guarantees: [
    'single-production-owner-of-tauri-window-api-import',
    'drag-minimize-toggle-maximize-state-query-close-and-force-close-have-one-desktop-client',
    'resize-and-close-request-subscriptions-return-idempotent-owned-disposers',
    'client-destroy-disposes-active-subscriptions-in-reverse-order',
    'late-subscription-results-are-disposed-after-client-destroy',
    'request-close-preserves-close-request-events-while-force-close-preserves-native-destroy-fallback',
    'native-window-results-and-error-identity-remain-unchanged',
    'save-before-close-policy-remains-in-the-application-layer',
    'web-link-and-log-adapters-remain-deferred'
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
  delegationCount: (legacyRuntimeSource.match(/dragDropClient\.subscribe\(/g) || []).length,
  sample: { calls: dragDropCalls.length, events: normalizedDragDropEvents, disposals: dragDropDisposals },
  guarantees: [
    'single-production-owner-of-tauri-webview-drag-drop-import',
    'native-drag-drop-events-normalize-to-immutable-type-paths-and-position-data',
    'file-extension-mime-and-content-type-interpretation-remain-outside-the-drag-drop-client',
    'subscriptions-return-idempotent-owned-disposers',
    'client-destroy-disposes-active-subscriptions-in-reverse-order',
    'late-subscription-results-are-disposed-after-client-destroy',
    'native-registration-cleanup-and-handler-errors-retain-original-semantics',
    'legacy-runtime-preserves-the-existing-payload-wrapper-and-unavailable-null-fallback',
    'web-link-and-log-adapters-remain-deferred'
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
  delegationCount: (legacyRuntimeSource.match(/fileSystemClient\.(?:readDroppedFile|listTextFileTree|readLocalImage|getInitialFilePath|writeTextFile|writeBinaryFile)\(/g) || []).length,
  sample: { calls: fileSystemCalls, results: fileSystemResults },
  guarantees: [
    'exactly-six-existing-rust-local-file-commands-are-mapped',
    'legacy-path-normalization-command-fields-and-telemetry-details-remain-compatible',
    'binary-write-transport-keeps-the-existing-base64-encoding',
    'rust-dropped-file-tree-image-and-write-results-pass-through-without-client-interpretation',
    'rust-remains-the-authority-for-native-path-resolution-file-kind-rules-and-image-mime-generation',
    'file-system-client-does-not-create-documents-insert-images-or-show-toasts',
    'native-file-command-results-and-error-identity-remain-unchanged',
    'legacy-runtime-preserves-six-existing-file-methods-and-runtime-unavailable-fallbacks',
    'web-link-and-log-adapters-remain-deferred'
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
  delegationCount: (legacyRuntimeSource.match(/documentStoreClient\.(?:save|beginSnapshotUpload|appendSnapshotChunk|commitSnapshotUpload|abortSnapshotUpload|load|loadManifest|readChunk|search|remove)\(/g) || []).length,
  sample: { calls: documentStoreCalls, results: documentStoreResults },
  guarantees: [
    'exactly-ten-existing-rust-document-store-commands-are-mapped',
    'save-search-version-and-snapshot-request-objects-preserve-existing-camelcase-fields',
    'snapshot-upload-document-id-upload-id-chunk-and-chunk-index-semantics-remain-compatible',
    'chunk-read-default-and-minimum-byte-normalization-remain-compatible',
    'rust-document-store-results-null-values-and-errors-pass-through-without-client-interpretation',
    'native-document-store-retains-session-version-mismatch-retry-load-cancellation-and-snapshot-policy',
    'legacy-runtime-preserves-ten-existing-document-store-methods-and-unavailable-runtime-fallbacks',
    'only-web-link-and-log-direct-invoke-mappings-remain-for-atomic-task-3.9'
  ]
}, null, 2)}\n`, 'utf8');
