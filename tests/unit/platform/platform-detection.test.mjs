import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createRuntimeCapabilities,
  detectPlatformEnvironment,
  PLATFORM_ENVIRONMENTS
} from '../../../src/platform/index.js';

function createBrowserRuntime(overrides = {}) {
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
    confirm() {},
    ...overrides
  };
}

test('Atomic Task 3.2 detects one immutable browser or desktop environment snapshot', () => {
  const browserHost = {};
  const browser = detectPlatformEnvironment(browserHost);
  assert.deepEqual(browser, {
    kind: PLATFORM_ENVIRONMENTS.BROWSER,
    isDesktop: false,
    isBrowser: true
  });
  assert.ok(Object.isFrozen(browser));

  const desktopHost = { __TAURI_INTERNALS__: { invoke() {} } };
  const desktop = detectPlatformEnvironment(desktopHost);
  assert.deepEqual(desktop, {
    kind: PLATFORM_ENVIRONMENTS.DESKTOP,
    isDesktop: true,
    isBrowser: false
  });
  assert.ok(Object.isFrozen(desktop));

  desktopHost.__TAURI_INTERNALS__ = null;
  assert.equal(desktop.isDesktop, true, 'the detected environment must remain a snapshot');
});

test('invalid or inaccessible runtime hosts safely resolve to the browser environment', () => {
  for (const runtime of [null, undefined, 0, '', false]) {
    const detected = detectPlatformEnvironment(runtime);
    assert.equal(detected.kind, PLATFORM_ENVIRONMENTS.BROWSER);
  }

  const runtime = {};
  Object.defineProperty(runtime, '__TAURI_INTERNALS__', {
    get() { throw new Error('blocked'); }
  });
  assert.equal(detectPlatformEnvironment(runtime).kind, PLATFORM_ENVIRONMENTS.BROWSER);
});

test('capabilities are a deeply immutable snapshot separated from runtime behavior', () => {
  const runtime = createBrowserRuntime();
  const environment = detectPlatformEnvironment(runtime);
  const capabilities = createRuntimeCapabilities(environment, runtime);

  assert.deepEqual(capabilities, {
    runtime: 'browser',
    isDesktop: false,
    isBrowser: true,
    desktop: {
      invoke: false,
      dialogs: false,
      window: false,
      dragDrop: false,
      fileSystem: false,
      documentStore: false,
      webFetch: false,
      externalLinks: false,
      performanceLogs: false
    },
    browser: {
      storage: true,
      fileRead: true,
      fileDownload: true,
      clipboard: true,
      fullscreen: true,
      print: true,
      webFetch: true,
      externalLinks: true,
      confirm: true
    }
  });
  assert.ok(Object.isFrozen(capabilities));
  assert.ok(Object.isFrozen(capabilities.desktop));
  assert.ok(Object.isFrozen(capabilities.browser));

  runtime.fetch = null;
  runtime.navigator.clipboard = null;
  assert.equal(capabilities.browser.webFetch, true);
  assert.equal(capabilities.browser.clipboard, true);
});

test('desktop capabilities derive only from the detected environment while browser probes stay explicit', () => {
  const runtime = createBrowserRuntime({ __TAURI_INTERNALS__: {} });
  const capabilities = createRuntimeCapabilities(detectPlatformEnvironment(runtime), runtime);
  assert.equal(capabilities.runtime, 'desktop');
  assert.ok(Object.values(capabilities.desktop).every(Boolean));
  assert.ok(Object.values(capabilities.browser).every(Boolean));
});

test('capability probes isolate missing and throwing browser surfaces without executing behavior', () => {
  let calls = 0;
  const runtime = {
    get localStorage() { throw new Error('storage denied'); },
    get navigator() { throw new Error('navigator denied'); },
    get document() { throw new Error('document denied'); },
    get URL() { throw new Error('URL denied'); },
    fetch() { calls += 1; },
    open() { calls += 1; },
    print() { calls += 1; },
    confirm() { calls += 1; }
  };
  const capabilities = createRuntimeCapabilities(detectPlatformEnvironment(runtime), runtime);
  assert.deepEqual(capabilities.browser, {
    storage: false,
    fileRead: false,
    fileDownload: false,
    clipboard: false,
    fullscreen: false,
    print: true,
    webFetch: true,
    externalLinks: true,
    confirm: true
  });
  assert.equal(calls, 0, 'capability detection must not execute runtime behavior');
});

test('invalid manually assembled environments are rejected', () => {
  assert.throws(() => createRuntimeCapabilities(null, {}), /platform environment must be an object/);
  assert.throws(
    () => createRuntimeCapabilities({ kind: 'desktop', isDesktop: false, isBrowser: true }, {}),
    /detected browser or desktop snapshot/
  );
});

test('the Tauri sentinel has one production owner and legacy runtime consumes the public entry', async () => {
  const platformRoot = new URL('../../../src/platform/', import.meta.url);
  const detectionSource = await readFile(new URL('environment/platform-detection.js', platformRoot), 'utf8');
  const capabilitySource = await readFile(new URL('environment/runtime-capabilities.js', platformRoot), 'utf8');
  const platformIndexSource = await readFile(new URL('index.js', platformRoot), 'utf8');
  const legacyRuntimeSource = await readFile(new URL('../../../src/runtime/tauri.js', import.meta.url), 'utf8');

  const moduleFixture = JSON.parse(await readFile(
    new URL('../../../tests/architecture/fixtures/production-modules.json', import.meta.url),
    'utf8'
  ));
  const sentinelOwners = [];
  for (const [path] of moduleFixture.modules) {
    const source = await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
    if (source.includes('__TAURI_INTERNALS__')) sentinelOwners.push(path);
  }

  assert.deepEqual(sentinelOwners, ['src/platform/environment/platform-detection.js']);
  assert.match(detectionSource, /__TAURI_INTERNALS__/);
  assert.doesNotMatch(capabilitySource, /__TAURI_INTERNALS__|@tauri|\binvoke\s*\(/);
  assert.doesNotMatch(capabilitySource, /\bwindow\.|\bdocument\.|\bnavigator\./);
  assert.match(platformIndexSource, /environment\/platform-detection\.js/);
  assert.match(platformIndexSource, /environment\/runtime-capabilities\.js/);
  assert.match(legacyRuntimeSource, /from '\.\.\/platform\/index\.js'/);
  assert.match(legacyRuntimeSource, /createRuntimeCapabilities\(platformEnvironment, window\)/);
  assert.match(legacyRuntimeSource, /isAvailable = capabilities\.desktop\.invoke/);
  assert.doesNotMatch(legacyRuntimeSource, /__TAURI_INTERNALS__/);
});

test('Stage 3 verification keeps Atomic Task 3.2 before later platform checks', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/stage-03-atomic.yml', import.meta.url),
    'utf8'
  );
  const detectionIndex = workflow.indexOf('Verify Atomic Task 3.2 capability detection');
  const invokeIndex = workflow.indexOf('Verify Atomic Task 3.3 invoke client');
  const dialogIndex = workflow.indexOf('Verify Atomic Task 3.4 dialog client');
  const windowIndex = workflow.indexOf('Verify Atomic Task 3.5 window client');
  const dragDropIndex = workflow.indexOf('Verify Atomic Task 3.6 drag-drop client');
  const fileSystemIndex = workflow.indexOf('Verify Atomic Task 3.7 file-system client');
  const documentStoreIndex = workflow.indexOf('Verify Atomic Task 3.8 document-store client');
  const architectureIndex = workflow.indexOf('Run architecture hard gate');
  assert.ok(detectionIndex >= 0 && invokeIndex > detectionIndex && dialogIndex > invokeIndex && windowIndex > dialogIndex && dragDropIndex > windowIndex && fileSystemIndex > dragDropIndex && documentStoreIndex > fileSystemIndex && architectureIndex > documentStoreIndex);
  assert.match(workflow, /node --test tests\/unit\/platform\/platform-detection\.test\.mjs/);
  assert.match(workflow, /03-08-architecture-scan\.json/);
  assert.doesNotMatch(workflow, /Atomic Task 3\.9|Atomic Task 3\.1[0-9]/);
});
