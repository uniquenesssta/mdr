import {
  PREVIEW_WORKER_MESSAGE_TYPES,
  createPreviewWorkerMessage,
  parsePreviewWorkerMessage
} from './preview-worker-protocol.js';

const SYNC_REQUEST_TYPES = new Set([
  PREVIEW_WORKER_MESSAGE_TYPES.RESET,
  PREVIEW_WORKER_MESSAGE_TYPES.TRANSACTIONS
]);

function createSessionError(error, fault = 'worker') {
  const source = error instanceof Error ? error : null;
  const message = source?.message || String(error || 'Preview Worker Session failed');
  const normalized = new Error(message, source ? { cause: source } : undefined);
  normalized.name = 'PreviewWorkerSessionError';
  normalized.previewWorkerSessionFault = fault;
  return normalized;
}

function createDestroyedError() {
  return createSessionError('Preview Worker Session destroyed', 'destroyed');
}

function validateWorker(worker) {
  if (!worker
    || typeof worker.addEventListener !== 'function'
    || typeof worker.removeEventListener !== 'function'
    || typeof worker.postMessage !== 'function'
    || typeof worker.terminate !== 'function') {
    throw new TypeError('Preview Worker Session createWorker must return a Worker-compatible object');
  }
  return worker;
}

export function createPreviewWorkerSession({ createWorker } = {}) {
  if (typeof createWorker !== 'function') {
    throw new TypeError('Preview Worker Session requires createWorker');
  }

  let worker = null;
  let generation = 0;
  let syncedVersion = 0;
  let initialized = false;
  let requestId = 0;
  let destroyed = false;
  const pending = new Map();

  const snapshot = () => Object.freeze({
    generation,
    syncedVersion,
    initialized,
    pendingRequests: pending.size,
    destroyed
  });

  const detachWorker = () => {
    if (!worker) return;
    worker.removeEventListener('message', handleMessage);
    worker.removeEventListener('error', handleWorkerError);
    worker.terminate();
    worker = null;
  };

  const rejectPending = error => {
    const entries = [...pending.values()];
    pending.clear();
    for (const entry of entries) entry.reject(error);
  };

  const resetSyncState = () => {
    initialized = false;
    syncedVersion = 0;
  };

  const restart = (error = new Error('Preview Worker Session restarted'), options = {}) => {
    if (destroyed) return false;
    const fault = options.fault || error?.previewWorkerSessionFault || 'worker';
    const normalized = error?.previewWorkerSessionFault
      ? error
      : createSessionError(error, fault);
    detachWorker();
    resetSyncState();
    generation = generation > 0 ? generation + 1 : 1;
    rejectPending(normalized);
    return true;
  };

  const failProtocol = (entry, message) => {
    pending.delete(entry.requestId);
    const error = createSessionError(message, 'protocol');
    entry.reject(error);
    restart(error, { fault: 'protocol' });
  };

  function handleMessage(event) {
    let message;
    try {
      message = parsePreviewWorkerMessage(event?.data ?? event);
    } catch (error) {
      restart(createSessionError(error, 'protocol'), { fault: 'protocol' });
      return;
    }

    if (message.generation !== generation) return;
    const entry = pending.get(message.requestId);
    if (!entry) return;
    if (message.version !== entry.version) {
      failProtocol(entry, 'Preview Worker Session response version mismatch');
      return;
    }
    if (message.type === PREVIEW_WORKER_MESSAGE_TYPES.ERROR) {
      pending.delete(entry.requestId);
      const error = createSessionError(message.message || 'Preview worker failed', 'protocol');
      entry.reject(error);
      restart(error, { fault: 'protocol' });
      return;
    }
    if (message.type !== PREVIEW_WORKER_MESSAGE_TYPES.ACK || message.acknowledges !== entry.type) {
      failProtocol(entry, 'Preview Worker Session response acknowledgement mismatch');
      return;
    }

    pending.delete(entry.requestId);
    if (SYNC_REQUEST_TYPES.has(entry.type)) {
      initialized = true;
      syncedVersion = message.version;
    }
    entry.resolve(message);
  }

  function handleWorkerError(error) {
    restart(createSessionError(error, 'worker'), { fault: 'worker' });
  }

  const ensureWorker = () => {
    if (destroyed) throw createDestroyedError();
    if (worker) return worker;
    if (generation === 0) generation = 1;
    try {
      worker = validateWorker(createWorker());
      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleWorkerError);
      return worker;
    } catch (error) {
      const normalized = createSessionError(error, 'worker');
      worker = null;
      resetSyncState();
      generation = generation > 0 ? generation + 1 : 1;
      throw normalized;
    }
  };

  const request = (type, { version, payload = {} } = {}) => {
    if (destroyed) return Promise.reject(createDestroyedError());
    let target;
    let message;
    try {
      target = ensureWorker();
      const nextRequestId = ++requestId;
      message = createPreviewWorkerMessage(type, {
        generation,
        version,
        requestId: nextRequestId
      }, payload);
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      const entry = {
        type,
        version: message.version,
        requestId: message.requestId,
        resolve,
        reject
      };
      pending.set(entry.requestId, entry);
      try {
        target.postMessage(message);
      } catch (error) {
        restart(createSessionError(error, 'worker'), { fault: 'worker' });
      }
    });
  };

  const destroy = () => {
    if (destroyed) return false;
    destroyed = true;
    detachWorker();
    resetSyncState();
    rejectPending(createDestroyedError());
    return true;
  };

  return Object.freeze({
    get snapshot() {
      return snapshot();
    },
    request,
    restart,
    destroy
  });
}
