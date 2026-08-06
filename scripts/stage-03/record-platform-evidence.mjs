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
  createRuntimeCapabilities,
  detectPlatformEnvironment
} from '../../src/platform/index.js';

const OUTPUT_DIRECTORY = 'artifacts/stage-03';
const PLATFORM_ROOT = 'src/platform';
const PORT_DIRECTORY = `${PLATFORM_ROOT}/ports`;
const ENVIRONMENT_DIRECTORY = `${PLATFORM_ROOT}/environment`;
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
  'storage',
  'files',
  'dialogs',
  'window',
  'dragDrop',
  'documentStore',
  'web',
  'links',
  'logs',
  'clipboard',
  'fullscreen',
  'print'
]);
const expectedPortFiles = Object.freeze([
  'clipboard-port.js',
  'dialogs-port.js',
  'document-store-port.js',
  'drag-drop-port.js',
  'files-port.js',
  'fullscreen-port.js',
  'index.js',
  'links-port.js',
  'logs-port.js',
  'platform-port-set.js',
  'port-contract.js',
  'print-port.js',
  'storage-port.js',
  'web-port.js',
  'window-port.js'
]);
const expectedEnvironmentFiles = Object.freeze([
  'platform-detection.js',
  'runtime-capabilities.js'
]);

function createBrowserRuntime() {
  class Element {}
  Element.prototype.requestFullscreen = async () => {};
  return {
    localStorage: {
      getItem() {},
      setItem() {},
      removeItem() {},
      clear() {}
    },
    FileReader: class FileReader {},
    URL: {
      createObjectURL() {},
      revokeObjectURL() {}
    },
    Element,
    document: {
      fullscreenEnabled: true,
      createElement() {},
      execCommand() {},
      exitFullscreen() {},
      addEventListener() {}
    },
    navigator: { clipboard: { writeText() {} } },
    fetch() {},
    open() {},
    print() {},
    confirm() {}
  };
}

const inventory = JSON.parse(await readFile(INVENTORY_PATH, 'utf8'));
const moduleFixture = JSON.parse(await readFile(MODULE_FIXTURE_PATH, 'utf8'));
const portFiles = (await readdir(PORT_DIRECTORY)).sort();
const environmentFiles = (await readdir(ENVIRONMENT_DIRECTORY)).sort();
const portSources = await Promise.all([
  ...portFiles.map(file => readFile(`${PORT_DIRECTORY}/${file}`, 'utf8'))
]);
const environmentSources = Object.fromEntries(await Promise.all(
  environmentFiles.map(async file => [file, await readFile(`${ENVIRONMENT_DIRECTORY}/${file}`, 'utf8')])
));
const legacyRuntimeSource = await readFile(LEGACY_RUNTIME_PATH, 'utf8');
const platformModules = moduleFixture.modules
  .filter(record => String(record[0]).startsWith('src/platform/'))
  .map(record => record[0])
  .sort();
const legacyNativeTargets = Object.values(inventory.legacyNativeMethods).flat();
const browserTargets = Object.values(inventory.browserSurfaces).flat();
const declaredTargets = new Set(
  Object.entries(methodsByPort).flatMap(([portName, methods]) => (
    methods.map(method => `${portName}.${method}`)
  ))
);
const sentinelOwners = [];
for (const [path] of moduleFixture.modules) {
  const source = await readFile(path, 'utf8');
  if (source.includes('__TAURI_INTERNALS__')) sentinelOwners.push(path);
}

const browserRuntime = createBrowserRuntime();
const desktopRuntime = { ...createBrowserRuntime(), __TAURI_INTERNALS__: {} };
const browserEnvironment = detectPlatformEnvironment(browserRuntime);
const desktopEnvironment = detectPlatformEnvironment(desktopRuntime);
const browserCapabilities = createRuntimeCapabilities(browserEnvironment, browserRuntime);
const desktopCapabilities = createRuntimeCapabilities(desktopEnvironment, desktopRuntime);

if (JSON.stringify(PLATFORM_PORT_NAMES) !== JSON.stringify(expectedPortNames)) process.exit(1);
if (JSON.stringify(portFiles) !== JSON.stringify(expectedPortFiles)) process.exit(1);
if (JSON.stringify(environmentFiles) !== JSON.stringify(expectedEnvironmentFiles)) process.exit(1);
if (moduleFixture.modules.length !== 157 || platformModules.length !== 18) process.exit(1);
if (Object.keys(inventory.legacyNativeMethods).length !== 33) process.exit(1);
if (Object.keys(inventory.browserSurfaces).length !== 13) process.exit(1);
if ([...legacyNativeTargets, ...browserTargets].some(target => !declaredTargets.has(target))) process.exit(1);
if (portSources.some(source => /@tauri|__TAURI|markdownEditorNative|getCurrentWindow|getCurrentWebview/.test(source))) process.exit(1);
if (portSources.some(source => /\bwindow\.|\bdocument\.|\blocalStorage\b|\bnavigator\./.test(source))) process.exit(1);
if (sentinelOwners.length !== 1 || sentinelOwners[0] !== 'src/platform/environment/platform-detection.js') process.exit(1);
if (!environmentSources['platform-detection.js'].includes('__TAURI_INTERNALS__')) process.exit(1);
if (/@tauri|__TAURI|\binvoke\s*\(/.test(environmentSources['runtime-capabilities.js'])) process.exit(1);
if (/\bwindow\.|\bdocument\.|\bnavigator\./.test(environmentSources['runtime-capabilities.js'])) process.exit(1);
if (!legacyRuntimeSource.includes("from '../platform/index.js'")) process.exit(1);
if (!legacyRuntimeSource.includes('isAvailable = capabilities.desktop.invoke')) process.exit(1);
if (legacyRuntimeSource.includes('__TAURI_INTERNALS__')) process.exit(1);
if (browserEnvironment.kind !== 'browser' || desktopEnvironment.kind !== 'desktop') process.exit(1);
if (!Object.isFrozen(browserEnvironment) || !Object.isFrozen(desktopEnvironment)) process.exit(1);
if (!Object.isFrozen(browserCapabilities) || !Object.isFrozen(browserCapabilities.browser) || !Object.isFrozen(browserCapabilities.desktop)) process.exit(1);
if (!Object.isFrozen(desktopCapabilities) || !Object.values(desktopCapabilities.desktop).every(Boolean)) process.exit(1);

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
await writeFile(`${OUTPUT_DIRECTORY}/03-01-platform-ports-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-01',
  atomicTask: '3.1',
  status: 'passed',
  commit: process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'business-neutral-platform-port-contracts',
  publicEntry: 'src/platform/index.js',
  portCount: PLATFORM_PORT_NAMES.length,
  ports: Object.fromEntries(
    PLATFORM_PORT_NAMES.map(name => [name, [...methodsByPort[name]]])
  ),
  implementationFiles: [
    'src/platform/index.js',
    ...portFiles.map(file => `${PORT_DIRECTORY}/${file}`)
  ],
  productionModuleCount: moduleFixture.modules.length,
  platformModuleCount: platformModules.length,
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
    'no-production-caller-cutover-to-new-port-adapters-in-atomic-task-3.2'
  ]
}, null, 2)}\n`, 'utf8');

await writeFile(`${OUTPUT_DIRECTORY}/03-02-runtime-capabilities-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-02',
  atomicTask: '3.2',
  status: 'passed',
  commit: process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'immutable-runtime-environment-and-capability-detection',
  publicEntry: 'src/platform/index.js',
  implementationFiles: environmentFiles.map(file => `${ENVIRONMENT_DIRECTORY}/${file}`),
  productionModuleCount: moduleFixture.modules.length,
  platformModuleCount: platformModules.length,
  sentinelOwners,
  environments: {
    browser: browserEnvironment,
    desktop: desktopEnvironment
  },
  capabilitySnapshots: {
    browser: browserCapabilities,
    desktop: desktopCapabilities
  },
  guarantees: [
    'one-authoritative-tauri-sentinel-owner',
    'runtime-kind-detection-separated-from-platform-behavior',
    'deeply-immutable-environment-and-capability-snapshots',
    'guarded-browser-surface-probes-do-not-execute-behavior',
    'missing-or-inaccessible-runtime-surfaces-degrade-to-false-capabilities',
    'legacy-runtime-availability-derived-from-public-capabilities',
    'no-production-business-module-checks-tauri-internals',
    'existing-native-method-contracts-and-command-fields-remain-unchanged',
    'invoke-and-runtime-adapter-rewrite-remain-deferred-to-atomic-task-3.3-and-later'
  ]
}, null, 2)}\n`, 'utf8');
