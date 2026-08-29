/**
 * Responsibility: Own one document's native save serialization, waiter coalescing, forceSnapshot aggregation, failure fan-out and terminal lifecycle.
 * Imports: None; one batch executor and persistence-event sink are injected by NativeDocumentStore.
 * Exports: createNativeSaveQueue().
 * State/side effects: Owns only queue lifecycle, waiter request metadata and promise settlement. It never owns document body, snapshots, NativeSaveSession metadata, DOM, timers or platform objects.
 * Lifecycle: destroy() is idempotent and terminal; pending waiters reject immediately and late in-flight completion cannot publish success/error.
 */

function normalizeVersion(value) {
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : 0;
}

function queueDestroyedError() {
  const error = new Error('NATIVE_SAVE_QUEUE_DESTROYED');
  error.code = 'NATIVE_SAVE_QUEUE_DESTROYED';
  return error;
}

function noProgressError(documentId) {
  const error = new Error('NATIVE_SAVE_QUEUE_NO_PROGRESS');
  error.code = 'NATIVE_SAVE_QUEUE_NO_PROGRESS';
  error.documentId = documentId;
  return error;
}

export function createNativeSaveQueue(documentId, { executeBatch, notify = () => {} } = {}) {
  const id = String(documentId || '');
  if (!id) throw new TypeError('Native Save Queue document id is required.');
  if (typeof executeBatch !== 'function') throw new TypeError('Native Save Queue requires executeBatch().');
  if (typeof notify !== 'function') throw new TypeError('Native Save Queue notify must be a function.');

  let destroyed = false;
  let running = false;
  let sequence = 0;
  let waiters = [];

  const assertActive = () => {
    if (destroyed) throw queueDestroyedError();
  };

  const snapshot = () => {
    assertActive();
    return Object.freeze({
      documentId: id,
      running,
      pending: waiters.length
    });
  };

  const publish = event => {
    if (destroyed) return;
    notify(Object.freeze({ ...event }));
  };

  const rejectAll = error => {
    const failed = waiters;
    waiters = [];
    failed.forEach(waiter => waiter.reject(error));
    return failed.length;
  };

  async function pump() {
    if (destroyed || running || !waiters.length) return;
    running = true;
    try {
      while (!destroyed && waiters.length) {
        const boundary = waiters[waiters.length - 1].sequence;
        const included = waiters.filter(waiter => waiter.sequence <= boundary);
        const latest = included[included.length - 1];
        const forceSnapshot = included.some(waiter => waiter.forceSnapshot);
        const targetVersion = included.reduce(
          (maximum, waiter) => Math.max(maximum, waiter.targetVersion),
          0
        );
        const batch = Object.freeze({
          documentId: id,
          targetVersion,
          forceSnapshot,
          context: latest.context,
          pending: waiters.length,
          getPendingCount: () => waiters.length
        });

        let outcome;
        try {
          outcome = await executeBatch(batch);
        } catch (error) {
          if (destroyed) return;
          publish({
            state: 'error',
            documentId: id,
            message: error?.message || String(error),
            pending: waiters.length
          });
          rejectAll(error);
          return;
        }
        if (destroyed) return;

        const completedVersion = normalizeVersion(outcome?.completedVersion);
        const completedTitle = String(outcome?.completedTitle ?? latest.context?.title ?? '');
        const forceSnapshotApplied = Boolean(outcome?.forceSnapshotApplied ?? forceSnapshot);
        const completed = [];
        const pending = [];
        for (const waiter of waiters) {
          const includedInBatch = waiter.sequence <= boundary;
          const versionCovered = waiter.targetVersion <= completedVersion;
          const titleCovered = String(waiter.context?.title ?? '') === completedTitle;
          const forceCovered = !waiter.forceSnapshot || forceSnapshotApplied;
          if (versionCovered && forceCovered && (includedInBatch || titleCovered)) {
            completed.push(waiter);
          } else {
            pending.push(waiter);
          }
        }

        if (!completed.length) {
          const error = noProgressError(id);
          publish({
            state: 'error',
            documentId: id,
            message: error.message,
            pending: waiters.length
          });
          rejectAll(error);
          return;
        }

        waiters = pending;
        const value = outcome && Object.prototype.hasOwnProperty.call(outcome, 'value')
          ? outcome.value
          : outcome;
        completed.forEach(waiter => waiter.resolve(value));
        publish({
          state: 'saved',
          documentId: id,
          version: normalizeVersion(outcome?.version ?? completedVersion),
          snapshotCreated: Boolean(outcome?.snapshotCreated),
          journalEntries: Math.max(0, Number(outcome?.journalEntries) || 0),
          pending: waiters.length
        });
      }
    } finally {
      running = false;
    }
  }

  const enqueue = ({ targetVersion = 0, forceSnapshot = false, context = null } = {}) => {
    if (destroyed) return Promise.reject(queueDestroyedError());
    const waiter = {
      sequence: ++sequence,
      targetVersion: normalizeVersion(targetVersion),
      forceSnapshot: Boolean(forceSnapshot),
      context,
      resolve: null,
      reject: null
    };
    const promise = new Promise((resolve, reject) => {
      waiter.resolve = resolve;
      waiter.reject = reject;
    });
    waiters.push(waiter);
    publish({
      state: 'queued',
      documentId: id,
      targetVersion: waiter.targetVersion,
      pending: waiters.length
    });
    void pump();
    return promise;
  };

  const api = {
    get documentId() {
      return id;
    },
    get running() {
      assertActive();
      return running;
    },
    get pendingCount() {
      assertActive();
      return waiters.length;
    },
    get idle() {
      assertActive();
      return !running && waiters.length === 0;
    },
    get destroyed() {
      return destroyed;
    },
    snapshot,
    enqueue,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const error = queueDestroyedError();
      rejectAll(error);
    }
  };

  return Object.freeze(api);
}
