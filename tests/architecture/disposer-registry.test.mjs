import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DISPOSER_REGISTRY_STATES,
  createDisposerRegistry
} from '../../src/app/disposer-registry.js';
import { createApplicationLifecycle } from '../../src/app/application-lifecycle.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

function deferred() {
  let resolvePromise;
  const promise = new Promise(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

test('registry disposes synchronous and asynchronous resources in strict reverse order', async () => {
  const calls = [];
  const registry = createDisposerRegistry();

  registry.register(() => calls.push('first'));
  registry.register(async () => {
    await Promise.resolve();
    calls.push('second');
  });
  registry.register(() => calls.push('third'));

  assert.ok(Object.isFrozen(registry));
  assert.equal(registry.state, DISPOSER_REGISTRY_STATES.OPEN);
  assert.equal(registry.size, 3);

  await registry.dispose();

  assert.deepEqual(calls, ['third', 'second', 'first']);
  assert.equal(registry.size, 0);
  assert.equal(registry.state, DISPOSER_REGISTRY_STATES.OPEN);
});

test('registered disposer supports early idempotent cleanup and is removed from global disposal', async () => {
  let calls = 0;
  const registry = createDisposerRegistry();
  const disposeResource = registry.register(() => {
    calls += 1;
  });

  await disposeResource();
  await disposeResource();
  await registry.dispose();

  assert.equal(calls, 1);
  assert.equal(registry.size, 0);
});

test('concurrent registry disposal shares one transition and runs each disposer once', async () => {
  const gate = deferred();
  let calls = 0;
  const registry = createDisposerRegistry();
  registry.register(async () => {
    calls += 1;
    await gate.promise;
  });

  const first = registry.dispose();
  const second = registry.dispose();

  assert.equal(registry.state, DISPOSER_REGISTRY_STATES.DISPOSING);
  assert.strictEqual(first, second);
  gate.resolve();
  await first;
  assert.equal(calls, 1);
});

test('cleanup failures do not stop later cleanup and only failed entries are retried', async () => {
  const calls = [];
  const firstFailure = new Error('first cleanup failed');
  const thirdFailure = new Error('third cleanup failed');
  let firstAttempts = 0;
  let thirdAttempts = 0;
  const registry = createDisposerRegistry();

  registry.register(() => {
    firstAttempts += 1;
    calls.push(`first:${firstAttempts}`);
    if (firstAttempts === 1) throw firstFailure;
  });
  registry.register(() => calls.push('second'));
  registry.register(() => {
    thirdAttempts += 1;
    calls.push(`third:${thirdAttempts}`);
    if (thirdAttempts === 1) throw thirdFailure;
  });

  await assert.rejects(registry.dispose(), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [thirdFailure, firstFailure]);
    return true;
  });

  assert.equal(registry.state, DISPOSER_REGISTRY_STATES.FAILED);
  assert.equal(registry.size, 2);
  assert.deepEqual(calls, ['third:1', 'second', 'first:1']);
  assert.throws(
    () => registry.register(() => {}),
    /previous cleanup is incomplete/
  );

  await registry.dispose();

  assert.equal(registry.state, DISPOSER_REGISTRY_STATES.OPEN);
  assert.equal(registry.size, 0);
  assert.deepEqual(calls, ['third:1', 'second', 'first:1', 'third:2', 'first:2']);
});

test('registration is blocked during cleanup and direct disposal cannot violate LIFO order', async () => {
  const gate = deferred();
  const registry = createDisposerRegistry();
  const disposeFirst = registry.register(() => {});
  registry.register(() => gate.promise);

  const disposal = registry.dispose();
  assert.throws(
    () => registry.register(() => {}),
    /disposal is in progress/
  );
  await assert.rejects(
    disposeFirst(),
    /cannot be disposed out of order/
  );

  gate.resolve();
  await disposal;
});

test('registry can own multiple lifecycle generations without accumulating cleanup', async () => {
  const calls = [];
  const registry = createDisposerRegistry();
  let generation = 0;
  const lifecycle = createApplicationLifecycle([{
    async start() {
      generation += 1;
      const current = generation;
      registry.register(() => calls.push(`listener:${current}`));
      registry.register(() => calls.push(`worker:${current}`));
    },
    async destroy() {
      await registry.destroy();
    }
  }]);

  await lifecycle.start();
  await lifecycle.destroy();
  await lifecycle.start();
  await lifecycle.destroy();

  assert.deepEqual(calls, [
    'worker:1', 'listener:1',
    'worker:2', 'listener:2'
  ]);
  assert.equal(registry.size, 0);
});

test('invalid disposer contracts are rejected without changing registry state', () => {
  const registry = createDisposerRegistry();

  assert.throws(
    () => registry.register(null),
    { name: 'TypeError', message: 'Registered disposer must be a function.' }
  );
  assert.equal(registry.size, 0);
  assert.equal(registry.state, DISPOSER_REGISTRY_STATES.OPEN);
});

test('disposer registry remains platform-free and disconnected from the legacy bootstrap', async () => {
  const source = await readFile(resolve(root, 'src/app/disposer-registry.js'), 'utf8');
  const legacyBootstrap = await readFile(resolve(root, 'src/main.js'), 'utf8');
  const forbiddenRuntimeAccess = /\b(?:document|window|localStorage|sessionStorage|Worker|SharedWorker|MutationObserver|ResizeObserver|setTimeout|setInterval)\b|@tauri-apps|\binvoke\s*\(/;

  assert.doesNotMatch(source, forbiddenRuntimeAccess);
  assert.doesNotMatch(legacyBootstrap, /(?:import|export)[^;]*app\/disposer-registry\.js|import\([^)]*app\/disposer-registry\.js/);
});
