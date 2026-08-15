const PORT_KEY = 'markdownEditorTaskSchedulerPort';

/** Scoped compatibility view of the canonical shared TaskScheduler. No state is duplicated. */
export function mountClassicTaskSchedulerPort(host, scheduler) {
  if (!host || typeof host !== 'object') throw new TypeError('Task Scheduler compatibility port requires a host.');
  if (!scheduler?.schedule || !scheduler?.cancel || !scheduler?.cancelPrefix || !scheduler?.getStats) {
    throw new TypeError('Task Scheduler compatibility port requires a scheduler.');
  }
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Task Scheduler compatibility port is already mounted.');
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Task Scheduler compatibility port is destroyed.');
  };
  const port = Object.freeze({
    schedule(key, callback, options) { assertActive(); return scheduler.schedule(key, callback, options); },
    cancel(key) { assertActive(); return scheduler.cancel(key); },
    cancelPrefix(prefix) { assertActive(); return scheduler.cancelPrefix(prefix); },
    getStats() { assertActive(); return scheduler.getStats(); }
  });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({
    port,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_KEY] === port) delete host[PORT_KEY];
    }
  });
}
