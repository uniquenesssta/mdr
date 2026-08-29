import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIFECYCLE_STATES,
  createApplicationLifecycle
} from '../../src/app/lifecycle/application-lifecycle.js';
import { runShutdownSequence } from '../../src/app/lifecycle/shutdown-sequence.js';
import { runStartupSequence } from '../../src/app/lifecycle/startup-sequence.js';
import { createApplication } from '../../src/app/create-application.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function participant(name, calls, overrides = {}) {
  return {
    name,
    async start(context) {
      calls.push(`start:${name}:${context?.id}`);
      await overrides.start?.(context);
    },
    async destroy(context) {
      calls.push(`destroy:${name}:${context?.id}`);
      await overrides.destroy?.(context);
    }
  };
}

test('lifecycle starts in order, destroys in reverse order and supports restart', async () => {
  const calls = [];
  const context = { id: 'ctx' };
  const lifecycle = createApplicationLifecycle([
    participant('a', calls),
    participant('b', calls),
    participant('c', calls)
  ]);

  assert.ok(Object.isFrozen(lifecycle));
  assert.equal(lifecycle.state, LIFECYCLE_STATES.CREATED);

  await lifecycle.start(context);
  assert.equal(lifecycle.state, LIFECYCLE_STATES.STARTED);
  await lifecycle.start(context);
  assert.equal(calls.length, 3);
  await lifecycle.destroy(context);
  assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
  await lifecycle.destroy(context);
  assert.equal(calls.length, 6);
  await lifecycle.start(context);
  await lifecycle.destroy(context);

  assert.deepEqual(calls, [
    'start:a:ctx', 'start:b:ctx', 'start:c:ctx',
    'destroy:c:ctx', 'destroy:b:ctx', 'destroy:a:ctx',
    'start:a:ctx', 'start:b:ctx', 'start:c:ctx',
    'destroy:c:ctx', 'destroy:b:ctx', 'destroy:a:ctx'
  ]);
});

test('concurrent start and destroy calls share the active transition', async () => {
  const startGate = deferred();
  const destroyGate = deferred();
  let starts = 0;
  let destroys = 0;
  const lifecycle = createApplicationLifecycle([{
    async start() {
      starts += 1;
      await startGate.promise;
    },
    async destroy() {
      destroys += 1;
      await destroyGate.promise;
    }
  }]);

  const firstStart = lifecycle.start({ id: 'ctx' });
  const secondStart = lifecycle.start({ id: 'ctx' });
  assert.equal(lifecycle.state, LIFECYCLE_STATES.STARTING);
  assert.strictEqual(firstStart, secondStart);
  startGate.resolve();
  await firstStart;
  assert.equal(starts, 1);

  const firstDestroy = lifecycle.destroy();
  const secondDestroy = lifecycle.destroy();
  assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPING);
  assert.strictEqual(firstDestroy, secondDestroy);
  destroyGate.resolve();
  await firstDestroy;
  assert.equal(destroys, 1);
});

test('startup failure rolls back successful participants in reverse order', async () => {
  const calls = [];
  const failure = new Error('b failed');
  const lifecycle = createApplicationLifecycle([
    participant('a', calls),
    participant('b', calls, { start() { throw failure; } }),
    participant('c', calls)
  ]);

  await assert.rejects(lifecycle.start({ id: 'ctx' }), error => error === failure);
  assert.equal(lifecycle.state, LIFECYCLE_STATES.CREATED);
  assert.deepEqual(calls, ['start:a:ctx', 'start:b:ctx', 'destroy:a:ctx']);
});

test('incomplete startup rollback enters failed state and destroy retries remaining cleanup', async () => {
  const calls = [];
  const startFailure = new Error('start failed');
  const rollbackFailure = new Error('rollback failed');
  let rollbackAttempts = 0;
  const lifecycle = createApplicationLifecycle([
    participant('a', calls, {
      destroy() {
        rollbackAttempts += 1;
        if (rollbackAttempts === 1) throw rollbackFailure;
      }
    }),
    participant('b', calls, { start() { throw startFailure; } })
  ]);

  await assert.rejects(lifecycle.start({ id: 'ctx' }), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [startFailure, rollbackFailure]);
    return true;
  });
  assert.equal(lifecycle.state, LIFECYCLE_STATES.FAILED);
  await assert.rejects(lifecycle.start({ id: 'ctx' }), /cleanup is incomplete/);

  await lifecycle.destroy({ id: 'ctx' });
  assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
  assert.equal(rollbackAttempts, 2);
});

test('shutdown continues in reverse order, aggregates errors and retries only failed cleanup', async () => {
  const calls = [];
  const bFailure = new Error('b destroy failed');
  let bAttempts = 0;
  const lifecycle = createApplicationLifecycle([
    participant('a', calls),
    participant('b', calls, {
      destroy() {
        bAttempts += 1;
        if (bAttempts === 1) throw bFailure;
      }
    }),
    participant('c', calls)
  ]);

  await lifecycle.start({ id: 'ctx' });
  await assert.rejects(lifecycle.destroy({ id: 'ctx' }), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [bFailure]);
    return true;
  });
  assert.equal(lifecycle.state, LIFECYCLE_STATES.FAILED);
  assert.deepEqual(calls.slice(3), ['destroy:c:ctx', 'destroy:b:ctx', 'destroy:a:ctx']);

  await lifecycle.destroy({ id: 'ctx' });
  assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
  assert.equal(bAttempts, 2);
  assert.equal(calls.at(-1), 'destroy:b:ctx');
});

test('destroy requested during startup waits and then releases resources', async () => {
  const gate = deferred();
  const calls = [];
  const lifecycle = createApplicationLifecycle([
    participant('a', calls, { start: () => gate.promise })
  ]);

  const startPromise = lifecycle.start({ id: 'ctx' });
  const destroyPromise = lifecycle.destroy({ id: 'ctx' });
  gate.resolve();
  await Promise.all([startPromise, destroyPromise]);

  assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
  assert.deepEqual(calls, ['start:a:ctx', 'destroy:a:ctx']);
});

test('start requested during shutdown waits and starts a new lifecycle generation', async () => {
  const gate = deferred();
  const calls = [];
  let destroyCount = 0;
  const lifecycle = createApplicationLifecycle([
    participant('a', calls, {
      destroy() {
        destroyCount += 1;
        if (destroyCount === 1) return gate.promise;
      }
    })
  ]);

  await lifecycle.start({ id: 'first' });
  const destroyPromise = lifecycle.destroy({ id: 'first' });
  const restartPromise = lifecycle.start({ id: 'second' });
  gate.resolve();
  await Promise.all([destroyPromise, restartPromise]);

  assert.equal(lifecycle.state, LIFECYCLE_STATES.STARTED);
  assert.deepEqual(calls, ['start:a:first', 'destroy:a:first', 'start:a:second']);
  await lifecycle.destroy({ id: 'second' });
});

test('participant collection and contracts are validated', () => {
  assert.throws(
    () => createApplicationLifecycle({}),
    { name: 'TypeError', message: 'Lifecycle participants must be an array.' }
  );
  assert.throws(
    () => createApplicationLifecycle([{}]),
    {
      name: 'TypeError',
      message: 'Lifecycle participant at index 0 must implement start() and destroy().'
    }
  );
});

test('lifecycle port integrates with the minimal application composition root', async () => {
  const calls = [];
  const lifecycle = createApplicationLifecycle([
    participant('module', calls)
  ]);
  const application = createApplication({
    commands: { register() {}, async execute() {} },
    events: { subscribe() {}, publish() {} },
    lifecycle
  });

  await application.start();
  assert.equal(lifecycle.state, LIFECYCLE_STATES.STARTED);
  await application.destroy();
  assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
  assert.deepEqual(calls, ['start:module:undefined', 'destroy:module:undefined']);
});


test('lifecycle exposes the exact taskbook state contract and destroy-before-start reaches stopped', async () => {
  assert.deepEqual(Object.values(LIFECYCLE_STATES), [
    'created', 'starting', 'started', 'stopping', 'stopped', 'failed'
  ]);
  const lifecycle = createApplicationLifecycle([]);
  assert.equal(lifecycle.state, LIFECYCLE_STATES.CREATED);
  await lifecycle.destroy();
  assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
  await lifecycle.start();
  assert.equal(lifecycle.state, LIFECYCLE_STATES.STARTED);
  await lifecycle.destroy();
  assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
});

test('startup rollback restores the prior stable state for a failed restart', async () => {
  let starts = 0;
  const lifecycle = createApplicationLifecycle([{
    async start() {
      starts += 1;
      if (starts === 2) throw new Error('restart failed');
    },
    async destroy() {}
  }]);

  await lifecycle.start();
  await lifecycle.destroy();
  assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
  await assert.rejects(lifecycle.start(), /restart failed/);
  assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
});

test('startup and shutdown sequence modules are independently testable and preserve caller-owned state', async () => {
  const calls = [];
  const active = [];
  const participants = [participant('a', calls), participant('b', calls)];

  await runStartupSequence(participants, active, { id: 'ctx' });
  assert.deepEqual(active, participants);
  assert.deepEqual(calls, ['start:a:ctx', 'start:b:ctx']);

  const errors = await runShutdownSequence(active, { id: 'ctx' });
  assert.deepEqual(errors, []);
  assert.deepEqual(active, []);
  assert.deepEqual(calls, [
    'start:a:ctx', 'start:b:ctx', 'destroy:b:ctx', 'destroy:a:ctx'
  ]);
});
