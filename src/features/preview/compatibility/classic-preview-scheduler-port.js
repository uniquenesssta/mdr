/**
 * Responsibility: Scoped migration bridge exposing Preview Scheduler channels to remaining classic preview callers.
 * Imports: None; receives the canonical Preview Scheduler instance from the composition root.
 * Exports: mountClassicPreviewSchedulerPort().
 * State/side effects: Owns one non-enumerable compatibility-host property; owns no scheduling state and removes the property on destroy.
 * Lifecycle: mountClassicPreviewSchedulerPort()/destroy() are idempotent per mount; API calls are terminal after destroy.
 */
const PORT_PROPERTY = 'markdownEditorPreviewSchedulerPort';

function assertTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('Classic Preview Scheduler port target must be an object.');
  }
}

function assertScheduler(scheduler) {
  if (!scheduler
    || typeof scheduler.schedule !== 'function'
    || typeof scheduler.cancel !== 'function'
    || typeof scheduler.cancelAll !== 'function'
    || typeof scheduler.hasPending !== 'function') {
    throw new TypeError('Classic Preview Scheduler port requires a scheduler.');
  }
}

export function mountClassicPreviewSchedulerPort(target, scheduler) {
  assertTarget(target);
  assertScheduler(scheduler);
  if (Object.hasOwn(target, PORT_PROPERTY)) {
    throw new Error('Classic Preview Scheduler port is already mounted.');
  }

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Classic Preview Scheduler port is destroyed.');
  };
  const api = Object.freeze({
    schedule(channel, callback, options) {
      assertActive();
      return scheduler.schedule(channel, callback, options);
    },
    hasPending(channel) {
      assertActive();
      return scheduler.hasPending(channel);
    },
    cancel(channel) {
      assertActive();
      return scheduler.cancel(channel);
    },
    cancelAll() {
      assertActive();
      return scheduler.cancelAll();
    }
  });

  Object.defineProperty(target, PORT_PROPERTY, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api
  });

  return Object.freeze({
    api,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (target[PORT_PROPERTY] === api) delete target[PORT_PROPERTY];
      if (typeof target.removeAttribute === 'function') target.removeAttribute(PORT_PROPERTY);
    }
  });
}
