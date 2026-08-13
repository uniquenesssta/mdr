import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPreviewWorkerAck,
  createPreviewWorkerMessage
} from '../../../src/features/preview/worker/preview-worker-protocol.js';
import { createPreviewWorkerSession } from '../../../src/features/preview/worker/preview-worker-session.js';

class FakeWorker {
  constructor() {
    this.listeners = new Map([
      ['message', new Set()],
      ['error', new Set()]
    ]);
    this.sent = [];
    this.terminated = false;
  }

  addEventListener(type, listener) {
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message) {
    this.sent.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emitMessage(data) {
    for (const listener of this.listeners.get('message') || []) listener({ data });
  }

  emitError(error) {
    for (const listener of this.listeners.get('error') || []) listener(error);
  }
}

function createHarness() {
  const workers = [];
  const session = createPreviewWorkerSession({
    createWorker() {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }
  });
  return { session, workers };
}

function resetPayload(source = '# title') {
  return {
    source,
    sourceChunks: null,
    forceFull: false,
    indexOnly: false,
    focusLine: 1
  };
}

test('Worker Session owns generation, requestId, initialization and synced version', async () => {
  const { session, workers } = createHarness();
  assert.deepEqual(session.snapshot, {
    generation: 0,
    syncedVersion: 0,
    initialized: false,
    pendingRequests: 0,
    destroyed: false
  });

  const pending = session.request('reset', { version: 7, payload: resetPayload() });
  assert.equal(workers.length, 1);
  const request = workers[0].sent[0];
  assert.equal(request.type, 'reset');
  assert.equal(request.generation, 1);
  assert.equal(request.version, 7);
  assert.equal(request.requestId, 1);

  workers[0].emitMessage(createPreviewWorkerAck(request, { result: { documentVersion: 7 } }));
  const response = await pending;
  assert.equal(response.type, 'ack');
  assert.equal(session.snapshot.initialized, true);
  assert.equal(session.snapshot.syncedVersion, 7);
  assert.equal(session.snapshot.generation, 1);
  assert.equal(session.snapshot.pendingRequests, 0);
});

test('transactions ack advances the single synced version authority', async () => {
  const { session, workers } = createHarness();
  const first = session.request('reset', { version: 3, payload: resetPayload('a') });
  workers[0].emitMessage(createPreviewWorkerAck(workers[0].sent[0]));
  await first;

  const second = session.request('transactions', {
    version: 4,
    payload: { transactions: [{ from: 1, to: 1, insert: 'b' }], forceFull: false, indexOnly: false, focusLine: 1 }
  });
  const transactionRequest = workers[0].sent[1];
  assert.equal(transactionRequest.generation, 1);
  assert.equal(transactionRequest.requestId, 2);
  assert.equal(transactionRequest.version, 4);
  workers[0].emitMessage(createPreviewWorkerAck(transactionRequest));
  await second;
  assert.equal(session.snapshot.syncedVersion, 4);
});

test('stale generation/request responses are discarded and cannot settle the current request', async () => {
  const { session, workers } = createHarness();
  const first = session.request('reset', { version: 1, payload: resetPayload('one') });
  const firstRequest = workers[0].sent[0];
  workers[0].emitMessage(createPreviewWorkerAck(firstRequest));
  await first;

  session.restart(new Error('forced restart'));
  assert.equal(workers[0].terminated, true);
  assert.equal(session.snapshot.generation, 2);
  assert.equal(session.snapshot.initialized, false);
  assert.equal(session.snapshot.syncedVersion, 0);

  const current = session.request('reset', { version: 2, payload: resetPayload('two') });
  assert.equal(workers.length, 2);
  const currentRequest = workers[1].sent[0];
  assert.equal(currentRequest.generation, 2);
  assert.equal(currentRequest.requestId, 2);

  let settled = false;
  current.finally(() => { settled = true; });
  workers[1].emitMessage(createPreviewWorkerAck(firstRequest));
  await Promise.resolve();
  assert.equal(settled, false);

  const wrongRequest = createPreviewWorkerMessage('reset', {
    generation: currentRequest.generation,
    version: currentRequest.version,
    requestId: currentRequest.requestId + 100
  }, resetPayload('stale'));
  workers[1].emitMessage(createPreviewWorkerAck(wrongRequest));
  await Promise.resolve();
  assert.equal(settled, false);

  workers[1].emitMessage(createPreviewWorkerAck(currentRequest));
  await current;
  assert.equal(session.snapshot.syncedVersion, 2);
});

test('worker errors restart the session, reject pending work and require a fresh generation', async () => {
  const { session, workers } = createHarness();
  const pending = session.request('reset', { version: 5, payload: resetPayload() });
  const failure = new Error('worker crashed');
  workers[0].emitError(failure);
  await assert.rejects(pending, /worker crashed/);
  assert.equal(workers[0].terminated, true);
  assert.equal(session.snapshot.generation, 2);
  assert.equal(session.snapshot.initialized, false);
  assert.equal(session.snapshot.syncedVersion, 0);

  const retry = session.request('reset', { version: 6, payload: resetPayload('retry') });
  assert.equal(workers.length, 2);
  assert.equal(workers[1].sent[0].generation, 2);
  workers[1].emitMessage(createPreviewWorkerAck(workers[1].sent[0]));
  await retry;
});

test('destroy terminates the worker, rejects pending work and forbids future requests', async () => {
  const { session, workers } = createHarness();
  const pending = session.request('reset', { version: 8, payload: resetPayload() });
  session.destroy();
  await assert.rejects(pending, /destroyed/i);
  assert.equal(workers[0].terminated, true);
  assert.equal(session.snapshot.destroyed, true);
  assert.equal(session.snapshot.pendingRequests, 0);
  await assert.rejects(
    session.request('reset', { version: 9, payload: resetPayload() }),
    /destroyed/i
  );
});
