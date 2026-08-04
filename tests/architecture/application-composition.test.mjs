import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../../src/app/create-application.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

function createValidDependencies(overrides = {}) {
  const commands = {
    register() {
      return () => {};
    },
    async execute() {}
  };
  const events = {
    subscribe() {
      return () => {};
    },
    publish() {}
  };
  const lifecycle = {
    async start() {},
    async destroy() {}
  };

  return { commands, events, lifecycle, ...overrides };
}

function withForbiddenGlobalAccess(callback) {
  const names = ['document', 'window', 'localStorage', 'sessionStorage', 'Worker', 'SharedWorker'];
  const descriptors = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new Error(`Composition root accessed forbidden global: ${name}`);
      }
    });
  }

  try {
    return callback();
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('createApplication constructs a frozen public API without starting any dependency', () => {
  const calls = [];
  const dependencies = createValidDependencies({
    commands: {
      register() {
        calls.push('commands.register');
        return () => {};
      },
      async execute() {
        calls.push('commands.execute');
      }
    },
    events: {
      subscribe() {
        calls.push('events.subscribe');
        return () => {};
      },
      publish() {
        calls.push('events.publish');
      }
    },
    lifecycle: {
      async start() {
        calls.push('lifecycle.start');
      },
      async destroy() {
        calls.push('lifecycle.destroy');
      }
    }
  });

  const application = withForbiddenGlobalAccess(() => createApplication(dependencies));

  assert.deepEqual(calls, []);
  assert.ok(Object.isFrozen(application));
  assert.deepEqual(Object.keys(application).sort(), ['commands', 'destroy', 'events', 'start']);
  assert.strictEqual(application.commands, dependencies.commands);
  assert.strictEqual(application.events, dependencies.events);
});

test('application lifecycle methods delegate through the same immutable context', async () => {
  const observations = [];
  const dependencies = createValidDependencies();
  dependencies.lifecycle = {
    async start(context) {
      observations.push({ phase: 'start', context, receiver: this });
    },
    async destroy(context) {
      observations.push({ phase: 'destroy', context, receiver: this });
    }
  };

  const application = createApplication(dependencies);
  const startResult = await application.start();
  const destroyResult = await application.destroy();

  assert.equal(startResult, undefined);
  assert.equal(destroyResult, undefined);
  assert.deepEqual(observations.map(item => item.phase), ['start', 'destroy']);
  assert.strictEqual(observations[0].context, observations[1].context);
  assert.ok(Object.isFrozen(observations[0].context));
  assert.deepEqual(Object.keys(observations[0].context).sort(), ['commands', 'events', 'lifecycle']);
  assert.strictEqual(observations[0].context.commands, dependencies.commands);
  assert.strictEqual(observations[0].context.events, dependencies.events);
  assert.strictEqual(observations[0].context.lifecycle, dependencies.lifecycle);
  assert.strictEqual(observations[0].receiver, dependencies.lifecycle);
  assert.strictEqual(observations[1].receiver, dependencies.lifecycle);
});

test('createApplication rejects missing or malformed architecture ports', () => {
  assert.throws(
    () => createApplication(),
    { name: 'TypeError', message: 'Application dependencies must be an object.' }
  );

  const cases = [
    ['commands', {}, 'Application dependency "commands" must implement register() and execute().'],
    ['events', {}, 'Application dependency "events" must implement subscribe() and publish().'],
    ['lifecycle', {}, 'Application dependency "lifecycle" must implement start() and destroy().']
  ];

  for (const [name, value, message] of cases) {
    assert.throws(
      () => createApplication(createValidDependencies({ [name]: value })),
      { name: 'TypeError', message }
    );
  }
});

test('lifecycle failures propagate without translation or fallback behavior', async () => {
  const startFailure = new Error('start failed');
  const destroyFailure = new Error('destroy failed');
  const application = createApplication(createValidDependencies({
    lifecycle: {
      async start() {
        throw startFailure;
      },
      async destroy() {
        throw destroyFailure;
      }
    }
  }));

  await assert.rejects(application.start(), error => error === startFailure);
  await assert.rejects(application.destroy(), error => error === destroyFailure);
});

test('composition modules remain platform-free and disconnected from the legacy bootstrap', async () => {
  const applicationContext = await readFile(resolve(root, 'src/app/application-context.js'), 'utf8');
  const compositionRoot = await readFile(resolve(root, 'src/app/create-application.js'), 'utf8');
  const legacyBootstrap = await readFile(resolve(root, 'src/main.js'), 'utf8');
  const forbiddenRuntimeAccess = /\b(?:document|window|localStorage|sessionStorage|Worker|SharedWorker)\b|@tauri-apps|\binvoke\s*\(/;

  assert.doesNotMatch(applicationContext, forbiddenRuntimeAccess);
  assert.doesNotMatch(compositionRoot, forbiddenRuntimeAccess);
  assert.doesNotMatch(legacyBootstrap, /(?:import|export)[^;]*app\/create-application\.js|import\([^)]*app\/create-application\.js/);
});
