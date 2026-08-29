/**
 * Responsibility: Own the authoritative runtime layout state for sidebar, split panes, layout mode, compact modes, fullscreen and observable resize activity.
 * Imports: None.
 * Exports: createLayoutState().
 * State/side effects: In-memory immutable snapshots and synchronous subscriptions only; no DOM, storage, timers or platform access.
 * Lifecycle: Explicit destroy; destroy clears subscribers and makes all state operations terminal.
 */
const LAYOUT_MODES = new Set(['both', 'hybrid', 'edit', 'preview']);
const COMPACT_PANES = new Set(['editor', 'preview']);

const DEFAULTS = Object.freeze({
  sidebar: Object.freeze({ visible: true, autoCollapsed: false, width: 248 }),
  split: Object.freeze({
    editorCollapsed: false,
    previewCollapsed: false,
    ratio: 0.5,
    compactActive: false,
    compactPane: 'editor'
  }),
  mode: 'both',
  compact: Object.freeze({ shellActive: false, shellInitialized: false }),
  fullscreen: Object.freeze({ page: false, system: false }),
  resize: Object.freeze({
    splitActive: false,
    sidebarActive: false,
    windowActiveUntil: 0,
    windowBurstStartedAt: 0,
    windowBurstEvents: 0
  })
});

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function booleanValue(value) {
  return Boolean(value);
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number.`);
  return number;
}

function nonNegativeNumber(value, label) {
  return Math.max(0, finiteNumber(value, label));
}

function nonNegativeInteger(value, label) {
  return Math.max(0, Math.trunc(finiteNumber(value, label)));
}

function layoutMode(value) {
  const mode = String(value || '');
  if (!LAYOUT_MODES.has(mode)) throw new RangeError(`Unsupported layout mode: ${mode || '<empty>'}.`);
  return mode;
}

function compactPane(value) {
  const pane = String(value || '');
  if (!COMPACT_PANES.has(pane)) throw new RangeError(`Unsupported compact pane: ${pane || '<empty>'}.`);
  return pane;
}

function freezeSnapshot(source) {
  return Object.freeze({
    sidebar: Object.freeze({ ...source.sidebar }),
    split: Object.freeze({ ...source.split }),
    mode: source.mode,
    compact: Object.freeze({ ...source.compact }),
    fullscreen: Object.freeze({ ...source.fullscreen }),
    resize: Object.freeze({ ...source.resize })
  });
}

function normalizeInitial(initial) {
  if (initial === undefined) return DEFAULTS;
  assertPlainObject(initial, 'Layout State initial snapshot');
  const sidebar = initial.sidebar === undefined ? DEFAULTS.sidebar : assertPlainObject(initial.sidebar, 'Layout sidebar state');
  const split = initial.split === undefined ? DEFAULTS.split : assertPlainObject(initial.split, 'Layout split state');
  const compact = initial.compact === undefined ? DEFAULTS.compact : assertPlainObject(initial.compact, 'Layout compact state');
  const fullscreen = initial.fullscreen === undefined ? DEFAULTS.fullscreen : assertPlainObject(initial.fullscreen, 'Layout fullscreen state');
  const resize = initial.resize === undefined ? DEFAULTS.resize : assertPlainObject(initial.resize, 'Layout resize state');
  return freezeSnapshot({
    sidebar: {
      visible: booleanValue(sidebar.visible ?? DEFAULTS.sidebar.visible),
      autoCollapsed: booleanValue(sidebar.autoCollapsed ?? DEFAULTS.sidebar.autoCollapsed),
      width: finiteNumber(sidebar.width ?? DEFAULTS.sidebar.width, 'Sidebar width')
    },
    split: {
      editorCollapsed: booleanValue(split.editorCollapsed ?? DEFAULTS.split.editorCollapsed),
      previewCollapsed: booleanValue(split.previewCollapsed ?? DEFAULTS.split.previewCollapsed),
      ratio: finiteNumber(split.ratio ?? DEFAULTS.split.ratio, 'Editor split ratio'),
      compactActive: booleanValue(split.compactActive ?? DEFAULTS.split.compactActive),
      compactPane: compactPane(split.compactPane ?? DEFAULTS.split.compactPane)
    },
    mode: layoutMode(initial.mode ?? DEFAULTS.mode),
    compact: {
      shellActive: booleanValue(compact.shellActive ?? DEFAULTS.compact.shellActive),
      shellInitialized: booleanValue(compact.shellInitialized ?? DEFAULTS.compact.shellInitialized)
    },
    fullscreen: {
      page: booleanValue(fullscreen.page ?? DEFAULTS.fullscreen.page),
      system: booleanValue(fullscreen.system ?? DEFAULTS.fullscreen.system)
    },
    resize: {
      splitActive: booleanValue(resize.splitActive ?? DEFAULTS.resize.splitActive),
      sidebarActive: booleanValue(resize.sidebarActive ?? DEFAULTS.resize.sidebarActive),
      windowActiveUntil: nonNegativeNumber(resize.windowActiveUntil ?? DEFAULTS.resize.windowActiveUntil, 'Window resize active-until'),
      windowBurstStartedAt: nonNegativeNumber(resize.windowBurstStartedAt ?? DEFAULTS.resize.windowBurstStartedAt, 'Window resize burst start'),
      windowBurstEvents: nonNegativeInteger(resize.windowBurstEvents ?? DEFAULTS.resize.windowBurstEvents, 'Window resize burst events')
    }
  });
}

function shallowEqual(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}

export function createLayoutState(initialSnapshot) {
  let snapshot = normalizeInitial(initialSnapshot);
  let destroyed = false;
  const listeners = new Set();

  const assertActive = () => {
    if (destroyed) throw new Error('Layout State is destroyed.');
  };

  function publish(previous, current, changedGroup) {
    if (previous === current) return current;
    const event = Object.freeze({ previous, current, changedGroup });
    const errors = [];
    for (const listener of [...listeners]) {
      try { listener(event); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Layout State listeners failed.');
    return current;
  }

  function updateGroup(group, patch, normalize) {
    assertActive();
    assertPlainObject(patch, `Layout ${group} changes`);
    const nextGroup = normalize(snapshot[group], patch);
    if (shallowEqual(snapshot[group], nextGroup)) return snapshot;
    const previous = snapshot;
    snapshot = freezeSnapshot({ ...snapshot, [group]: nextGroup });
    return publish(previous, snapshot, group);
  }

  function setSidebar(patch) {
    return updateGroup('sidebar', patch, (current, changes) => {
      const allowed = new Set(['visible', 'autoCollapsed', 'width']);
      for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Unknown sidebar state field: ${key}.`);
      return {
        visible: Object.hasOwn(changes, 'visible') ? booleanValue(changes.visible) : current.visible,
        autoCollapsed: Object.hasOwn(changes, 'autoCollapsed') ? booleanValue(changes.autoCollapsed) : current.autoCollapsed,
        width: Object.hasOwn(changes, 'width') ? finiteNumber(changes.width, 'Sidebar width') : current.width
      };
    });
  }

  function setSplit(patch) {
    return updateGroup('split', patch, (current, changes) => {
      const allowed = new Set(['editorCollapsed', 'previewCollapsed', 'ratio', 'compactActive', 'compactPane']);
      for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Unknown split state field: ${key}.`);
      return {
        editorCollapsed: Object.hasOwn(changes, 'editorCollapsed') ? booleanValue(changes.editorCollapsed) : current.editorCollapsed,
        previewCollapsed: Object.hasOwn(changes, 'previewCollapsed') ? booleanValue(changes.previewCollapsed) : current.previewCollapsed,
        ratio: Object.hasOwn(changes, 'ratio') ? finiteNumber(changes.ratio, 'Editor split ratio') : current.ratio,
        compactActive: Object.hasOwn(changes, 'compactActive') ? booleanValue(changes.compactActive) : current.compactActive,
        compactPane: Object.hasOwn(changes, 'compactPane') ? compactPane(changes.compactPane) : current.compactPane
      };
    });
  }

  function setMode(nextMode) {
    assertActive();
    const normalized = layoutMode(nextMode);
    if (normalized === snapshot.mode) return snapshot;
    const previous = snapshot;
    snapshot = freezeSnapshot({ ...snapshot, mode: normalized });
    return publish(previous, snapshot, 'mode');
  }

  function setCompact(patch) {
    return updateGroup('compact', patch, (current, changes) => {
      const allowed = new Set(['shellActive', 'shellInitialized']);
      for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Unknown compact state field: ${key}.`);
      return {
        shellActive: Object.hasOwn(changes, 'shellActive') ? booleanValue(changes.shellActive) : current.shellActive,
        shellInitialized: Object.hasOwn(changes, 'shellInitialized') ? booleanValue(changes.shellInitialized) : current.shellInitialized
      };
    });
  }

  function setFullscreen(patch) {
    return updateGroup('fullscreen', patch, (current, changes) => {
      const allowed = new Set(['page', 'system']);
      for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Unknown fullscreen state field: ${key}.`);
      return {
        page: Object.hasOwn(changes, 'page') ? booleanValue(changes.page) : current.page,
        system: Object.hasOwn(changes, 'system') ? booleanValue(changes.system) : current.system
      };
    });
  }

  function setResize(patch) {
    return updateGroup('resize', patch, (current, changes) => {
      const allowed = new Set(['splitActive', 'sidebarActive', 'windowActiveUntil', 'windowBurstStartedAt', 'windowBurstEvents']);
      for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Unknown resize state field: ${key}.`);
      return {
        splitActive: Object.hasOwn(changes, 'splitActive') ? booleanValue(changes.splitActive) : current.splitActive,
        sidebarActive: Object.hasOwn(changes, 'sidebarActive') ? booleanValue(changes.sidebarActive) : current.sidebarActive,
        windowActiveUntil: Object.hasOwn(changes, 'windowActiveUntil') ? nonNegativeNumber(changes.windowActiveUntil, 'Window resize active-until') : current.windowActiveUntil,
        windowBurstStartedAt: Object.hasOwn(changes, 'windowBurstStartedAt') ? nonNegativeNumber(changes.windowBurstStartedAt, 'Window resize burst start') : current.windowBurstStartedAt,
        windowBurstEvents: Object.hasOwn(changes, 'windowBurstEvents') ? nonNegativeInteger(changes.windowBurstEvents, 'Window resize burst events') : current.windowBurstEvents
      };
    });
  }

  return Object.freeze({
    get snapshot() {
      assertActive();
      return snapshot;
    },
    setSidebar,
    setSplit,
    setMode,
    setCompact,
    setFullscreen,
    setResize,
    subscribe(listener) {
      assertActive();
      if (typeof listener !== 'function') throw new TypeError('Layout State listener must be a function.');
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
  });
}
