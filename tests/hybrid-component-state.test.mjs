import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HYBRID_COMPONENT_MODES,
  HybridComponentStateMachine,
  createHybridComponentKey
} from '../src/editor/hybrid/component-state.js';

test('component keys are stable by type and source position', () => {
  assert.equal(createHybridComponentKey('Mermaid', 42), 'mermaid:42');
  assert.equal(createHybridComponentKey('table', -5), 'table:0');
});

test('only one component may remain interactive', () => {
  const transitions = [];
  const machine = new HybridComponentStateMachine({
    now: () => 100,
    onTransition: transition => transitions.push(transition)
  });
  machine.transition({ type: 'code', from: 10, mode: HYBRID_COMPONENT_MODES.DIRECT, reason: 'doubleclick' });
  machine.transition({ type: 'table', from: 80, mode: HYBRID_COMPONENT_MODES.SOURCE, reason: 'button' });

  assert.equal(machine.get('code:10').mode, HYBRID_COMPONENT_MODES.PRESENTED);
  assert.equal(machine.get('code:10').reason, 'superseded');
  assert.equal(machine.get('table:80').mode, HYBRID_COMPONENT_MODES.SOURCE);
  assert.equal(transitions.at(-2).current.key, 'code:10');
  assert.equal(transitions.at(-1).current.key, 'table:80');
});

test('direct and source edit return deterministically to presentation', () => {
  const machine = new HybridComponentStateMachine();
  machine.transition({ type: 'mermaid', from: 120, mode: HYBRID_COMPONENT_MODES.DIRECT, reason: 'doubleclick' });
  assert.equal(machine.get('mermaid:120').mode, HYBRID_COMPONENT_MODES.DIRECT);

  machine.transition({ type: 'mermaid', from: 120, mode: HYBRID_COMPONENT_MODES.SOURCE, reason: 'source-button' });
  assert.equal(machine.get('mermaid:120').mode, HYBRID_COMPONENT_MODES.SOURCE);

  machine.close('mermaid:120', 'pointer-outside-source');
  assert.equal(machine.get('mermaid:120').mode, HYBRID_COMPONENT_MODES.PRESENTED);
  assert.equal(machine.get('mermaid:120').reason, 'pointer-outside-source');
});

test('runtime coordinator asks the previous component to close before opening another', async () => {
  const {
    clearHybridComponentStates,
    getHybridComponentState,
    registerHybridComponentCloser,
    transitionHybridComponent
  } = await import('../src/editor/hybrid/component-state.js');
  const view = {};
  let closeCalls = 0;
  transitionHybridComponent(view, {
    type: 'code',
    from: 10,
    mode: HYBRID_COMPONENT_MODES.DIRECT,
    reason: 'doubleclick'
  });
  registerHybridComponentCloser(view, 'code:10', () => { closeCalls += 1; });
  transitionHybridComponent(view, {
    type: 'table',
    from: 80,
    mode: HYBRID_COMPONENT_MODES.SOURCE,
    reason: 'button'
  });

  assert.equal(closeCalls, 1);
  assert.equal(getHybridComponentState(view, 'code:10').mode, HYBRID_COMPONENT_MODES.PRESENTED);
  assert.equal(getHybridComponentState(view, 'table:80').mode, HYBRID_COMPONENT_MODES.SOURCE);
  clearHybridComponentStates(view);
});

test('a delayed direct-editor blur cannot close an already opened source editor', async () => {
  const {
    clearHybridComponentStates,
    closeHybridComponent,
    getHybridComponentState,
    transitionHybridComponent
  } = await import('../src/editor/hybrid/component-state.js');
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
  closeHybridComponent(
    view,
    'mermaid:120',
    'blur',
    {},
    HYBRID_COMPONENT_MODES.DIRECT
  );
  assert.equal(getHybridComponentState(view, 'mermaid:120').mode, HYBRID_COMPONENT_MODES.SOURCE);
  clearHybridComponentStates(view);
});
