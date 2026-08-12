import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloseSavePort, mountClassicCloseSavePort } from '../../../src/features/window/index.js';

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

test('Classic CloseSavePort exposes registration only and cleans the registration with its host property', async () => {
  const host = {};
  const closeSave = createCloseSavePort();
  const classic = mountClassicCloseSavePort(host, closeSave);
  assert.deepEqual(Object.keys(host.markdownEditorCloseSavePort), ['register']);
  assert.equal(host.markdownEditorCloseSavePort.register(() => true), true);
  assert.equal(closeSave.registered, true);
  assert.throws(() => mountClassicCloseSavePort(host, closeSave), /already mounted/);
  classic.destroy();
  classic.destroy();
  assert.equal(host.markdownEditorCloseSavePort, undefined);
  assert.equal(closeSave.registered, false);
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
