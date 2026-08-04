const DISPOSER_REGISTRY_STATES = Object.freeze({
  OPEN: 'open',
  DISPOSING: 'disposing',
  FAILED: 'failed'
});

function assertDisposer(disposer) {
  if (typeof disposer !== 'function') {
    throw new TypeError('Registered disposer must be a function.');
  }
}

export { DISPOSER_REGISTRY_STATES };

export function createDisposerRegistry() {
  let state = DISPOSER_REGISTRY_STATES.OPEN;
  let entries = [];
  let transitionPromise = null;

  function removeEntry(entry) {
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
  }

  function runEntry(entry) {
    if (!entry.active) return Promise.resolve();
    if (entry.promise) return entry.promise;

    let operation;
    operation = Promise.resolve()
      .then(() => entry.disposer())
      .then(() => {
        entry.active = false;
        removeEntry(entry);
        if (state === DISPOSER_REGISTRY_STATES.FAILED && entries.length === 0) {
          state = DISPOSER_REGISTRY_STATES.OPEN;
        }
      })
      .finally(() => {
        if (entry.promise === operation) entry.promise = null;
      });
    entry.promise = operation;
    return operation;
  }

  function register(disposer) {
    assertDisposer(disposer);
    if (state === DISPOSER_REGISTRY_STATES.DISPOSING) {
      throw new Error('Cannot register a disposer while registry disposal is in progress.');
    }
    if (state === DISPOSER_REGISTRY_STATES.FAILED) {
      throw new Error('Cannot register a disposer while previous cleanup is incomplete.');
    }

    const entry = {
      disposer,
      active: true,
      promise: null
    };
    entries.push(entry);

    return function disposeRegisteredResource() {
      if (state === DISPOSER_REGISTRY_STATES.DISPOSING && !entry.promise) {
        return Promise.reject(
          new Error('Registered resources cannot be disposed out of order during registry cleanup.')
        );
      }
      return runEntry(entry);
    };
  }

  function dispose() {
    if (state === DISPOSER_REGISTRY_STATES.DISPOSING) return transitionPromise;
    if (entries.length === 0) {
      state = DISPOSER_REGISTRY_STATES.OPEN;
      return Promise.resolve();
    }

    state = DISPOSER_REGISTRY_STATES.DISPOSING;
    let transition;
    transition = (async () => {
      const errors = [];
      const activeEntries = [...entries].reverse();

      for (const entry of activeEntries) {
        if (!entry.active) continue;
        try {
          await runEntry(entry);
        } catch (error) {
          errors.push(error);
        }
      }

      state = errors.length === 0
        ? DISPOSER_REGISTRY_STATES.OPEN
        : DISPOSER_REGISTRY_STATES.FAILED;

      if (errors.length > 0) {
        throw new AggregateError(
          errors,
          'Disposer registry cleanup completed with errors.'
        );
      }
    })().finally(() => {
      if (transitionPromise === transition) transitionPromise = null;
    });
    transitionPromise = transition;
    return transition;
  }

  return Object.freeze({
    get state() {
      return state;
    },
    get size() {
      return entries.length;
    },
    register,
    dispose,
    destroy: dispose
  });
}
