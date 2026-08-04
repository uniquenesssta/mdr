const LIFECYCLE_STATES = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  FAILED: 'failed'
});

function assertParticipant(participant, index) {
  if (
    participant === null ||
    typeof participant !== 'object' ||
    Array.isArray(participant) ||
    typeof participant.start !== 'function' ||
    typeof participant.destroy !== 'function'
  ) {
    throw new TypeError(
      `Lifecycle participant at index ${index} must implement start() and destroy().`
    );
  }
}

function normalizeParticipants(participants) {
  if (!Array.isArray(participants)) {
    throw new TypeError('Lifecycle participants must be an array.');
  }

  return Object.freeze(participants.map((participant, index) => {
    assertParticipant(participant, index);
    return participant;
  }));
}

export { LIFECYCLE_STATES };

export function createApplicationLifecycle(participants = []) {
  const orderedParticipants = normalizeParticipants(participants);
  let state = LIFECYCLE_STATES.IDLE;
  let activeParticipants = [];
  let transitionPromise = null;
  let lastContext;

  async function destroyActiveParticipants(context) {
    const errors = [];

    for (let index = activeParticipants.length - 1; index >= 0; index -= 1) {
      const participant = activeParticipants[index];
      try {
        await participant.destroy(context);
        activeParticipants.splice(index, 1);
      } catch (error) {
        errors.push(error);
      }
    }

    return errors;
  }

  function trackTransition(operation) {
    let transition;
    transition = operation.finally(() => {
      if (transitionPromise === transition) transitionPromise = null;
    });
    transitionPromise = transition;
    return transition;
  }

  function beginStart(context) {
    state = LIFECYCLE_STATES.STARTING;
    lastContext = context;

    return trackTransition((async () => {
      try {
        for (const participant of orderedParticipants) {
          await participant.start(context);
          activeParticipants.push(participant);
        }
        state = LIFECYCLE_STATES.RUNNING;
      } catch (startError) {
        const rollbackErrors = await destroyActiveParticipants(context);
        state = rollbackErrors.length === 0
          ? LIFECYCLE_STATES.IDLE
          : LIFECYCLE_STATES.FAILED;

        if (rollbackErrors.length === 0) throw startError;

        throw new AggregateError(
          [startError, ...rollbackErrors],
          'Application startup failed and rollback was incomplete.'
        );
      }
    })());
  }

  function beginDestroy(context) {
    state = LIFECYCLE_STATES.STOPPING;
    lastContext = context ?? lastContext;

    return trackTransition((async () => {
      const errors = await destroyActiveParticipants(lastContext);
      state = errors.length === 0
        ? LIFECYCLE_STATES.IDLE
        : LIFECYCLE_STATES.FAILED;

      if (errors.length > 0) {
        throw new AggregateError(
          errors,
          'Application shutdown completed with lifecycle errors.'
        );
      }
    })());
  }

  const lifecycle = {
    get state() {
      return state;
    },
    start(context) {
      if (state === LIFECYCLE_STATES.RUNNING) return Promise.resolve();
      if (state === LIFECYCLE_STATES.STARTING) return transitionPromise;
      if (state === LIFECYCLE_STATES.STOPPING) {
        return transitionPromise.then(() => lifecycle.start(context));
      }
      if (state === LIFECYCLE_STATES.FAILED) {
        return Promise.reject(
          new Error('Application lifecycle cannot start while cleanup is incomplete.')
        );
      }
      return beginStart(context);
    },
    destroy(context) {
      if (state === LIFECYCLE_STATES.IDLE) return Promise.resolve();
      if (state === LIFECYCLE_STATES.STOPPING) return transitionPromise;
      if (state === LIFECYCLE_STATES.STARTING) {
        return transitionPromise.then(
          () => lifecycle.destroy(context),
          () => lifecycle.destroy(context)
        );
      }
      return beginDestroy(context);
    }
  };

  return Object.freeze(lifecycle);
}
