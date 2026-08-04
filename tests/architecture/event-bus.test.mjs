import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../../src/app/create-application.js';
import {
  EventBusDestroyedError,
  InvalidEventPayloadError,
  createEventBus
} from '../../src/app/events/event-bus.js';
import {
  assertEventType,
  defineEventTypes
} from '../../src/app/events/event-types.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('event type declarations validate names, values, uniqueness and immutability', () => {
  const types = defineEventTypes({
    DOCUMENT_CHANGED: 'document.changed',
    LAYOUT_SIDEBAR_TOGGLED: 'layout.sidebar-toggled'
  });

  assert.ok(Object.isFrozen(types));
  assert.deepEqual(types, {
    DOCUMENT_CHANGED: 'document.changed',
    LAYOUT_SIDEBAR_TOGGLED: 'layout.sidebar-toggled'
  });
  assert.equal(assertEventType('app.started'), 'app.started');
  assert.throws(() => assertEventType('Changed'), /lower-case dotted identifier/);
  assert.throws(() => assertEventType('changed'), /lower-case dotted identifier/);
  assert.throws(
    () => defineEventTypes({ badName: 'document.changed' }),
    /upper snake case/
  );
  assert.throws(
    () => defineEventTypes({ A: 'document.changed', B: 'document.changed' }),
    /declared more than once/
  );
});

test('publish sends one deeply immutable snapshot without freezing publisher-owned data', () => {
  const failures = [];
  const bus = createEventBus({
    onListenerError(error, context) {
      failures.push({ error, context });
    }
  });
  const source = { document: { title: 'Draft', tags: ['one'] } };
  const received = [];

  bus.subscribe('document.changed', payload => {
    received.push(payload);
    payload.document.title = 'mutated';
  });
  bus.subscribe('document.changed', payload => {
    received.push(payload);
    assert.equal(payload.document.title, 'Draft');
  });

  assert.equal(bus.publish('document.changed', source), undefined);
  assert.equal(Object.isFrozen(source), false);
  assert.equal(Object.isFrozen(source.document), false);
  assert.equal(Object.isFrozen(received[0]), true);
  assert.equal(Object.isFrozen(received[0].document), true);
  assert.equal(Object.isFrozen(received[0].document.tags), true);
  assert.notStrictEqual(received[0], source);
  assert.strictEqual(received[0], received[1]);
  assert.deepEqual(source, { document: { title: 'Draft', tags: ['one'] } });
  assert.equal(failures.length, 1);
  assert.ok(failures[0].error instanceof TypeError);
  assert.equal(failures[0].context.type, 'document.changed');
  assert.strictEqual(failures[0].context.payload, received[0]);
  assert.ok(Object.isFrozen(failures[0].context));
});

test('subscription disposers are exact and idempotent', () => {
  const bus = createEventBus({ onListenerError() {} });
  const calls = [];
  const listener = payload => calls.push(payload);
  const unsubscribeFirst = bus.subscribe('document.changed', listener);

  assert.equal(unsubscribeFirst(), true);
  assert.equal(unsubscribeFirst(), false);
  const unsubscribeSecond = bus.subscribe('document.changed', listener);
  assert.equal(unsubscribeFirst(), false);
  bus.publish('document.changed', 1);
  assert.deepEqual(calls, [1]);
  assert.equal(unsubscribeSecond(), true);
  bus.publish('document.changed', 2);
  assert.deepEqual(calls, [1]);
});

test('once removes its listener before invocation and prevents recursive re-entry', () => {
  const bus = createEventBus({ onListenerError() {} });
  const calls = [];

  bus.once('document.changed', payload => {
    calls.push(payload.step);
    bus.publish('document.changed', { step: 2 });
  });
  bus.publish('document.changed', { step: 1 });
  bus.publish('document.changed', { step: 3 });

  assert.deepEqual(calls, [1]);
});

test('synchronous listener failures are isolated and listener return values are ignored', () => {
  const failure = new Error('listener failed');
  const reported = [];
  const calls = [];
  const bus = createEventBus({
    onListenerError(error, context) {
      reported.push({ error, context });
    }
  });

  bus.subscribe('document.changed', () => {
    calls.push('first');
    throw failure;
  });
  bus.subscribe('document.changed', () => {
    calls.push('second');
    return 'response-must-not-escape';
  });

  assert.equal(bus.publish('document.changed', { revision: 1 }), undefined);
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(reported.length, 1);
  assert.strictEqual(reported[0].error, failure);
  assert.equal(reported[0].context.type, 'document.changed');
});

test('asynchronous listener rejections are isolated and reported', async () => {
  const failure = new Error('async listener failed');
  let resolveReport;
  const report = new Promise(resolve => {
    resolveReport = resolve;
  });
  const bus = createEventBus({
    onListenerError(error, context) {
      resolveReport({ error, context });
    }
  });

  bus.subscribe('document.changed', async () => {
    throw failure;
  });

  assert.equal(bus.publish('document.changed', { revision: 2 }), undefined);
  const reported = await report;
  assert.strictEqual(reported.error, failure);
  assert.equal(reported.context.type, 'document.changed');
  assert.deepEqual(reported.context.payload, { revision: 2 });
});

test('publish observes a stable listener snapshot and current active state', () => {
  const bus = createEventBus({ onListenerError() {} });
  const calls = [];
  let unsubscribeSecond;

  bus.subscribe('document.changed', () => {
    calls.push('first');
    unsubscribeSecond();
    bus.subscribe('document.changed', () => calls.push('late'));
  });
  unsubscribeSecond = bus.subscribe('document.changed', () => calls.push('second'));

  bus.publish('document.changed');
  assert.deepEqual(calls, ['first']);
  bus.publish('document.changed');
  assert.deepEqual(calls, ['first', 'first', 'late']);
});

test('destroy is idempotent, clears subscriptions and blocks later use', () => {
  const bus = createEventBus({ onListenerError() {} });
  const calls = [];
  const unsubscribe = bus.subscribe('document.changed', () => calls.push('called'));

  assert.equal(bus.destroy(), true);
  assert.equal(bus.destroy(), false);
  assert.equal(unsubscribe(), false);
  assert.deepEqual(calls, []);
  assert.throws(
    () => bus.subscribe('document.changed', () => {}),
    EventBusDestroyedError
  );
  assert.throws(
    () => bus.once('document.changed', () => {}),
    EventBusDestroyedError
  );
  assert.throws(
    () => bus.publish('document.changed', {}),
    EventBusDestroyedError
  );
});

test('event payloads reject functions, platform objects, accessors and symbol keys', () => {
  const bus = createEventBus({ onListenerError() {} });
  const withAccessor = {};
  Object.defineProperty(withAccessor, 'value', {
    enumerable: true,
    get() {
      return 1;
    }
  });
  const withSymbolKey = { [Symbol('hidden')]: 1 };

  assert.throws(
    () => bus.publish('document.changed', { callback() {} }),
    InvalidEventPayloadError
  );
  assert.throws(
    () => bus.publish('document.changed', { createdAt: new Date() }),
    InvalidEventPayloadError
  );
  assert.throws(
    () => bus.publish('document.changed', withAccessor),
    InvalidEventPayloadError
  );
  assert.throws(
    () => bus.publish('document.changed', withSymbolKey),
    InvalidEventPayloadError
  );
});

test('event bus dependency, listener and event-type contracts reject invalid inputs', () => {
  assert.throws(
    () => createEventBus(null),
    { name: 'TypeError', message: 'Event bus dependencies must be an object.' }
  );
  assert.throws(
    () => createEventBus({ onListenerError: null }),
    { name: 'TypeError', message: 'Event listener error reporter must be a function.' }
  );

  const bus = createEventBus({ onListenerError() {} });
  assert.throws(
    () => bus.subscribe('document.changed', null),
    { name: 'TypeError', message: 'Event listener must be a function.' }
  );
  assert.throws(
    () => bus.once('changed', () => {}),
    /lower-case dotted identifier/
  );
  assert.throws(
    () => bus.publish('Changed', {}),
    /lower-case dotted identifier/
  );
});

test('event bus supports cyclic plain-data payloads as immutable snapshots', () => {
  const bus = createEventBus({ onListenerError() {} });
  const source = { name: 'root' };
  source.self = source;
  let received;
  bus.subscribe('document.changed', payload => {
    received = payload;
  });

  bus.publish('document.changed', source);
  assert.notStrictEqual(received, source);
  assert.strictEqual(received.self, received);
  assert.ok(Object.isFrozen(received));
});

test('event bus satisfies the minimal application composition-root port', () => {
  const events = createEventBus({ onListenerError() {} });
  const received = [];
  events.subscribe('application.pinged', payload => received.push(payload));
  const application = createApplication({
    commands: { register() {}, async execute() {} },
    events,
    lifecycle: { async start() {}, async destroy() {} }
  });

  assert.strictEqual(application.events, events);
  assert.equal(application.events.publish('application.pinged', { value: 1 }), undefined);
  assert.deepEqual(received, [{ value: 1 }]);
});

test('event infrastructure is platform-free and disconnected from the legacy bootstrap', async () => {
  const sources = await Promise.all([
    'event-types.js',
    'event-bus.js'
  ].map(file => readFile(resolve(root, 'src/app/events', file), 'utf8')));
  const legacyBootstrap = await readFile(resolve(root, 'src/main.js'), 'utf8');
  const forbiddenRuntimeAccess = /\bdocument\s*(?:\[|\.\s*(?:querySelector|querySelectorAll|getElementById|getElementsByClassName|getElementsByName|getElementsByTagName|createElement|createTextNode|addEventListener|removeEventListener|body|documentElement|activeElement|visibilityState|readyState))|\b(?:window|localStorage|sessionStorage|Worker|SharedWorker|MutationObserver|ResizeObserver|setTimeout|setInterval)\b|@tauri-apps|\binvoke\s*\(/;

  assert.match('document.querySelector("main")', forbiddenRuntimeAccess);
  assert.doesNotMatch("'document.changed'", forbiddenRuntimeAccess);
  for (const source of sources) {
    assert.doesNotMatch(source, forbiddenRuntimeAccess);
  }
  assert.doesNotMatch(
    legacyBootstrap,
    /(?:import|export)[^;]*app\/events\/|import\([^)]*app\/events\//
  );
});
