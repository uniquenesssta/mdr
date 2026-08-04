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

export function createHybridComponentKey(type, from) {
  return `${normalizeType(type)}:${normalizePosition(from)}`;
}

export class HybridComponentStateMachine {
  constructor(options = {}) {
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.onTransition = typeof options.onTransition === 'function' ? options.onTransition : null;
    this.states = new Map();
    this.activeKey = null;
    this.revision = 0;
  }

  get(key) {
    const state = this.states.get(String(key || ''));
    return state ? { ...state, details: { ...state.details } } : null;
  }

  getActive() {
    return this.activeKey ? this.get(this.activeKey) : null;
  }

  snapshot() {
    return Array.from(this.states.values(), state => ({
      ...state,
      details: { ...state.details }
    }));
  }

  transition(request = {}) {
    const type = normalizeType(request.type);
    const from = normalizePosition(request.from);
    const key = String(request.key || createHybridComponentKey(type, from));
    const mode = String(request.mode || HYBRID_COMPONENT_MODES.PRESENTED);
    if (!Object.values(HYBRID_COMPONENT_MODES).includes(mode)) {
      throw new TypeError(`Unsupported hybrid component mode: ${mode}`);
    }

    const transitions = [];
    if (INTERACTIVE_MODES.has(mode) && this.activeKey && this.activeKey !== key) {
      const active = this.states.get(this.activeKey);
      if (active && active.mode !== HYBRID_COMPONENT_MODES.PRESENTED) {
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

    const previous = this.states.get(key) || {
      key,
      type,
      from,
      mode: HYBRID_COMPONENT_MODES.PRESENTED,
      revision: 0,
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
      state: { ...next, details: { ...next.details } },
      transitions: transitions.map(state => ({ ...state, details: { ...state.details } }))
    };
  }

  close(key, reason = 'closed', details = {}) {
    const current = this.states.get(String(key || ''));
    if (!current || current.mode === HYBRID_COMPONENT_MODES.PRESENTED) {
      return current ? { ...current, details: { ...current.details } } : null;
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

  clear() {
    this.states.clear();
    this.activeKey = null;
  }

  #apply(next) {
    const previous = this.states.get(next.key) || null;
    const state = {
      ...next,
      revision: ++this.revision,
      updatedAt: this.now(),
      details: { ...(next.details || {}) }
    };
    this.states.set(state.key, state);
    if (INTERACTIVE_MODES.has(state.mode)) this.activeKey = state.key;
    else if (this.activeKey === state.key) this.activeKey = null;
    this.onTransition?.({
      previous: previous ? { ...previous, details: { ...previous.details } } : null,
      current: { ...state, details: { ...state.details } }
    });
    return state;
  }
}

const machines = new WeakMap();
const componentClosers = new WeakMap();

function recordTransition({ previous, current }) {
  globalThis.window?.markdownEditorPerf?.record?.('hybrid.component-state-transition', {
    category: 'editor.hybrid',
    details: {
      key: current.key,
      componentType: current.type,
      componentFrom: current.from,
      previousMode: previous?.mode || null,
      mode: current.mode,
      reason: current.reason,
      revision: current.revision,
      ...current.details
    }
  });
}

export function getHybridComponentStateMachine(view) {
  if (!view) return null;
  let machine = machines.get(view);
  if (!machine) {
    machine = new HybridComponentStateMachine({ onTransition: recordTransition });
    machines.set(view, machine);
  }
  return machine;
}

export function transitionHybridComponent(view, request) {
  const machine = getHybridComponentStateMachine(view);
  if (!machine) return null;
  const nextKey = String(request?.key || createHybridComponentKey(request?.type, request?.from));
  const nextMode = String(request?.mode || HYBRID_COMPONENT_MODES.PRESENTED);
  const active = machine.getActive();
  if (INTERACTIVE_MODES.has(nextMode) && active && active.key !== nextKey) {
    const closer = componentClosers.get(view)?.get(active.key);
    closer?.({ reason: 'superseded', nextKey, nextMode });
  }
  return machine.transition({ ...request, key: nextKey }).state;
}

export function closeHybridComponent(view, key, reason, details, expectedMode = null) {
  const machine = getHybridComponentStateMachine(view);
  if (!machine) return null;
  const current = machine.get(key);
  if (expectedMode && current?.mode !== expectedMode) return current;
  return machine.close(key, reason, details);
}

export function registerHybridComponentCloser(view, key, closer) {
  if (!view || !key || typeof closer !== 'function') return () => {};
  let closers = componentClosers.get(view);
  if (!closers) {
    closers = new Map();
    componentClosers.set(view, closers);
  }
  closers.set(String(key), closer);
  return () => {
    const current = componentClosers.get(view);
    if (!current || current.get(String(key)) !== closer) return;
    current.delete(String(key));
    if (!current.size) componentClosers.delete(view);
  };
}

export function getHybridComponentState(view, key) {
  return getHybridComponentStateMachine(view)?.get(key) || null;
}

export function getHybridComponentStateSnapshot(view) {
  return getHybridComponentStateMachine(view)?.snapshot() || [];
}

export function clearHybridComponentStates(view) {
  const machine = view ? machines.get(view) : null;
  machine?.clear();
  if (view) {
    machines.delete(view);
    componentClosers.delete(view);
  }
}
