import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
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
  createPlatformPortSet,
  defineDialogsPort,
  defineDragDropPort,
  defineStoragePort
} from '../../../src/platform/index.js';

const EXPECTED_PORT_METHODS = Object.freeze({
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

function createImplementation(methods, options = {}) {
  const calls = [];
  const implementation = {};
  for (const method of methods) {
    implementation[method] = function (...args) {
      calls.push({ method, args, receiver: this });
      if (options.results && method in options.results) {
        const result = options.results[method];
        return typeof result === 'function' ? result(...args) : result;
      }
      return Object.freeze({ method, args });
    };
  }
  if (options.destroy) implementation.destroy = options.destroy;
  return { implementation, calls };
}

function createPortImplementations(order = []) {
  const implementations = {};
  for (const name of PLATFORM_PORT_NAMES) {
    const methods = EXPECTED_PORT_METHODS[name];
    const { implementation } = createImplementation(methods, {
      results: {
        subscribe: () => () => order.push(`${name}:unsubscribe`),
        subscribeResize: () => () => order.push(`${name}:resize-unsubscribe`),
        subscribeCloseRequest: () => () => order.push(`${name}:close-unsubscribe`)
      },
      destroy: () => order.push(`${name}:destroy`)
    });
    implementations[name] = implementation;
  }
  return implementations;
}

test('Atomic Task 3.1 exposes the exact business-neutral platform port surface', async () => {
  assert.deepEqual(PLATFORM_PORT_NAMES, [
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
  assert.ok(Object.isFrozen(PLATFORM_PORT_NAMES));

  const platformRoot = new URL('../../../src/platform/', import.meta.url);
  const portFiles = await readdir(new URL('ports/', platformRoot));
  assert.deepEqual(portFiles.sort(), [
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

  for (const file of ['index.js', ...portFiles.map(name => `ports/${name}`)]) {
    const source = await readFile(new URL(file, platformRoot), 'utf8');
    assert.doesNotMatch(source, /@tauri|__TAURI|markdownEditorNative|getCurrentWindow|getCurrentWebview/);
    assert.doesNotMatch(source, /\bwindow\.|\bdocument\.|\blocalStorage\b|\bnavigator\./);
  }
});

test('Stage 3 verification keeps the 3.1 contract before later platform checks', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/stage-03-atomic.yml', import.meta.url),
    'utf8'
  );
  assert.match(workflow, /Verify Atomic Task 3\.1 platform ports/);
  assert.match(workflow, /node --test tests\/unit\/platform\/platform-ports\.test\.mjs/);
  const portsIndex = workflow.indexOf('Verify Atomic Task 3.1 platform ports');
  const detectionIndex = workflow.indexOf('Verify Atomic Task 3.2 capability detection');
  const invokeIndex = workflow.indexOf('Verify Atomic Task 3.3 invoke client');
  const dialogIndex = workflow.indexOf('Verify Atomic Task 3.4 dialog client');
  assert.ok(portsIndex >= 0 && detectionIndex > portsIndex && invokeIndex > detectionIndex && dialogIndex > invokeIndex);
  assert.match(workflow, /node --test tests\/unit\/platform\/invoke-client\.test\.mjs/);
  assert.match(workflow, /node --test tests\/unit\/platform\/dialog-client\.test\.mjs/);
  assert.match(workflow, /node --test tests\/unit\/platform\/window-client\.test\.mjs/);
  assert.match(workflow, /scripts\/verify-architecture\.mjs --output=artifacts\/stage-03\/03-05-architecture-scan\.json/);
  assert.match(workflow, /scripts\/stage-03\/record-platform-evidence\.mjs/);
  assert.doesNotMatch(workflow, /Atomic Task 3\.[6-9]|Atomic Task 3\.1[0-9]/);
});

test('the frozen legacy capability inventory maps every old native method to declared ports', async () => {
  const inventory = JSON.parse(await readFile(
    new URL('./fixtures/platform-port-inventory.json', import.meta.url),
    'utf8'
  ));
  assert.equal(inventory.schemaVersion, 1);

  const legacySource = await readFile(
    new URL('../../../src/runtime/tauri.js', import.meta.url),
    'utf8'
  );
  const nativeBody = legacySource
    .split('window.markdownEditorNative = {', 2)[1]
    .split(/\n};\s*$/, 1)[0];
  const legacyMethods = [...nativeBody.matchAll(/^  (?:async )?([A-Za-z_$][\w$]*)\s*\(/gm)]
    .map(match => match[1])
    .sort();
  assert.deepEqual(Object.keys(inventory.legacyNativeMethods).sort(), legacyMethods);

  const declaredTargets = new Set();
  for (const [portName, methods] of Object.entries(EXPECTED_PORT_METHODS)) {
    for (const method of methods) declaredTargets.add(`${portName}.${method}`);
  }
  for (const targetList of [
    ...Object.values(inventory.legacyNativeMethods),
    ...Object.values(inventory.browserSurfaces)
  ]) {
    assert.ok(Array.isArray(targetList) && targetList.length > 0);
    for (const target of targetList) {
      assert.ok(declaredTargets.has(target), `Unknown platform target: ${target}`);
    }
  }
});

test('individual port definitions validate, bind and freeze one exact responsibility', () => {
  const { implementation, calls } = createImplementation(STORAGE_PORT_METHODS);
  implementation.extraRuntimeDetail = () => 'hidden';
  const port = defineStoragePort(implementation);

  assert.ok(Object.isFrozen(port));
  assert.deepEqual(Object.keys(port), [...STORAGE_PORT_METHODS, 'destroy']);
  assert.deepEqual(port.get('theme'), { method: 'get', args: ['theme'] });
  assert.equal(calls[0].receiver, implementation);
  assert.equal(port.extraRuntimeDetail, undefined);

  assert.throws(
    () => defineStoragePort({ get() {}, set() {}, remove() {} }),
    /storage.*clear\(\)/
  );
  assert.throws(() => defineStoragePort(null), /storage.*implementation must be an object/);
});

test('dialog cancellation values, arguments and error identity pass through unchanged', async () => {
  const failure = new Error('dialog failed');
  const { implementation, calls } = createImplementation(DIALOGS_PORT_METHODS, {
    results: {
      openFile: null,
      openDirectory: null,
      saveFile: (preferredName, options) => ({ preferredName, options }),
      confirm: () => { throw failure; }
    }
  });
  const port = defineDialogsPort(implementation);

  assert.equal(await port.openFile({ title: 'Open' }), null);
  assert.equal(await port.openDirectory({ title: 'Directory' }), null);
  const options = Object.freeze({ extension: 'md' });
  assert.deepEqual(await port.saveFile('note', options), { preferredName: 'note', options });
  assert.throws(() => port.confirm('Delete?'), error => error === failure);
  assert.deepEqual(calls.map(call => call.method), ['openFile', 'openDirectory', 'saveFile', 'confirm']);
});

test('subscription ports require disposers and own idempotent reverse cleanup', async () => {
  const cleanup = [];
  const port = defineDragDropPort({
    subscribe(handler) {
      assert.equal(typeof handler, 'function');
      cleanup.push('subscribed');
      return () => cleanup.push('unsubscribed');
    },
    destroy() {
      cleanup.push('implementation-destroyed');
    }
  });

  const dispose = port.subscribe(() => {});
  assert.equal(typeof dispose, 'function');
  await port.destroy();
  await port.destroy();
  await dispose();
  assert.deepEqual(cleanup, ['subscribed', 'unsubscribed', 'implementation-destroyed']);
  assert.throws(() => port.subscribe(() => {}), /dragDrop.*destroyed/);

  const invalid = defineDragDropPort({ subscribe: () => null });
  assert.throws(() => invalid.subscribe(() => {}), /must return a disposer function/);
});

test('a subscription resolved after destroy is disposed immediately and never becomes active', async () => {
  const cleanup = [];
  let resolveSubscription;
  const port = defineDragDropPort({
    subscribe() {
      return new Promise(resolve => { resolveSubscription = resolve; });
    },
    destroy() {
      cleanup.push('implementation-destroyed');
    }
  });

  const pending = port.subscribe(() => {});
  const destroying = port.destroy();
  resolveSubscription(() => cleanup.push('late-unsubscribe'));
  const dispose = await pending;
  await destroying;
  await dispose();

  assert.deepEqual(cleanup, ['late-unsubscribe', 'implementation-destroyed']);
});

test('platform port set exposes one immutable aggregate and destroys ports in reverse order', async () => {
  const order = [];
  const platform = createPlatformPortSet(createPortImplementations(order));
  assert.ok(Object.isFrozen(platform));
  assert.deepEqual(Object.keys(platform), [...PLATFORM_PORT_NAMES, 'destroy']);

  const resizeDisposer = platform.window.subscribeResize(() => {});
  const closeDisposer = platform.window.subscribeCloseRequest(() => {});
  const dragDisposer = platform.dragDrop.subscribe(() => {});
  const fullscreenDisposer = platform.fullscreen.subscribe(() => {});
  assert.equal(typeof resizeDisposer, 'function');
  assert.equal(typeof closeDisposer, 'function');
  assert.equal(typeof dragDisposer, 'function');
  assert.equal(typeof fullscreenDisposer, 'function');

  await platform.destroy();
  await platform.destroy();

  assert.deepEqual(order, [
    'print:destroy',
    'fullscreen:unsubscribe',
    'fullscreen:destroy',
    'clipboard:destroy',
    'logs:destroy',
    'links:destroy',
    'web:destroy',
    'documentStore:destroy',
    'dragDrop:unsubscribe',
    'dragDrop:destroy',
    'window:close-unsubscribe',
    'window:resize-unsubscribe',
    'window:destroy',
    'dialogs:destroy',
    'files:destroy',
    'storage:destroy'
  ]);
});

test('platform port set rejects every missing implementation at the public boundary', () => {
  for (const missing of PLATFORM_PORT_NAMES) {
    const implementations = createPortImplementations();
    delete implementations[missing];
    assert.throws(
      () => createPlatformPortSet(implementations),
      new RegExp(`Platform port "${missing}" implementation must be an object`)
    );
  }
});
