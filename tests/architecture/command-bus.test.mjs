import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../../src/app/create-application.js';
import { createCommandBus } from '../../src/app/commands/command-bus.js';
import {
  CommandNotRegisteredError,
  DuplicateCommandRegistrationError,
  createCommandRegistry
} from '../../src/app/commands/command-registry.js';
import {
  assertCommandId,
  defineCommandIds
} from '../../src/app/commands/command-ids.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('command ID declarations validate names, values, uniqueness and immutability', () => {
  const ids = defineCommandIds({
    DOCUMENT_SAVE: 'document.save',
    LAYOUT_TOGGLE_SIDEBAR: 'layout.toggle-sidebar'
  });

  assert.ok(Object.isFrozen(ids));
  assert.deepEqual(ids, {
    DOCUMENT_SAVE: 'document.save',
    LAYOUT_TOGGLE_SIDEBAR: 'layout.toggle-sidebar'
  });
  assert.equal(assertCommandId('app.open-settings'), 'app.open-settings');
  assert.throws(() => assertCommandId('Save'), /lower-case dotted identifier/);
  assert.throws(() => assertCommandId('save'), /lower-case dotted identifier/);
  assert.throws(
    () => defineCommandIds({ badName: 'document.save' }),
    /upper snake case/
  );
  assert.throws(
    () => defineCommandIds({ A: 'document.save', B: 'document.save' }),
    /declared more than once/
  );
});

test('registry owns one handler per command and unregisters by exact entry identity', () => {
  const registry = createCommandRegistry();
  const firstHandler = () => 'first';
  const unregisterFirst = registry.register('document.save', firstHandler);

  assert.ok(Object.isFrozen(registry));
  assert.equal(registry.size, 1);
  assert.equal(registry.has('document.save'), true);
  assert.strictEqual(registry.resolve('document.save'), firstHandler);
  assert.throws(
    () => registry.register('document.save', () => 'duplicate'),
    error => error instanceof DuplicateCommandRegistrationError &&
      error.commandId === 'document.save'
  );

  assert.equal(unregisterFirst(), true);
  assert.equal(unregisterFirst(), false);
  const unregisterSecond = registry.register('document.save', () => 'second');
  assert.equal(unregisterFirst(), false);
  assert.equal(registry.size, 1);
  assert.equal(unregisterSecond(), true);
  assert.equal(registry.size, 0);
});

test('command bus executes synchronous and asynchronous handlers with the exact payload', async () => {
  const bus = createCommandBus();
  const payload = { documentId: 'doc-1' };
  let receivedPayload;

  bus.register('document.save', input => {
    receivedPayload = input;
    return { status: 'saved' };
  });
  bus.register('document.load', async input => ({ loaded: input.documentId }));

  assert.ok(Object.isFrozen(bus));
  assert.deepEqual(await bus.execute('document.save', payload), { status: 'saved' });
  assert.strictEqual(receivedPayload, payload);
  assert.deepEqual(
    await bus.execute('document.load', payload),
    { loaded: 'doc-1' }
  );
});

test('missing commands reject instead of silently succeeding', async () => {
  const bus = createCommandBus();

  await assert.rejects(bus.execute('document.save'), error => {
    assert.ok(error instanceof CommandNotRegisteredError);
    assert.equal(error.commandId, 'document.save');
    return true;
  });
});

test('handler failures propagate without wrapping or conversion', async () => {
  const bus = createCommandBus();
  const synchronousFailure = new Error('sync failure');
  const asynchronousFailure = new Error('async failure');

  bus.register('document.sync-failure', () => {
    throw synchronousFailure;
  });
  bus.register('document.async-failure', async () => {
    throw asynchronousFailure;
  });

  await assert.rejects(
    bus.execute('document.sync-failure'),
    error => error === synchronousFailure
  );
  await assert.rejects(
    bus.execute('document.async-failure'),
    error => error === asynchronousFailure
  );
});

test('an execution keeps its resolved handler while later executions observe unregister', async () => {
  const bus = createCommandBus();
  let calls = 0;
  const unregister = bus.register('document.save', async payload => {
    calls += 1;
    await Promise.resolve();
    return payload;
  });

  const inFlight = bus.execute('document.save', 'first');
  assert.equal(unregister(), true);
  assert.equal(await inFlight, 'first');
  assert.equal(calls, 1);
  await assert.rejects(
    bus.execute('document.save', 'second'),
    CommandNotRegisteredError
  );
});

test('registry and bus dependency contracts reject invalid inputs', () => {
  const registry = createCommandRegistry();

  assert.throws(
    () => registry.register('document.save', null),
    { name: 'TypeError', message: 'Command handler must be a function.' }
  );
  assert.throws(
    () => createCommandBus(null),
    { name: 'TypeError', message: 'Command bus dependencies must be an object.' }
  );
  assert.throws(
    () => createCommandBus({ registry: {} }),
    /must implement register\(\) and resolve\(\)/
  );
});

test('command bus satisfies the minimal application composition-root port', async () => {
  const calls = [];
  const commands = createCommandBus();
  commands.register('application.ping', payload => {
    calls.push(payload);
    return 'pong';
  });
  const application = createApplication({
    commands,
    events: { subscribe() {}, publish() {} },
    lifecycle: { async start() {}, async destroy() {} }
  });

  assert.strictEqual(application.commands, commands);
  assert.equal(await application.commands.execute('application.ping', 1), 'pong');
  assert.deepEqual(calls, [1]);
});

test('command infrastructure is platform-free and disconnected from the legacy bootstrap', async () => {
  const sources = await Promise.all([
    'command-ids.js',
    'command-registry.js',
    'command-bus.js'
  ].map(file => readFile(resolve(root, 'src/app/commands', file), 'utf8')));
  const legacyBootstrap = await readFile(resolve(root, 'src/main.js'), 'utf8');
  const forbiddenRuntimeAccess = /\b(?:document|window|localStorage|sessionStorage|Worker|SharedWorker|MutationObserver|ResizeObserver|setTimeout|setInterval)\b|@tauri-apps|\binvoke\s*\(/;

  for (const source of sources) {
    assert.doesNotMatch(source, forbiddenRuntimeAccess);
  }
  assert.doesNotMatch(
    legacyBootstrap,
    /(?:import|export)[^;]*app\/commands\/|import\([^)]*app\/commands\//
  );
});
