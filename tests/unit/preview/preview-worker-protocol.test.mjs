import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PREVIEW_WORKER_MESSAGE_TYPES,
  createPreviewWorkerAck,
  createPreviewWorkerError,
  createPreviewWorkerMessage,
  parsePreviewWorkerMessage
} from '../../../src/features/preview/worker/preview-worker-protocol.js';

const envelope = Object.freeze({ generation: 3, version: 17, requestId: 41 });

function createReset(overrides = {}) {
  return createPreviewWorkerMessage('reset', envelope, {
    source: '# title',
    sourceChunks: null,
    forceFull: false,
    indexOnly: false,
    focusLine: 1,
    ...overrides
  });
}

test('Atomic 7.5 exposes exactly the seven taskbook Worker Protocol message types', () => {
  assert.deepEqual(
    Object.values(PREVIEW_WORKER_MESSAGE_TYPES).sort(),
    ['ack', 'cancel', 'error', 'focus', 'render-window', 'reset', 'transactions'].sort()
  );
});

test('every Worker Protocol message carries generation version and requestId', () => {
  const samples = [
    createReset(),
    createPreviewWorkerMessage('transactions', envelope, { transactions: [] }),
    createPreviewWorkerMessage('render-window', envelope, { ids: ['block-1'] }),
    createPreviewWorkerMessage('focus', envelope, { focusLine: 9 }),
    createPreviewWorkerMessage('cancel', envelope, { targetRequestId: 40 }),
    createPreviewWorkerMessage('ack', envelope, { acknowledges: 'reset', result: {} }),
    createPreviewWorkerMessage('error', envelope, { operation: 'reset', code: 'FAIL', message: 'failed' })
  ];

  for (const message of samples) {
    assert.equal(message.generation, envelope.generation);
    assert.equal(message.version, envelope.version);
    assert.equal(message.requestId, envelope.requestId);
    assert.equal(parsePreviewWorkerMessage(message), message);
  }
});

test('protocol rejects missing or malformed correlation metadata and unknown message types', () => {
  const valid = createReset();
  for (const field of ['generation', 'version', 'requestId']) {
    const broken = { ...valid };
    delete broken[field];
    assert.throws(() => parsePreviewWorkerMessage(broken), new RegExp(field, 'i'));
  }

  assert.throws(
    () => parsePreviewWorkerMessage({ ...valid, generation: -1 }),
    /generation/i
  );
  assert.throws(
    () => parsePreviewWorkerMessage({ ...valid, version: 1.5 }),
    /version/i
  );
  assert.throws(
    () => parsePreviewWorkerMessage({ ...valid, requestId: 0 }),
    /requestId/i
  );
  assert.throws(
    () => parsePreviewWorkerMessage({ ...valid, type: 'result' }),
    /type/i
  );
});

test('protocol validates task-specific payload contracts without owning session state', () => {
  assert.throws(
    () => createPreviewWorkerMessage('reset', envelope, { source: null, sourceChunks: null }),
    /reset/i
  );
  assert.throws(
    () => createPreviewWorkerMessage('transactions', envelope, { transactions: null }),
    /transactions/i
  );
  assert.throws(
    () => createPreviewWorkerMessage('render-window', envelope, {}),
    /render-window/i
  );
  assert.throws(
    () => createPreviewWorkerMessage('focus', envelope, { focusLine: 0 }),
    /focus/i
  );
  assert.throws(
    () => createPreviewWorkerMessage('cancel', envelope, { targetRequestId: 0 }),
    /cancel/i
  );
  assert.throws(
    () => createPreviewWorkerMessage('ack', envelope, { acknowledges: 'ack' }),
    /ack/i
  );
  assert.throws(
    () => createPreviewWorkerMessage('error', envelope, { operation: 'reset', message: '' }),
    /error/i
  );
});

test('protocol constructors do not let payload override message identity or correlation metadata', () => {
  const message = createPreviewWorkerMessage('reset', envelope, {
    source: '# title',
    type: 'error',
    generation: 999,
    version: 999,
    requestId: 999
  });
  assert.equal(message.type, 'reset');
  assert.equal(message.generation, envelope.generation);
  assert.equal(message.version, envelope.version);
  assert.equal(message.requestId, envelope.requestId);

  const ack = createPreviewWorkerAck(message, { acknowledges: 'cancel', result: {} });
  assert.equal(ack.acknowledges, 'reset');
});

test('ack and error preserve the exact request correlation envelope', () => {
  const request = createPreviewWorkerMessage('transactions', envelope, { transactions: [] });
  const ack = createPreviewWorkerAck(request, { result: { changedIds: [] } });
  const error = createPreviewWorkerError(request, new Error('version mismatch'), { code: 'VERSION_MISMATCH' });

  for (const response of [ack, error]) {
    assert.equal(response.generation, request.generation);
    assert.equal(response.version, request.version);
    assert.equal(response.requestId, request.requestId);
  }
  assert.equal(ack.type, 'ack');
  assert.equal(ack.acknowledges, 'transactions');
  assert.deepEqual(ack.result, { changedIds: [] });
  assert.equal(error.type, 'error');
  assert.equal(error.operation, 'transactions');
  assert.equal(error.code, 'VERSION_MISMATCH');
  assert.equal(error.message, 'version mismatch');
});

test('cancel has an explicit target request and remains a protocol message only', () => {
  const cancel = createPreviewWorkerMessage('cancel', envelope, { targetRequestId: 40 });
  assert.equal(cancel.targetRequestId, 40);
  assert.equal(parsePreviewWorkerMessage(cancel), cancel);
});
