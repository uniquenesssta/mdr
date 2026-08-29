function assertEventTarget(target) {
  if (!target || typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') {
    throw new TypeError('Event scope requires an EventTarget-compatible object.');
  }
}

export function createEventScope() {
  let destroyed = false;
  const disposers = [];

  function listen(target, type, listener, options) {
    if (destroyed) throw new Error('Cannot register events on a destroyed event scope.');
    assertEventTarget(target);
    const normalizedType = String(type || '').trim();
    if (!normalizedType) throw new TypeError('Event type must not be empty.');
    if (typeof listener !== 'function') throw new TypeError(`Listener for ${normalizedType} must be a function.`);

    target.addEventListener(normalizedType, listener, options);
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      target.removeEventListener(normalizedType, listener, options);
    };
    disposers.push(dispose);
    return dispose;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    const errors = [];
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      try {
        disposers[index]();
      } catch (error) {
        errors.push(error);
      }
    }
    disposers.length = 0;
    if (errors.length) throw new AggregateError(errors, 'Failed to destroy event scope cleanly.');
  }

  return Object.freeze({
    listen,
    destroy,
    isDestroyed: () => destroyed
  });
}
