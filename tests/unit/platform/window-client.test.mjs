import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createWindowClient } from '../../../src/platform/index.js';

function createNativeWindow(log, options = {}) {
  return {
    async startDragging() { log.push('startDragging'); return options.startResult; },
    async minimize() { log.push('minimize'); return options.minimizeResult; },
    async toggleMaximize() { log.push('toggleMaximize'); },
    async isMaximized() { log.push('isMaximized'); return options.maximized ?? true; },
    async onResized(handler) {
      log.push({ method: 'onResized', handler });
      return options.resizeDisposer || (() => log.push('disposeResize'));
    },
    async onCloseRequested(handler) {
      log.push({ method: 'onCloseRequested', handler });
      return options.closeDisposer || (() => log.push('disposeClose'));
    },
    async close() { log.push('close'); return options.closeResult; },
    async destroy() { log.push('destroy'); return options.destroyResult; }
  };
}

test('Atomic Task 3.5 delegates every window operation and preserves return values', async () => {
  const log = [];
  const nativeWindow = createNativeWindow(log, {
    startResult: 'dragged', minimizeResult: 'minimized', maximized: true,
    closeResult: 'closed', destroyResult: 'destroyed'
  });
  const client = createWindowClient({ getCurrentWindow: () => nativeWindow });

  assert.equal(await client.startDrag(), 'dragged');
  assert.equal(await client.minimize(), 'minimized');
  assert.equal(await client.toggleMaximize(), true);
  assert.equal(await client.isMaximized(), true);
  assert.equal(await client.requestClose(), 'closed');
  assert.equal(await client.forceClose(), 'destroyed');
  assert.deepEqual(log, [
    'startDragging', 'minimize', 'toggleMaximize', 'isMaximized',
    'isMaximized', 'close', 'destroy'
  ]);
  assert.ok(Object.isFrozen(client));
});

test('resize and close-request subscriptions preserve handler identity and expose idempotent disposers', async () => {
  const log = [];
  const resizeHandler = () => {};
  const closeHandler = () => {};
  const client = createWindowClient({ getCurrentWindow: () => createNativeWindow(log) });
  const disposeResize = await client.subscribeResize(resizeHandler);
  const disposeClose = await client.subscribeCloseRequest(closeHandler);

  assert.equal(log[0].handler, resizeHandler);
  assert.equal(log[1].handler, closeHandler);
  await disposeResize();
  await disposeResize();
  await disposeClose();
  await disposeClose();
  assert.deepEqual(log.slice(2), ['disposeResize', 'disposeClose']);
});

test('destroy owns active subscriptions, disposes in reverse order and is idempotent', async () => {
  const log = [];
  const client = createWindowClient({ getCurrentWindow: () => createNativeWindow(log) });
  await client.subscribeResize(() => {});
  await client.subscribeCloseRequest(() => {});
  const firstDestroy = client.destroy();
  const secondDestroy = client.destroy();
  assert.equal(firstDestroy, secondDestroy);
  await firstDestroy;
  assert.deepEqual(log.slice(2), ['disposeClose', 'disposeResize']);
  await assert.rejects(client.minimize(), /window client is destroyed/);
  await assert.rejects(client.subscribeResize(() => {}), /window client is destroyed/);
});

test('a subscription resolved after destroy is disposed immediately and never becomes active', async () => {
  let resolveSubscription;
  const log = [];
  const nativeWindow = createNativeWindow(log, {
    resizeDisposer: new Promise(resolve => { resolveSubscription = resolve; })
  });
  const client = createWindowClient({ getCurrentWindow: () => nativeWindow });
  const pending = client.subscribeResize(() => {});
  const destroying = client.destroy();
  resolveSubscription(() => log.push('lateDispose'));
  const lateDisposer = await pending;
  await destroying;
  await lateDisposer();
  assert.deepEqual(log.slice(1), ['lateDispose']);
});

test('native operation and cleanup errors retain their original identity', async () => {
  const operationError = new Error('minimize failed');
  const operationClient = createWindowClient({
    getCurrentWindow: () => ({ minimize: async () => { throw operationError; } })
  });
  await assert.rejects(operationClient.minimize(), error => error === operationError);

  const cleanupError = new Error('cleanup failed');
  const cleanupClient = createWindowClient({
    getCurrentWindow: () => ({ onResized: async () => { return () => { throw cleanupError; }; } })
  });
  await cleanupClient.subscribeResize(() => {});
  await assert.rejects(cleanupClient.destroy(), error => error === cleanupError);
});

test('invalid dependencies, handlers and native subscription results fail at the adapter boundary', async () => {
  assert.throws(() => createWindowClient(null), /options must be an object/);
  assert.throws(() => createWindowClient({ getCurrentWindow: null }), /requires a getCurrentWindow function/);
  const invalidWindow = createWindowClient({ getCurrentWindow: () => null });
  await assert.rejects(invalidWindow.minimize(), /must return a window object/);
  const invalidHandler = createWindowClient({ getCurrentWindow: () => createNativeWindow([]) });
  await assert.rejects(invalidHandler.subscribeResize(null), /handler must be a function/);
  const invalidDisposer = createWindowClient({
    getCurrentWindow: () => ({ onResized: async () => null })
  });
  await assert.rejects(invalidDisposer.subscribeResize(() => {}), /must return a disposer function/);
});

test('the desktop window client is the sole production owner of the Tauri window import', async () => {
  const fixture = JSON.parse(await readFile(
    new URL('../../../tests/architecture/fixtures/production-modules.json', import.meta.url),
    'utf8'
  ));
  const owners = [];
  for (const [path] of fixture.modules) {
    const source = await readFile(new URL('../../../' + path, import.meta.url), 'utf8');
    if (source.includes('@tauri-apps/api/window')) owners.push(path);
  }
  assert.deepEqual(owners, ['src/platform/desktop/window-client.js']);
  const publicEntry = await readFile(new URL('../../../src/platform/index.js', import.meta.url), 'utf8');
  assert.match(publicEntry, /desktop\/window-client\.js/);
});

test('desktop platform keeps every WindowPort method while Atomic 6.13 Window feature becomes the sole application consumer', async () => {
  const [desktop, events, main, controller, closeController] = await Promise.all([
    readFile(new URL('../../../src/platform/desktop/desktop-platform.js', import.meta.url), 'utf8'),
    readFile(new URL('../../../public/app/events.js', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/features/window/window-controller.js', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/features/window/window-close-controller.js', import.meta.url), 'utf8')
  ]);
  assert.match(desktop, /createWindowClient\(/);
  assert.match(desktop, /window: windowClient/);
  for (const method of ['startDrag', 'minimize', 'toggleMaximize', 'isMaximized', 'subscribeResize']) {
    assert.match(controller, new RegExp(`windowPort\\.${method}`));
  }
  for (const method of ['subscribeCloseRequest', 'requestClose', 'forceClose']) {
    assert.match(closeController, new RegExp(`windowPort\\.${method}`));
  }
  assert.match(main, /windowPort: platform\.window/);
  assert.doesNotMatch(events, /call\('window'/);
  assert.doesNotMatch(events, /markdownEditorNative/);
});

test('save-before-close remains in the application CloseSavePort and stays absent from the platform/window orchestration internals', async () => {
  const [clientSource, eventsSource, closeController, closeSavePort, main] = await Promise.all([
    readFile(new URL('../../../src/platform/desktop/window-client.js', import.meta.url), 'utf8'),
    readFile(new URL('../../../public/app/events.js', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/features/window/window-close-controller.js', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/features/window/close-save-port.js', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/main.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(clientSource, /saveCurrentDocumentState|confirmUserAction|close-save|document/);
  assert.match(eventsSource, /eventsCloseSavePort\.register/);
  assert.match(eventsSource, /saveCurrentDocumentState\(false, \{ waitForNative: true, forceSnapshot: true \}\)/);
  assert.match(eventsSource, /confirmUserAction\('关闭前保存失败/);
  assert.match(closeController, /closeSave\.prepareClose\(\)/);
  assert.match(closeController, /event\?\.preventDefault\?\.\(\)/);
  assert.doesNotMatch(closeController, /saveCurrentDocumentState|confirmUserAction|localStorage|sessionStorage/);
  assert.doesNotMatch(closeSavePort, /saveCurrentDocumentState|confirmUserAction|WindowPort|localStorage|sessionStorage/);
  assert.match(main, /mountClassicCloseSavePort\(compatibilityPlatformHost, closeSavePort\)/);
});

test('Stage 3 verification keeps Atomic Task 3.5 after dialog and before drag-drop', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/stage-03-atomic.yml', import.meta.url),
    'utf8'
  );
  const dialogIndex = workflow.indexOf('Verify Atomic Task 3.4 dialog client');
  const windowIndex = workflow.indexOf('Verify Atomic Task 3.5 window client');
  const dragDropIndex = workflow.indexOf('Verify Atomic Task 3.6 drag-drop client');
  assert.ok(dialogIndex >= 0 && windowIndex > dialogIndex && dragDropIndex > windowIndex);
  assert.match(workflow, /node --test tests\/unit\/platform\/window-client\.test\.mjs/);
});
