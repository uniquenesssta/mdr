export const HYBRID_COMPONENT_MODES = Object.freeze({
  PRESENTED: 'presented',
  DIRECT: 'direct',
  SOURCE: 'source'
});

const INTERACTIVE_MODES = new Set([
  HYBRID_COMPONENT_MODES.DIRECT,
  HYBRID_COMPONENT_MODES.SOURCE
]);

function normalizeType(value) {
  return String(value || 'block').trim().toLowerCase() || 'block';
}

function normalizePosition(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function cloneState(state) {
  return state ? { ...state, details: { ...state.details } } : null;
}

function isInteractive(mode) {
  return INTERACTIVE_MODES.has(mode);
}

export function createHybridComponentKey(type, from) {
  return `${normalizeType(type)}:${normalizePosition(from)}`;
}

export class HybridComponentSession {
  constructor(options = {}) {
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.onTransition = typeof options.onTransition === 'function' ? options.onTransition : null;
    this.records = new Map();
    this.current = null;
    this.version = 0;
    this.closerBinding = null;
    this.destroyed = false;
  }

  get(key) {
    return cloneState(this.records.get(String(key || '')) || null);
  }

  getCurrent() {
    return cloneState(this.current);
  }

  getActive() {
    return this.getCurrent();
  }

  snapshot() {
    return Array.from(this.records.values(), cloneState);
  }

  transition(request = {}) {
    this.#assertAlive();
    const type = normalizeType(request.type);
    const from = normalizePosition(request.from);
    const key = String(request.key || createHybridComponentKey(type, from));
    const mode = String(request.mode || HYBRID_COMPONENT_MODES.PRESENTED);
    if (!Object.values(HYBRID_COMPONENT_MODES).includes(mode)) {
      throw new TypeError(`Unsupported hybrid component mode: ${mode}`);
    }

    const transitions = [];
    if (isInteractive(mode) && this.current && this.current.key !== key) {
      const currentBeforeClose = this.current;
      const binding = this.closerBinding;
      if (binding
        && binding.key === currentBeforeClose.key
        && binding.version === currentBeforeClose.version) {
        binding.closer({ reason: 'superseded', nextKey: key, nextMode: mode });
      }

      const active = this.current;
      if (active && active.key !== key && isInteractive(active.mode)) {
        transitions.push(this.#apply({
          ...active,
          mode: HYBRID_COMPONENT_MODES.PRESENTED,
          reason: 'superseded',
          details: {
            ...active.details,
            supersededBy: key
          }
        }));
      }
    }

    const previous = this.records.get(key) || {
      key,
      type,
      from,
      mode: HYBRID_COMPONENT_MODES.PRESENTED,
      revision: 0,
      version: 0,
      reason: 'initial',
      details: {},
      updatedAt: this.now()
    };
    const details = {
      ...previous.details,
      ...(request.details && typeof request.details === 'object' ? request.details : {})
    };
    const next = this.#apply({
      ...previous,
      key,
      type,
      from,
      mode,
      reason: String(request.reason || 'transition'),
      details
    });
    transitions.push(next);
    return {
      state: cloneState(next),
      transitions: transitions.map(cloneState)
    };
  }

  close(key, reason = 'closed', details = {}, expectedMode = null) {
    this.#assertAlive();
    const current = this.records.get(String(key || ''));
    if (expectedMode && current?.mode !== expectedMode) return cloneState(current || null);
    if (!current || current.mode === HYBRID_COMPONENT_MODES.PRESENTED) {
      return cloneState(current || null);
    }
    return this.transition({
      key: current.key,
      type: current.type,
      from: current.from,
      mode: HYBRID_COMPONENT_MODES.PRESENTED,
      reason,
      details
    }).state;
  }

  registerCloser(key, closer) {
    this.#assertAlive();
    if (!key || typeof closer !== 'function') return () => {};
    const current = this.current;
    if (!current || current.key !== String(key)) return () => {};

    const binding = {
      key: current.key,
      version: current.version,
      closer
    };
    this.closerBinding = binding;
    return () => {
      if (this.closerBinding === binding) this.closerBinding = null;
    };
  }

  clear() {
    this.#assertAlive();
    this.records.clear();
    this.current = null;
    this.closerBinding = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.records.clear();
    this.current = null;
    this.closerBinding = null;
    this.onTransition = null;
  }

  #assertAlive() {
    if (this.destroyed) throw new Error('HybridComponentSession is destroyed');
  }

  #apply(next) {
    const previous = this.records.get(next.key) || null;
    const version = ++this.version;
    const state = {
      ...next,
      revision: version,
      version,
      updatedAt: this.now(),
      details: { ...(next.details || {}) }
    };

    if (this.closerBinding?.key === state.key) this.closerBinding = null;
    this.records.set(state.key, state);
    if (isInteractive(state.mode)) this.current = state;
    else if (this.current?.key === state.key) this.current = null;

    this.onTransition?.({
      previous: cloneState(previous),
      current: cloneState(state)
    });
    return state;
  }
}

const sessions = new WeakMap();

export function getHybridComponentSession(view, options = {}) {
  if (!view) return null;
  let session = sessions.get(view);
  if (!session || session.destroyed) {
    session = new HybridComponentSession(options);
    sessions.set(view, session);
  }
  return session;
}

export function transitionHybridComponent(view, request) {
  const session = getHybridComponentSession(view);
  if (!session) return null;
  const nextKey = String(request?.key || createHybridComponentKey(request?.type, request?.from));
  return session.transition({ ...request, key: nextKey }).state;
}

export function closeHybridComponent(view, key, reason, details, expectedMode = null) {
  const session = getHybridComponentSession(view);
  if (!session) return null;
  return session.close(key, reason, details, expectedMode);
}

export function registerHybridComponentCloser(view, key, closer) {
  const session = getHybridComponentSession(view);
  return session?.registerCloser(key, closer) || (() => {});
}

export function getHybridComponentState(view, key) {
  return getHybridComponentSession(view)?.get(key) || null;
}

export function getHybridComponentStateSnapshot(view) {
  return getHybridComponentSession(view)?.snapshot() || [];
}

export function destroyHybridComponentSession(view) {
  if (!view) return;
  const session = sessions.get(view);
  session?.destroy();
  sessions.delete(view);
}

export function clearHybridComponentStates(view) {
  destroyHybridComponentSession(view);
}
