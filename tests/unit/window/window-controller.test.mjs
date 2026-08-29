import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowController, createWindowState } from '../../../src/features/window/index.js';

function component(name, log) {
  return {
    start() { log.push(name + '.start'); return true; },
    async destroy() { log.push(name + '.destroy'); }
  };
}

function fixture(options = {}) {
  const log = [];
  const state = createWindowState();
  let resizeHandler = null;
  let resizeDisposed = 0;
  const maximizedValues = [...(options.maximizedValues || [false])];
  const windowPort = {
    async startDrag() { log.push('window.startDrag'); if (options.dragError) throw options.dragError; },
    async minimize() { log.push('window.minimize'); if (options.minimizeError) throw options.minimizeError; },
    async toggleMaximize() {
      log.push('window.toggleMaximize');
      if (options.maximizeError) throw options.maximizeError;
      return options.toggleResult ?? true;
    },
    async isMaximized() {
      log.push('window.isMaximized');
      const value = maximizedValues.length ? maximizedValues.shift() : false;
      return typeof value === 'function' ? value() : await value;
    },
    async subscribeResize(handler) {
      log.push('window.subscribeResize');
      if (options.subscribeError) throw options.subscribeError;
      resizeHandler = handler;
      return async () => { resizeDisposed += 1; resizeHandler = null; log.push('window.disposeResize'); };
    }
  };
  const controlsView = component('controls', log);
  const dragRegion = component('drag', log);
  const closeController = {
    ...component('close', log),
    requestClose(source) { log.push('close.request:' + source); return Promise.resolve({ ok: true, source }); }
  };
  const notifications = [];
  const errors = [];
  const controller = createWindowController({
    state, windowPort, controlsView, dragRegion, closeController,
    supported: options.supported ?? true,
    notify: message => notifications.push(message),
    reportError: (message, error) => errors.push({ message, error })
  });
  return {
    state, log, controller, notifications, errors,
    emitResize() { resizeHandler?.({}); },
    get resizeDisposed() { return resizeDisposed; }
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitUntil(predicate, label) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await settle();
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

test('Atomic 6.13 Window Controller composes controls, close, drag and resize around one WindowState', async () => {
  const f = fixture({ maximizedValues: [true, false] });
  const firstStart = f.controller.start();
  assert.equal(f.controller.start(), firstStart);
  await firstStart;
  assert.equal(f.state.snapshot.available, true);
  assert.equal(f.state.snapshot.maximized, true);
  assert.deepEqual(f.log.slice(0, 5), ['controls.start', 'close.start', 'drag.start', 'window.subscribeResize', 'window.isMaximized']);

  await f.controller.minimize();
  await f.controller.startDrag();
  const toggle = await f.controller.toggleMaximize();
  assert.equal(toggle.maximized, true);
  const close = await f.controller.requestClose('control');
  assert.equal(close.source, 'control');

  f.emitResize();
  await settle();
  assert.equal(f.state.snapshot.maximized, false);
  await f.controller.destroy();
  await f.controller.destroy();
  assert.equal(f.resizeDisposed, 1);
  assert.deepEqual(f.log.slice(-4), ['window.disposeResize', 'drag.destroy', 'close.destroy', 'controls.destroy']);
});

test('unsupported Window Controller projects unavailable state without binding native window lifecycle', async () => {
  const f = fixture({ supported: false });
  await f.controller.start();
  assert.equal(f.state.snapshot.available, false);
  assert.deepEqual(f.log, ['controls.start']);
  assert.equal((await f.controller.minimize()).reason, 'unsupported');
  assert.equal((await f.controller.toggleMaximize()).reason, 'unsupported');
  assert.equal((await f.controller.startDrag()).reason, 'unsupported');
  await f.controller.destroy();
  assert.deepEqual(f.log, ['controls.start', 'drag.destroy', 'close.destroy', 'controls.destroy']);
});

test('Window Controller keeps only the newest maximize refresh and suppresses stale async state writes', async () => {
  let resolveInitial;
  let resolveLatest;
  const f = fixture({
    maximizedValues: [
      () => new Promise(resolve => { resolveInitial = resolve; }),
      () => new Promise(resolve => { resolveLatest = resolve; })
    ]
  });
  const starting = f.controller.start();
  await waitUntil(() => typeof resolveInitial === 'function', 'initial maximize request');
  const latest = f.controller.refreshMaximized('manual');
  await waitUntil(() => typeof resolveLatest === 'function', 'latest maximize request');
  resolveLatest(true);
  const latestResult = await latest;
  assert.equal(latestResult.ok, true);
  assert.equal(f.state.snapshot.maximized, true);
  resolveInitial(false);
  await starting;
  assert.equal(f.state.snapshot.maximized, true);
  await f.controller.destroy();
});

test('Window Controller preserves operation errors as controlled results and user-visible evidence', async () => {
  const minimizeError = new Error('minimize failed');
  const maximizeError = new Error('maximize failed');
  const dragError = new Error('drag failed');
  const f = fixture({ minimizeError, maximizeError, dragError });
  await f.controller.start();
  assert.equal((await f.controller.minimize()).reason, 'minimize-failed');
  assert.equal((await f.controller.toggleMaximize()).reason, 'maximize-failed');
  assert.equal((await f.controller.startDrag()).reason, 'drag-failed');
  assert.deepEqual(f.notifications, ['minimize failed', 'maximize failed']);
  assert.equal(f.errors.at(-1).error, dragError);
  await f.controller.destroy();
});

test('Window Controller controls resize subscription failure and destroy is terminal', async () => {
  const expected = new Error('resize subscribe failed');
  const f = fixture({ subscribeError: expected });
  await f.controller.start();
  assert.equal(f.errors[0].error, expected);
  await f.controller.destroy();
  await assert.rejects(f.controller.minimize(), /destroyed/);
  assert.throws(() => f.controller.start(), /destroyed/);
});

test('late resize subscription cleanup failure is included in Window Controller destroy failure', async () => {
  let resolveSubscription;
  const cleanupError = new Error('late resize cleanup failed');
  const log = [];
  const state = createWindowState();
  const controlsView = component('controls', log);
  const dragRegion = component('drag', log);
  const closeController = {
    ...component('close', log),
    requestClose() { return Promise.resolve({ ok: true }); }
  };
  const controller = createWindowController({
    state,
    supported: true,
    controlsView,
    dragRegion,
    closeController,
    windowPort: {
      async startDrag() {},
      async minimize() {},
      async toggleMaximize() { return false; },
      async isMaximized() { return false; },
      subscribeResize() { return new Promise(resolve => { resolveSubscription = resolve; }); }
    },
    reportError() {}
  });
  const starting = controller.start();
  await waitUntil(() => typeof resolveSubscription === 'function', 'resize subscription acquisition');
  const destroying = controller.destroy();
  resolveSubscription(async () => { throw cleanupError; });
  await assert.rejects(destroying, error => error === cleanupError);
  await assert.rejects(starting, error => error === cleanupError);
});
