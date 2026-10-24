import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloseSavePort } from '../../../src/features/window/index.js';

test('Atomic 6.13 CloseSavePort delegates one explicit boolean close-save policy', async () => {
  const port = createCloseSavePort();
  const calls = [];
  const unregister = port.register(async () => { calls.push('prepare'); return true; });
  assert.equal(port.registered, true);
  assert.equal(await port.prepareClose(), true);
  assert.deepEqual(calls, ['prepare']);
  assert.throws(() => port.register(() => true), /already registered/);
  unregister();
  unregister();
  assert.equal(port.registered, false);
  await assert.rejects(port.prepareClose(), /handler is unavailable/);
});

test('CloseSavePort preserves cancellation, handler errors and rejects ambiguous handler results', async () => {
  const cancelled = createCloseSavePort();
  cancelled.register(() => false);
  assert.equal(await cancelled.prepareClose(), false);

  const expected = new Error('save failed');
  const failing = createCloseSavePort();
  failing.register(async () => { throw expected; });
  await assert.rejects(failing.prepareClose(), error => error === expected);

  const malformed = createCloseSavePort();
  malformed.register(() => undefined);
  await assert.rejects(malformed.prepareClose(), /must resolve to a boolean/);
});

test('R16-08 explicit CloseSave registration releases only its own policy', async () => {
  const closeSave = createCloseSavePort();
  const unregister = closeSave.register(() => true);
  assert.equal(closeSave.registered, true);
  assert.equal(await closeSave.prepareClose(), true);
  unregister();
  assert.equal(closeSave.registered, false);
  closeSave.register(() => false);
  unregister();
  assert.equal(closeSave.registered, true);
  assert.equal(await closeSave.prepareClose(), false);
  closeSave.destroy();
});

test('CloseSavePort destroy is idempotent and terminal', async () => {
  const port = createCloseSavePort();
  port.register(() => true);
  port.destroy();
  port.destroy();
  assert.throws(() => port.registered, /destroyed/);
  assert.throws(() => port.register(() => true), /destroyed/);
  await assert.rejects(port.prepareClose(), /destroyed/);
});
