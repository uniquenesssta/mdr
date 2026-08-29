export function createLifecycleResourceLedger() {
  const counts = {
    listeners: 0,
    pointerCaptures: 0,
    observers: 0,
    frames: 0,
    timers: 0,
    subscriptions: 0
  };
  let nextHandle = 0;
  const frames = new Map();
  const timers = new Map();
  const observerRecords = [];

  const snapshot = () => Object.freeze({ ...counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) });

  function createClassList(...initial) {
    const values = new Set(initial);
    return {
      add(...names) { for (const name of names) values.add(name); },
      remove(...names) { for (const name of names) values.delete(name); },
      contains(name) { return values.has(name); },
      toggle(name, force) {
        const active = force === undefined ? !values.has(name) : Boolean(force);
        if (active) values.add(name); else values.delete(name);
        return active;
      },
      values
    };
  }

  function createStyle() {
    const values = new Map();
    return {
      setProperty(name, value) { values.set(name, String(value)); },
      removeProperty(name) { values.delete(name); },
      getPropertyValue(name) { return values.get(name) || ''; },
      values,
      cursor: '',
      userSelect: '',
      flex: '',
      position: '',
      left: '',
      right: '',
      top: ''
    };
  }

  function createEventTarget(extra = {}) {
    const listeners = new Map();
    function keyFor(type, options) {
      const capture = options === true || Boolean(options?.capture);
      return `${String(type)}::${capture ? 'capture' : 'bubble'}`;
    }
    const target = {
      ...extra,
      addEventListener(type, listener, options) {
        const key = keyFor(type, options);
        let bucket = listeners.get(key);
        if (!bucket) listeners.set(key, bucket = new Set());
        if (!bucket.has(listener)) {
          bucket.add(listener);
          counts.listeners += 1;
        }
      },
      removeEventListener(type, listener, options) {
        const key = keyFor(type, options);
        const bucket = listeners.get(key);
        if (!bucket?.delete(listener)) return;
        counts.listeners -= 1;
        if (!bucket.size) listeners.delete(key);
      },
      dispatch(type, event = {}) {
        for (const [key, bucket] of listeners) {
          if (!key.startsWith(`${String(type)}::`)) continue;
          for (const listener of [...bucket]) listener.call(target, event);
        }
      },
      listenerCount() {
        let total = 0;
        for (const bucket of listeners.values()) total += bucket.size;
        return total;
      },
      _listeners: listeners
    };
    return target;
  }

  function createPointerTarget(extra = {}) {
    const captures = new Set();
    const target = createEventTarget({
      ...extra,
      setPointerCapture(pointerId) {
        if (captures.has(pointerId)) return;
        captures.add(pointerId);
        counts.pointerCaptures += 1;
      },
      releasePointerCapture(pointerId) {
        if (!captures.delete(pointerId)) return;
        counts.pointerCaptures -= 1;
      },
      hasPointerCapture(pointerId) { return captures.has(pointerId); },
      pointerCaptureCount() { return captures.size; }
    });
    return target;
  }

  function requestFrame(callback) {
    const id = ++nextHandle;
    frames.set(id, callback);
    counts.frames += 1;
    return id;
  }
  function cancelFrame(id) {
    if (!frames.delete(id)) return;
    counts.frames -= 1;
  }
  function flushFrames() {
    const pending = [...frames.entries()];
    frames.clear();
    counts.frames -= pending.length;
    for (const [, callback] of pending) callback();
  }

  function setTimer(callback) {
    const id = ++nextHandle;
    timers.set(id, callback);
    counts.timers += 1;
    return id;
  }
  function clearTimer(id) {
    if (!timers.delete(id)) return;
    counts.timers -= 1;
  }
  function flushTimers() {
    const pending = [...timers.entries()];
    timers.clear();
    counts.timers -= pending.length;
    for (const [, callback] of pending) callback();
  }

  function createResizeObserver(callback) {
    const record = { callback, active: false, observed: new Set() };
    observerRecords.push(record);
    return {
      observe(target) {
        if (!record.active) {
          record.active = true;
          counts.observers += 1;
        }
        record.observed.add(target);
      },
      disconnect() {
        if (record.active) {
          record.active = false;
          counts.observers -= 1;
        }
        record.observed.clear();
      },
      trigger(entries = []) { callback(entries); }
    };
  }

  function createSubscriptionSource(initialSnapshot = {}) {
    const listeners = new Set();
    return {
      snapshot: initialSnapshot,
      subscribe(listener) {
        if (!listeners.has(listener)) {
          listeners.add(listener);
          counts.subscriptions += 1;
        }
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          if (listeners.delete(listener)) counts.subscriptions -= 1;
        };
      },
      publish(...args) { for (const listener of [...listeners]) listener(...args); },
      listenerCount() { return listeners.size; }
    };
  }

  return Object.freeze({
    snapshot,
    createClassList,
    createStyle,
    createEventTarget,
    createPointerTarget,
    requestFrame,
    cancelFrame,
    flushFrames,
    setTimer,
    clearTimer,
    flushTimers,
    createResizeObserver,
    createSubscriptionSource,
    observerRecords,
    frames,
    timers
  });
}

export function assertLifecycleZero(assert, ledger, label = 'lifecycle resources') {
  assert.deepEqual(ledger.snapshot(), {
    listeners: 0,
    pointerCaptures: 0,
    observers: 0,
    frames: 0,
    timers: 0,
    subscriptions: 0,
    total: 0
  }, `${label} must be zero after destroy`);
}
