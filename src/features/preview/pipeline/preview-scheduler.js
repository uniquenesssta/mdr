/**
 * Responsibility: Coalesce and schedule Preview input, focus, layout and enhancement work while preserving per-channel cancellation tokens.
 * Imports: None; cancellation owner and scheduling primitives are injected.
 * Exports: createPreviewScheduler().
 * State/side effects: Owns queued timer/frame/idle/background handles per Preview channel; owns no DOM or Preview business state.
 * Lifecycle: cancel()/cancelAll()/destroy() release queued resources; stale/running tasks cannot commit after ownership changes.
 */
const CHANNELS = Object.freeze(['input', 'focus', 'layout', 'enhancement']);
const CHANNEL_SET = new Set(CHANNELS);
const KINDS = new Set(['timeout', 'frame', 'idle', 'background']);

function normalizeChannel(value) {
  const channel = String(value || '');
  if (!CHANNEL_SET.has(channel)) throw new RangeError(`Unsupported Preview scheduling channel: ${channel || '<empty>'}.`);
  return channel;
}

function normalizeKind(value) {
  const kind = String(value || 'timeout');
  if (!KINDS.has(kind)) throw new RangeError(`Unsupported Preview scheduling kind: ${kind || '<empty>'}.`);
  return kind;
}

function asDelay(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function defaultSetTimer(callback, delay) {
  return globalThis.setTimeout(callback, delay);
}

function defaultClearTimer(handle) {
  globalThis.clearTimeout(handle);
}

function defaultRequestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback);
  return globalThis.setTimeout(() => callback(globalThis.performance?.now?.() ?? Date.now()), 16);
}

function defaultCancelFrame(handle) {
  if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(handle);
  else globalThis.clearTimeout(handle);
}

function createTimeoutDeadline() {
  return Object.freeze({ didTimeout: true, timeRemaining: () => 0 });
}

export function createPreviewScheduler(options = {}) {
  const cancellation = options.cancellation;
  if (!cancellation
    || typeof cancellation.issue !== 'function'
    || typeof cancellation.isCurrent !== 'function'
    || typeof cancellation.cancel !== 'function'
    || typeof cancellation.commit !== 'function') {
    throw new TypeError('Preview Scheduler requires a cancellation owner.');
  }

  const setTimer = options.setTimer || defaultSetTimer;
  const clearTimer = options.clearTimer || defaultClearTimer;
  const requestFrame = options.requestFrame || defaultRequestFrame;
  const cancelFrame = options.cancelFrame || defaultCancelFrame;
  const requestIdle = options.requestIdle
    || (typeof globalThis.requestIdleCallback === 'function'
      ? globalThis.requestIdleCallback.bind(globalThis)
      : null);
  const cancelIdle = options.cancelIdle
    || (typeof globalThis.cancelIdleCallback === 'function'
      ? globalThis.cancelIdleCallback.bind(globalThis)
      : null);
  const getBackgroundScheduler = typeof options.getBackgroundScheduler === 'function'
    ? options.getBackgroundScheduler
    : () => null;
  const reportError = typeof options.reportError === 'function'
    ? options.reportError
    : (message, error) => console.error(message, error);

  const owners = new Map();
  let destroyed = false;
  let resourceSequence = 0;

  const assertActive = () => {
    if (destroyed) throw new Error('Preview Scheduler is destroyed.');
  };

  function ownerIsCurrent(owner) {
    return !destroyed && !owner.controller.signal.aborted && cancellation.isCurrent(owner.token);
  }

  function cancelResource(resource) {
    if (!resource.active) return;
    resource.active = false;
    resource.cancel?.();
    resource.owner.resources.delete(resource);
  }

  function clearOwnerResources(owner) {
    const errors = [];
    for (const resource of [...owner.resources]) {
      try {
        cancelResource(resource);
      } catch (error) {
        owner.resources.delete(resource);
        errors.push(error);
      }
    }
    if (errors.length) {
      reportError('Preview Scheduler resource cleanup failed.', new AggregateError(errors));
    }
  }

  function retireOwner(owner) {
    if (owner.controller.signal.aborted) return;
    owner.controller.abort();
    clearOwnerResources(owner);
    if (!owner.rootStarted) owner.resolveDone();
    if (owners.get(owner.channel) === owner) owners.delete(owner.channel);
  }

  function buildTaskContext(owner, deadline = null, externalSignal = null) {
    return Object.freeze({
      token: owner.token,
      signal: owner.controller.signal,
      deadline,
      isCurrent() {
        return ownerIsCurrent(owner) && !externalSignal?.aborted;
      },
      commit(callback) {
        if (externalSignal?.aborted || owner.controller.signal.aborted) return false;
        return cancellation.commit(owner.token, callback);
      },
      schedule(callback, scheduleOptions = {}) {
        if (!ownerIsCurrent(owner) || externalSignal?.aborted) return false;
        scheduleResource(owner, callback, scheduleOptions, false);
        return true;
      }
    });
  }

  function dispatch(resource, callback, isRoot, deadline = null, externalSignal = null) {
    if (!resource.active) return;
    resource.active = false;
    resource.owner.resources.delete(resource);
    const owner = resource.owner;
    if (!ownerIsCurrent(owner) || externalSignal?.aborted) {
      if (isRoot && !owner.rootStarted) owner.resolveDone();
      return;
    }

    if (isRoot) owner.rootStarted = true;
    let result;
    try {
      result = callback(buildTaskContext(owner, deadline, externalSignal));
    } catch (error) {
      if (isRoot) owner.rejectDone(error);
      else reportError('Preview Scheduler continuation failed.', error);
      return;
    }

    Promise.resolve(result).then(
      () => { if (isRoot) owner.resolveDone(); },
      error => {
        if (isRoot) owner.rejectDone(error);
        else reportError('Preview Scheduler continuation failed.', error);
      }
    );
  }

  function scheduleResource(owner, callback, scheduleOptions = {}, isRoot = false) {
    if (typeof callback !== 'function') throw new TypeError('Preview Scheduler callback must be a function.');
    const kind = normalizeKind(scheduleOptions.kind);
    const delay = asDelay(scheduleOptions.delay);
    const timeout = asDelay(scheduleOptions.timeout);
    const fallbackMs = asDelay(scheduleOptions.fallbackMs);
    const resource = {
      id: ++resourceSequence,
      owner,
      kind,
      active: true,
      cancel: null
    };
    owner.resources.add(resource);

    const invoke = (deadline = null, externalSignal = null) => dispatch(resource, callback, isRoot, deadline, externalSignal);

    if (kind === 'timeout') {
      const handle = setTimer(() => invoke(), delay);
      resource.cancel = () => clearTimer(handle);
      return resource;
    }

    if (kind === 'frame') {
      const handle = requestFrame(() => invoke());
      resource.cancel = () => cancelFrame(handle);
      return resource;
    }

    if (kind === 'idle') {
      if (requestIdle) {
        const handle = requestIdle(deadlineValue => invoke(deadlineValue), timeout > 0 ? { timeout } : undefined);
        resource.cancel = () => cancelIdle?.(handle);
      } else {
        const handle = setTimer(() => invoke(createTimeoutDeadline()), fallbackMs);
        resource.cancel = () => clearTimer(handle);
      }
      return resource;
    }

    const backgroundScheduler = getBackgroundScheduler();
    if (backgroundScheduler?.schedule) {
      const handle = backgroundScheduler.schedule(
        `preview-${owner.channel}-${owner.token.generation}-${resource.id}`,
        ({ signal, deadline } = {}) => invoke(deadline || null, signal || null),
        { priority: 'background', timeout }
      );
      resource.cancel = () => handle?.cancel?.();
      return resource;
    }

    if (requestIdle) {
      const handle = requestIdle(deadlineValue => invoke(deadlineValue), timeout > 0 ? { timeout } : undefined);
      resource.cancel = () => cancelIdle?.(handle);
      return resource;
    }

    const handle = setTimer(() => invoke(createTimeoutDeadline()), fallbackMs);
    resource.cancel = () => clearTimer(handle);
    return resource;
  }

  function schedule(channelValue, callback, scheduleOptions = {}) {
    assertActive();
    const channel = normalizeChannel(channelValue);
    const previous = owners.get(channel);
    if (previous) retireOwner(previous);

    const token = cancellation.issue(channel);
    const controller = new AbortController();
    let resolveDone;
    let rejectDone;
    let doneSettled = false;
    const done = new Promise((resolve, reject) => {
      resolveDone = () => {
        if (doneSettled) return;
        doneSettled = true;
        resolve();
      };
      rejectDone = error => {
        if (doneSettled) return;
        doneSettled = true;
        reject(error);
      };
    });
    void done.catch(error => reportError('Preview Scheduler task failed.', error));
    const owner = {
      channel,
      token,
      controller,
      resources: new Set(),
      rootStarted: false,
      resolveDone,
      rejectDone
    };
    owners.set(channel, owner);
    scheduleResource(owner, callback, scheduleOptions, true);

    return Object.freeze({
      token,
      signal: controller.signal,
      done,
      isCurrent: () => ownerIsCurrent(owner),
      cancel: () => cancel(channel)
    });
  }

  function hasPending(channelValue) {
    if (destroyed) return false;
    const channel = normalizeChannel(channelValue);
    return (owners.get(channel)?.resources.size || 0) > 0;
  }

  function cancel(channelValue) {
    assertActive();
    const channel = normalizeChannel(channelValue);
    const owner = owners.get(channel);
    cancellation.cancel(channel);
    if (owner) retireOwner(owner);
    return Boolean(owner);
  }

  function cancelAll() {
    assertActive();
    for (const channel of CHANNELS) {
      const owner = owners.get(channel);
      cancellation.cancel(channel);
      if (owner) retireOwner(owner);
    }
  }

  return Object.freeze({
    schedule,
    hasPending,
    cancel,
    cancelAll,
    destroy() {
      if (destroyed) return;
      cancelAll();
      destroyed = true;
      owners.clear();
    }
  });
}
