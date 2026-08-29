/**
 * Responsibility: Own the canonical desktop-window state snapshot for the Window feature.
 * Imports: None.
 * Exports: createWindowState().
 * State/side effects: Owns available, maximized and closePhase only; publishes immutable snapshots.
 * Lifecycle: Explicit terminal destroy; subscriptions are idempotently disposable.
 */

const CLOSE_PHASES = new Set(['idle', 'saving', 'committed']);

function freezeSnapshot({ available = false, maximized = false, closePhase = 'idle', revision = 0 } = {}) {
  if (!CLOSE_PHASES.has(closePhase)) throw new TypeError(`Invalid Window close phase: ${closePhase}.`);
  return Object.freeze({
    available: Boolean(available),
    maximized: Boolean(maximized),
    closePhase,
    revision: Math.max(0, Math.floor(Number(revision) || 0))
  });
}

export function createWindowState(initial = {}) {
  let snapshot = freezeSnapshot(initial);
  let destroyed = false;
  const listeners = new Set();

  function assertActive() {
    if (destroyed) throw new Error('WindowState is destroyed.');
  }

  function commit(changes) {
    assertActive();
    const candidate = freezeSnapshot({ ...snapshot, ...changes, revision: snapshot.revision });
    if (
      candidate.available === snapshot.available &&
      candidate.maximized === snapshot.maximized &&
      candidate.closePhase === snapshot.closePhase
    ) return false;
    const previous = snapshot;
    snapshot = freezeSnapshot({ ...candidate, revision: previous.revision + 1 });
    const event = Object.freeze({ previous, snapshot });
    const errors = [];
    for (const listener of [...listeners]) {
      try { listener(event); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'WindowState listener failures.');
    return true;
  }

  const state = {
    get snapshot() {
      assertActive();
      return snapshot;
    },
    setAvailable(value) {
      const available = Boolean(value);
      return commit({
        available,
        maximized: available ? snapshot.maximized : false,
        closePhase: available ? snapshot.closePhase : 'idle'
      });
    },
    setMaximized(value) {
      return commit({ maximized: snapshot.available ? Boolean(value) : false });
    },
    setClosePhase(closePhase) {
      if (!CLOSE_PHASES.has(closePhase)) throw new TypeError(`Invalid Window close phase: ${closePhase}.`);
      return commit({ closePhase: snapshot.available ? closePhase : 'idle' });
    },
    subscribe(listener) {
      assertActive();
      if (typeof listener !== 'function') throw new TypeError('WindowState listener must be a function.');
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
    }
  };
  return Object.freeze(state);
}
