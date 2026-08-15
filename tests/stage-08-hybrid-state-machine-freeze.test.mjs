import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HYBRID_COMPONENT_MODES,
  HybridComponentSession,
  clearHybridComponentStates,
  closeHybridComponent,
  createHybridComponentKey,
  getHybridComponentState,
  getHybridComponentSession,
  getHybridComponentStateSnapshot,
  registerHybridComponentCloser,
  transitionHybridComponent,
  STRICT_DOUBLE_ACTIVATION_DISTANCE_PX,
  STRICT_DOUBLE_ACTIVATION_INTERVAL_MS,
  bindStrictDoubleActivation,
  evaluateStrictDoubleActivation
} from '../src/features/hybrid-editor/index.js';

const widgetsUrl = new URL('../src/editor/hybrid/widgets.js', import.meta.url);
const controllerUrl = new URL('../src/editor/hybrid/controller.js', import.meta.url);
const sourceEditControllerUrl = new URL('../src/features/hybrid-editor/application/hybrid-source-edit-controller.js', import.meta.url);
const tableCellEditorUrl = new URL('../src/features/hybrid-editor/widgets/table/table-cell-editor.js', import.meta.url);

function click({
  detail = 1,
  timeStamp = 0,
  clientX = 0,
  clientY = 0,
  button = 0,
  defaultPrevented = false,
  targetKey = 'root'
} = {}) {
  return {
    detail,
    timeStamp,
    clientX,
    clientY,
    button,
    defaultPrevented,
    targetKey,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }
  };
}

function createEventSurface() {
  const handlers = new Map();
  return {
    addEventListener(type, handler) { handlers.set(type, handler); },
    removeEventListener(type, handler) {
      if (handlers.get(type) === handler) handlers.delete(type);
    },
    emit(type, event) { handlers.get(type)?.(event); },
    has(type) { return handlers.has(type); }
  };
}

test('Atomic 8.1 freezes the exact presented/direct/source mode vocabulary and rejects unknown modes', () => {
  assert.deepEqual(HYBRID_COMPONENT_MODES, {
    PRESENTED: 'presented',
    DIRECT: 'direct',
    SOURCE: 'source'
  });
  const machine = new HybridComponentSession();
  assert.throws(
    () => machine.transition({ type: 'code', from: 10, mode: 'editing' }),
    /Unsupported hybrid component mode: editing/
  );
  assert.equal(machine.snapshot().length, 0);
});

test('Atomic 8.1 freezes same-component presented/direct/source transitions, reasons and monotonic revisions', () => {
  let now = 100;
  const machine = new HybridComponentSession({ now: () => ++now });
  const key = createHybridComponentKey('Mermaid', 42);

  const direct = machine.transition({
    type: 'Mermaid',
    from: 42,
    mode: HYBRID_COMPONENT_MODES.DIRECT,
    reason: 'doubleclick',
    details: { trigger: 'gesture' }
  }).state;
  const source = machine.transition({
    key,
    type: 'mermaid',
    from: 42,
    mode: HYBRID_COMPONENT_MODES.SOURCE,
    reason: 'source-button',
    details: { sourceFrom: 42, sourceTo: 80 }
  }).state;
  const presented = machine.close(key, 'selection-left', { trigger: 'selection-left' });

  assert.deepEqual(
    [direct.mode, source.mode, presented.mode],
    [HYBRID_COMPONENT_MODES.DIRECT, HYBRID_COMPONENT_MODES.SOURCE, HYBRID_COMPONENT_MODES.PRESENTED]
  );
  assert.deepEqual([direct.revision, source.revision, presented.revision], [1, 2, 3]);
  assert.deepEqual([direct.reason, source.reason, presented.reason], ['doubleclick', 'source-button', 'selection-left']);
  assert.equal(machine.getActive(), null);
  assert.deepEqual(machine.get(key).details, {
    trigger: 'selection-left',
    sourceFrom: 42,
    sourceTo: 80
  });
});

test('Atomic 8.1 freezes cross-component mutual exclusion and superseded metadata', () => {
  const transitions = [];
  const machine = new HybridComponentSession({ onTransition: event => transitions.push(event.current) });
  machine.transition({ type: 'code', from: 10, mode: HYBRID_COMPONENT_MODES.DIRECT, reason: 'doubleclick' });
  machine.transition({ type: 'table', from: 80, mode: HYBRID_COMPONENT_MODES.SOURCE, reason: 'source-button' });

  const code = machine.get('code:10');
  const table = machine.get('table:80');
  assert.equal(code.mode, HYBRID_COMPONENT_MODES.PRESENTED);
  assert.equal(code.reason, 'superseded');
  assert.equal(code.details.supersededBy, 'table:80');
  assert.equal(table.mode, HYBRID_COMPONENT_MODES.SOURCE);
  assert.equal(machine.getActive().key, 'table:80');
  assert.deepEqual(transitions.slice(-2).map(state => [state.key, state.mode]), [
    ['code:10', HYBRID_COMPONENT_MODES.PRESENTED],
    ['table:80', HYBRID_COMPONENT_MODES.SOURCE]
  ]);
});

test('Atomic 8.1 freezes runtime closer ordering before a different component becomes active', () => {
  const view = {};
  const observations = [];
  transitionHybridComponent(view, {
    type: 'code',
    from: 10,
    mode: HYBRID_COMPONENT_MODES.DIRECT,
    reason: 'doubleclick'
  });
  registerHybridComponentCloser(view, 'code:10', event => {
    observations.push({ event, active: getHybridComponentSession(view).getActive() });
    closeHybridComponent(
      view,
      'code:10',
      'unchanged',
      { trigger: 'superseding-open' },
      HYBRID_COMPONENT_MODES.DIRECT
    );
  });

  transitionHybridComponent(view, {
    type: 'table',
    from: 80,
    mode: HYBRID_COMPONENT_MODES.SOURCE,
    reason: 'source-button'
  });

  assert.equal(observations.length, 1);
  assert.equal(observations[0].event.reason, 'superseded');
  assert.equal(observations[0].event.nextKey, 'table:80');
  assert.equal(observations[0].active.key, 'code:10');
  assert.equal(observations[0].active.mode, HYBRID_COMPONENT_MODES.DIRECT);
  assert.equal(getHybridComponentState(view, 'code:10').reason, 'unchanged');
  assert.equal(getHybridComponentState(view, 'table:80').mode, HYBRID_COMPONENT_MODES.SOURCE);
  clearHybridComponentStates(view);
});

test('Atomic 8.1 freezes stale delayed-close rejection with expectedMode', () => {
  const view = {};
  transitionHybridComponent(view, {
    type: 'mermaid',
    from: 120,
    mode: HYBRID_COMPONENT_MODES.DIRECT,
    reason: 'doubleclick'
  });
  transitionHybridComponent(view, {
    type: 'mermaid',
    from: 120,
    mode: HYBRID_COMPONENT_MODES.SOURCE,
    reason: 'source-button'
  });

  const stale = closeHybridComponent(
    view,
    'mermaid:120',
    'blur',
    { delayed: true },
    HYBRID_COMPONENT_MODES.DIRECT
  );
  assert.equal(stale.mode, HYBRID_COMPONENT_MODES.SOURCE);
  assert.equal(stale.reason, 'source-button');

  const current = closeHybridComponent(
    view,
    'mermaid:120',
    'pointer-outside-source',
    { delayed: false },
    HYBRID_COMPONENT_MODES.SOURCE
  );
  assert.equal(current.mode, HYBRID_COMPONENT_MODES.PRESENTED);
  assert.equal(current.reason, 'pointer-outside-source');
  clearHybridComponentStates(view);
});

test('Atomic 8.1 freezes current runtime close-reason producers', async () => {
  const [widgets, tableCellEditor, controller, sourceEditController] = await Promise.all([
    readFile(widgetsUrl, 'utf8'),
    readFile(tableCellEditorUrl, 'utf8'),
    readFile(controllerUrl, 'utf8'),
    readFile(sourceEditControllerUrl, 'utf8')
  ]);
  const directCloseSources = `${widgets}\n${tableCellEditor}`;

  for (const reason of ['cancelled', 'committed', 'unchanged', 'pointer-outside']) {
    assert.match(directCloseSources, new RegExp(`reason:\\s*[^\\n]{0,160}['\"]${reason}['\"]|['\"]${reason}['\"]`), `missing direct close reason: ${reason}`);
  }
  assert.match(sourceEditController, /this\.close\('pointer-outside-source'/);
  assert.match(sourceEditController, /trigger: 'pointer-outside-source'/);
  assert.match(controller, /sourceEditPort\.closeFromPointer\(/);
  assert.match(sourceEditController, /this\.close\('selection-left'/);
  assert.match(sourceEditController, /trigger: 'selection-left'/);
});

test('Atomic 8.1 freezes clear/destroy semantics for state and registered closers', () => {
  const view = {};
  let staleCloserCalls = 0;
  transitionHybridComponent(view, {
    type: 'code',
    from: 10,
    mode: HYBRID_COMPONENT_MODES.DIRECT,
    reason: 'doubleclick'
  });
  registerHybridComponentCloser(view, 'code:10', () => { staleCloserCalls += 1; });
  assert.equal(getHybridComponentStateSnapshot(view).length, 1);

  clearHybridComponentStates(view);
  assert.equal(getHybridComponentState(view, 'code:10'), null);
  assert.deepEqual(getHybridComponentStateSnapshot(view), []);

  transitionHybridComponent(view, {
    type: 'table',
    from: 80,
    mode: HYBRID_COMPONENT_MODES.SOURCE,
    reason: 'source-button'
  });
  assert.equal(staleCloserCalls, 0);
  assert.equal(getHybridComponentState(view, 'table:80').mode, HYBRID_COMPONENT_MODES.SOURCE);
  clearHybridComponentStates(view);
});

test('Atomic 8.1 freezes strict double-activation time, target, button and distance boundaries', () => {
  const first = { timestamp: 100, clientX: 10, clientY: 10, button: 0, targetKey: 'code:10' };
  const atTimeLimit = { ...first, timestamp: 100 + STRICT_DOUBLE_ACTIVATION_INTERVAL_MS };
  const afterTimeLimit = { ...first, timestamp: 101 + STRICT_DOUBLE_ACTIVATION_INTERVAL_MS };
  const atDistanceLimit = { ...first, timestamp: 120, clientX: 10 + STRICT_DOUBLE_ACTIVATION_DISTANCE_PX };
  const afterDistanceLimit = { ...first, timestamp: 120, clientX: 10 + STRICT_DOUBLE_ACTIVATION_DISTANCE_PX + 0.1 };

  assert.equal(evaluateStrictDoubleActivation(first, atTimeLimit).accepted, true);
  assert.equal(evaluateStrictDoubleActivation(first, afterTimeLimit).reason, 'interval-exceeded');
  assert.equal(evaluateStrictDoubleActivation(first, atDistanceLimit).accepted, true);
  assert.equal(evaluateStrictDoubleActivation(first, afterDistanceLimit).reason, 'distance-exceeded');
  assert.equal(evaluateStrictDoubleActivation(first, { ...atTimeLimit, targetKey: 'code:20' }).reason, 'target-mismatch');
  assert.equal(evaluateStrictDoubleActivation(first, { ...atTimeLimit, button: 1 }).reason, 'button-mismatch');
  assert.equal(evaluateStrictDoubleActivation(null, atTimeLimit).reason, 'missing-click');
});

test('Atomic 8.1 freezes click-sequence reset and delayed second-click activation semantics', () => {
  const surface = createEventSurface();
  const activations = [];
  const rejections = [];
  const dispose = bindStrictDoubleActivation(surface, (event, result) => {
    activations.push({ event, result });
  }, {
    getTargetKey: event => event.targetKey,
    exclude: event => event.excluded === true,
    onRejected: result => rejections.push(result.reason)
  });

  const first = click({ detail: 1, timeStamp: 100, clientX: 4, clientY: 4, targetKey: 'table:1:1' });
  const second = click({ detail: 2, timeStamp: 180, clientX: 5, clientY: 4, targetKey: 'table:1:1' });
  surface.emit('click', first);
  surface.emit('click', second);
  assert.equal(activations.length, 1);
  assert.equal(activations[0].result.reason, 'accepted');
  assert.equal(second.prevented, true);
  assert.equal(second.stopped, true);

  const reset = click({ detail: 1, timeStamp: 300, targetKey: 'table:1:1' });
  reset.excluded = true;
  surface.emit('click', reset);
  const orphanSecond = click({ detail: 2, timeStamp: 320, targetKey: 'table:1:1' });
  surface.emit('click', orphanSecond);
  assert.equal(activations.length, 1);
  assert.deepEqual(rejections, ['missing-click']);

  const nativeDoubleClick = click({ detail: 2, timeStamp: 330, targetKey: 'table:1:1' });
  surface.emit('dblclick', nativeDoubleClick);
  assert.equal(nativeDoubleClick.prevented, true);
  assert.equal(nativeDoubleClick.stopped, true);

  dispose();
  assert.equal(surface.has('click'), false);
  assert.equal(surface.has('dblclick'), false);
});

test('Atomic 8.1 freezes snapshots as detached read models rather than writable state authority', () => {
  const machine = new HybridComponentSession();
  machine.transition({
    type: 'code',
    from: 10,
    mode: HYBRID_COMPONENT_MODES.DIRECT,
    reason: 'doubleclick',
    details: { row: 1 }
  });
  const read = machine.get('code:10');
  const snapshot = machine.snapshot();
  read.mode = HYBRID_COMPONENT_MODES.SOURCE;
  read.details.row = 99;
  snapshot[0].details.row = 77;

  assert.equal(machine.get('code:10').mode, HYBRID_COMPONENT_MODES.DIRECT);
  assert.equal(machine.get('code:10').details.row, 1);
});
