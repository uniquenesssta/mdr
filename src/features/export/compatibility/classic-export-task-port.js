import { isExportCancelledError } from '../task/export-cancellation.js';

const PORT_KEY = 'markdownEditorExportTaskPort';

/** Scoped classic command/subscription bridge; controller retains all task state. */
export function mountClassicExportTaskPort(host, controller) {
  if (!host || typeof host !== 'object') throw new TypeError('Export task host is required.');
  for (const method of ['getSnapshot', 'begin', 'finish', 'cancel', 'subscribe']) {
    if (typeof controller?.[method] !== 'function') throw new TypeError('Export task controller is required.');
  }
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Export task port is already mounted.');
  let destroyed = false;
  const subscriptions = new Set();
  const requireAlive = () => { if (destroyed) throw new Error('Export task port has been destroyed.'); };
  const port = Object.freeze({
    getSnapshot: () => controller.getSnapshot(),
    begin(title) { requireAlive(); return controller.begin(title); },
    finish(task, outcome) { return destroyed ? false : controller.finish(task, outcome); },
    cancel() { requireAlive(); return controller.cancel(); },
    isCancelled: isExportCancelledError,
    subscribe(listener) {
      requireAlive();
      const unsubscribe = controller.subscribe(listener);
      subscriptions.add(unsubscribe);
      return () => { subscriptions.delete(unsubscribe); unsubscribe(); };
    }
  });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({
    port,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions.clear();
      if (host[PORT_KEY] === port) delete host[PORT_KEY];
    }
  });
}
