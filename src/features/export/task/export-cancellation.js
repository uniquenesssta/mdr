export class ExportCancelledError extends Error {
  constructor(reason = 'cancelled') {
    super('EXPORT_CANCELLED');
    this.name = 'ExportCancelledError';
    this.reason = reason;
  }
}

export const isExportCancelledError = error => error instanceof ExportCancelledError;
export const EXPORT_NONCANCELABLE_PHASES = Object.freeze(['writing', 'encoding', 'printing']);

export function assertExportNonCancelablePhase(phase) {
  if (!EXPORT_NONCANCELABLE_PHASES.includes(phase)) throw new TypeError('Unknown noncancelable export phase.');
}

/** Read-only capability over controller-owned state; owns only cancellation subscriptions. */
export function createExportCancellationToken({ taskId, readState, subscribe } = {}) {
  if (!Number.isSafeInteger(taskId) || taskId < 1) throw new TypeError('Export cancellation task identity is required.');
  if (typeof readState !== 'function' || typeof subscribe !== 'function') throw new TypeError('Export cancellation state readers are required.');
  const throwIfCancelled = () => {
    const state = readState();
    if (state.cancelled) throw new ExportCancelledError(state.reason);
  };
  const onCancel = listener => {
    if (typeof listener !== 'function') throw new TypeError('Export cancellation listener is required.');
    let done = false, unsubscribe = () => {};
    const receive = () => {
      const state = readState();
      if (done || !state.cancelled) return;
      done = true;
      unsubscribe();
      listener(state.reason);
    };
    // Already invalid tokens never ask the destroyed owner for a new subscription.
    if (readState().cancelled) { receive(); return () => {}; }
    unsubscribe = subscribe(receive);
    if (done) unsubscribe();
    return () => { done = true; unsubscribe(); };
  };
  return Object.freeze({
    taskId,
    get cancelled() { return readState().cancelled; },
    get reason() { return readState().reason; },
    throwIfCancelled,
    onCancel,
    waitFor(promise) {
      // Always observe the underlying operation, including rejection after cancellation.
      const pending = Promise.resolve(promise);
      return new Promise((resolve, reject) => {
        let settled = false, unsubscribe = () => {};
        const settle = (callback, value) => {
          if (settled) return;
          settled = true; unsubscribe(); callback(value);
        };
        pending.then(value => {
          if (settled) return;
          try { throwIfCancelled(); settle(resolve, value); }
          catch (error) { settle(reject, error); }
        }, error => {
          if (settled) return;
          try { throwIfCancelled(); settle(reject, error); }
          catch (cancelled) { settle(reject, cancelled); }
        });
        unsubscribe = onCancel(reason => settle(reject, new ExportCancelledError(reason)));
        if (settled) unsubscribe();
      });
    }
  });
}
