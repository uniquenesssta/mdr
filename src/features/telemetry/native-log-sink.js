/** One acknowledged native request with one bounded recovery query; Buffer owns all retries. */
export function createNativeLogSink({ write, schedule, cancel, isEnabled = () => true, timeoutMs = 2000 } = {}) {
  for (const [name, value] of Object.entries({ write, schedule, cancel, isEnabled })) {
    if (typeof value !== 'function') throw new TypeError(`NativeLogSink requires ${name}`);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 5000) throw new TypeError('Invalid native log timeout');
  let destroyed = false, busy = false, cleanupFailed = false;
  const clear = timer => { if (timer !== null) try { cancel(timer); } catch (_) { cleanupFailed = true; } };
  const pending = new Set();
  function wait(operation) {
    return new Promise((resolve, reject) => {
      const item = { timer: null, reject };
      const settle = (fn, value) => {
        if (!pending.delete(item)) return;
        clear(item.timer);
        fn(value);
      };
      pending.add(item);
      try { item.timer = schedule(() => settle(reject, new Error('Native log timeout')), timeoutMs); }
      catch (_) { settle(reject, new Error('Native log timer unavailable')); return; }
      if (!pending.has(item)) { clear(item.timer); return; }
      Promise.resolve().then(() => destroyed ? Promise.reject(new Error('Native log sink destroyed')) : operation())
        .then(value => settle(resolve, value), () => settle(reject, new Error('Native log response unavailable')));
    });
  }
  function acknowledge(value, meta) {
    if (destroyed) throw new Error('Native log sink destroyed');
    let batchId, attempt, acceptedCount, state;
    try { ({ batchId, attempt, acceptedCount, state } = value || {}); }
    catch (_) { throw new Error('Unconfirmed native log batch'); }
    if (batchId !== meta.batchId || attempt !== meta.attempt || !Number.isInteger(acceptedCount)
      || acceptedCount < meta.offset || acceptedCount > meta.total || !['complete', 'partial'].includes(state)
      || (state === 'complete' && acceptedCount !== meta.total)) throw new Error('Unconfirmed native log batch');
    return Object.freeze({ batchId, attempt, acceptedCount });
  }
  async function writeBatch(entries, input) {
    if (destroyed || cleanupFailed || busy || !isEnabled()) throw new Error('Native log sink unavailable');
    const { batchId, offset, attempt } = input || {};
    if (!Array.isArray(entries) || !entries.length || entries.length > 250 || !Number.isInteger(offset) || offset < 0
      || !Number.isInteger(attempt) || attempt < 1 || attempt > 8 || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}-batch-[1-9][0-9]*$/.test(batchId)) throw new TypeError('Invalid native log batch');
    const meta = Object.freeze({ batchId, offset, attempt, total: offset + entries.length, query: false });
    if (meta.total > 250) throw new TypeError('Invalid native log total');
    busy = true;
    try {
      try { return acknowledge(await wait(() => write(entries, meta)), meta); }
      catch (_) {
        if (destroyed) throw new Error('Native log sink destroyed');
        return acknowledge(await wait(() => write([], Object.freeze({ ...meta, query: true }))), meta);
      }
    } finally { busy = false; }
  }
  return Object.freeze({ writeBatch, destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const item of pending) { clear(item.timer); item.reject(new Error('Native log sink destroyed')); }
    pending.clear();
  }, getState: () => Object.freeze({ destroyed, busy, activeWaits: pending.size, cleanupFailed }) });
}
