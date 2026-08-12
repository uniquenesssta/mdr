import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowCloseController, createWindowState } from '../../../src/features/window/index.js';

function fixture(options = {}) {
  const state = createWindowState({ available: true });
  const calls = [];
  let closeHandler = null;
  let disposed = 0;
  let releasePrepare = null;
  const closeSave = {
    async prepareClose() {
      calls.push('prepare');
      if (options.pendingPrepare) return new Promise(resolve => { releasePrepare = resolve; });
      if (options.prepareError) throw options.prepareError;
      return options.allowed ?? true;
    }
  };
  const windowPort = {
    async subscribeCloseRequest(handler) {
      calls.push('subscribeClose');
      if (options.subscribeError) throw options.subscribeError;
      closeHandler = handler;
      return async () => { disposed += 1; closeHandler = null; };
    },
    async requestClose() {
      calls.push('requestClose');
      if (options.requestError) throw options.requestError;
    },
    async forceClose() {
      calls.push('forceClose');
      if (options.forceError) throw options.forceError;
    }
  };
  const notifications = [];
  const records = [];
  const errors = [];
  const controller = createWindowCloseController({
    state,
    windowPort,
    closeSave,
    supported: options.supported ?? true,
    notify: message => notifications.push(message),
    record: (operation, entry) => records.push({ operation, entry }),
    reportError: (message, error) => errors.push({ message, error })
  });
  return {
    state, calls, controller, notifications, records, errors,
    nativeClose(event = { prevented: false, preventDefault() { this.prevented = true; } }) { closeHandler?.(event); return event; },
    releasePrepare(value) { releasePrepare?.(value); },
    get disposed() { return disposed; }
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test('Atomic 6.13 Window Close Controller delegates control close through CloseSavePort before WindowPort close', async () => {
  const f = fixture();
  assert.equal(f.controller.start(), true);
  assert.equal(f.controller.start(), false);
  await settle();
  const result = await f.controller.requestClose('control');
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'closed');
  assert.deepEqual(f.calls, ['subscribeClose', 'prepare', 'requestClose']);
  assert.equal(f.state.snapshot.closePhase, 'committed');
  await f.controller.destroy();
  assert.equal(f.disposed, 1);
});

test('native close is prevented before save and concurrent close requests are coalesced while saving', async () => {
  const f = fixture({ pendingPrepare: true });
  f.controller.start();
  await settle();
  const nativeEvent = f.nativeClose();
  await settle();
  assert.equal(nativeEvent.prevented, true);
  assert.equal(f.state.snapshot.closePhase, 'saving');
  const busy = await f.controller.requestClose('control');
  assert.equal(busy.reason, 'busy');
  assert.equal(f.calls.filter(call => call === 'prepare').length, 1);
  f.releasePrepare(true);
  await settle();
  await settle();
  assert.equal(f.state.snapshot.closePhase, 'committed');
  assert.equal(f.calls.filter(call => call === 'requestClose').length, 1);
  await f.controller.destroy();
});

test('CloseSavePort cancellation returns WindowState to idle without touching WindowPort close', async () => {
  const f = fixture({ allowed: false });
  f.controller.start();
  await settle();
  const result = await f.controller.requestClose();
  assert.equal(result.reason, 'cancelled');
  assert.equal(f.state.snapshot.closePhase, 'idle');
  assert.deepEqual(f.calls, ['subscribeClose', 'prepare']);
  await f.controller.destroy();
});

test('requestClose failure falls back to forceClose while preserving committed close state', async () => {
  const f = fixture({ requestError: new Error('close failed') });
  f.controller.start();
  await settle();
  const result = await f.controller.requestClose();
  assert.deepEqual(f.calls, ['subscribeClose', 'prepare', 'requestClose', 'forceClose']);
  assert.equal(result.ok, true);
  assert.equal(result.forced, true);
  assert.equal(f.state.snapshot.closePhase, 'committed');
  await f.controller.destroy();
});

test('double WindowPort close failure resets state and preserves notification, telemetry and error evidence', async () => {
  const closeError = new Error('close failed');
  const forceError = new Error('destroy failed');
  const f = fixture({ requestError: closeError, forceError });
  f.controller.start();
  await settle();
  const result = await f.controller.requestClose();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'close-failed');
  assert.equal(f.state.snapshot.closePhase, 'idle');
  assert.equal(f.notifications[0], '关闭窗口失败：destroy failed');
  assert.equal(f.records[0].operation, 'window.close-error');
  assert.equal(f.errors[0].message, 'Window close failed:');
  assert.ok(result.error instanceof AggregateError);
  await f.controller.destroy();
});

test('close-save and subscription failures are controlled, and destroy suppresses late close work', async () => {
  const saveError = new Error('save policy failed');
  const save = fixture({ prepareError: saveError });
  save.controller.start();
  await settle();
  const result = await save.controller.requestClose();
  assert.equal(result.reason, 'close-save-failed');
  assert.equal(save.state.snapshot.closePhase, 'idle');
  assert.equal(save.errors[0].error, saveError);
  await save.controller.destroy();

  const subscribeError = new Error('subscribe failed');
  const subscription = fixture({ subscribeError });
  subscription.controller.start();
  await settle();
  assert.equal(subscription.records[0].operation, 'window.close-handler-error');
  await subscription.controller.destroy();
  await subscription.controller.destroy();
  await assert.rejects(subscription.controller.requestClose(), /destroyed/);
});

test('late close subscription cleanup failure is surfaced by destroy instead of being swallowed', async () => {
  let resolveSubscription;
  const cleanupError = new Error('late close cleanup failed');
  const state = createWindowState({ available: true });
  const controller = createWindowCloseController({
    state,
    supported: true,
    closeSave: { async prepareClose() { return true; } },
    windowPort: {
      subscribeCloseRequest() { return new Promise(resolve => { resolveSubscription = resolve; }); },
      async requestClose() {},
      async forceClose() {}
    },
    reportError() {}
  });
  controller.start();
  await settle();
  const destroying = controller.destroy();
  resolveSubscription(async () => { throw cleanupError; });
  await assert.rejects(destroying, error => error === cleanupError);
});

test('unsupported Window Close Controller neither subscribes nor invokes close-save/window operations', async () => {
  const f = fixture({ supported: false });
  f.controller.start();
  const result = await f.controller.requestClose();
  assert.equal(result.reason, 'unsupported');
  assert.deepEqual(f.calls, []);
  await f.controller.destroy();
});
