import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HYBRID_COMPONENT_MODES,
  HybridComponentSession,
  closeHybridComponent,
  destroyHybridComponentSession,
  getHybridComponentSession,
  getHybridComponentState,
  registerHybridComponentCloser,
  transitionHybridComponent
} from '../src/features/hybrid-editor/index.js';

test('Atomic 8.2 Session is the sole current interactive authority with key/type/mode/version', () => {
  const session = new HybridComponentSession({ now: () => 100 });
  const state = session.transition({
    type: 'Code',
    from: 12,
    mode: HYBRID_COMPONENT_MODES.DIRECT,
    reason: 'doubleclick'
  }).state;
  assert.equal(state.key, 'code:12');
  assert.equal(state.type, 'code');
  assert.equal(state.mode, HYBRID_COMPONENT_MODES.DIRECT);
  assert.equal(state.version, 1);
  assert.equal(state.revision, 1);
  assert.deepEqual(session.getCurrent(), state);
});

test('Atomic 8.2 Session keeps one interactive component and preserves superseded semantics', () => {
  const session = new HybridComponentSession();
  session.transition({ type: 'code', from: 10, mode: HYBRID_COMPONENT_MODES.DIRECT, reason: 'doubleclick' });
  session.transition({ type: 'table', from: 80, mode: HYBRID_COMPONENT_MODES.SOURCE, reason: 'button' });
  assert.equal(session.get('code:10').mode, HYBRID_COMPONENT_MODES.PRESENTED);
  assert.equal(session.get('code:10').reason, 'superseded');
  assert.equal(session.get('code:10').details.supersededBy, 'table:80');
  assert.equal(session.getCurrent().key, 'table:80');
  assert.equal(session.getCurrent().version, 3);
});

test('Atomic 8.2 closer belongs only to the current component version', () => {
  const session = new HybridComponentSession();
  let staleCalls = 0;
  let currentCalls = 0;
  session.transition({ type: 'code', from: 10, mode: HYBRID_COMPONENT_MODES.DIRECT, reason: 'doubleclick' });
  const disposeStale = session.registerCloser('code:10', () => { staleCalls += 1; });
  assert.equal(session.registerCloser('table:80', () => { staleCalls += 100; }) instanceof Function, true);

  session.transition({ type: 'code', from: 10, mode: HYBRID_COMPONENT_MODES.SOURCE, reason: 'source-button' });
  session.registerCloser('code:10', () => { currentCalls += 1; });
  disposeStale();
  session.transition({ type: 'table', from: 80, mode: HYBRID_COMPONENT_MODES.DIRECT, reason: 'doubleclick' });

  assert.equal(staleCalls, 0);
  assert.equal(currentCalls, 1);
});

test('Atomic 8.2 invokes the current closer before a different component activates', () => {
  const view = {};
  const observations = [];
  transitionHybridComponent(view, { type: 'code', from: 10, mode: HYBRID_COMPONENT_MODES.DIRECT, reason: 'doubleclick' });
  registerHybridComponentCloser(view, 'code:10', event => {
    observations.push({ event, current: getHybridComponentSession(view).getCurrent() });
    closeHybridComponent(view, 'code:10', 'unchanged', {}, HYBRID_COMPONENT_MODES.DIRECT);
  });
  transitionHybridComponent(view, { type: 'table', from: 80, mode: HYBRID_COMPONENT_MODES.SOURCE, reason: 'button' });

  assert.equal(observations.length, 1);
  assert.equal(observations[0].event.reason, 'superseded');
  assert.equal(observations[0].current.key, 'code:10');
  assert.equal(getHybridComponentState(view, 'code:10').reason, 'unchanged');
  assert.equal(getHybridComponentSession(view).getCurrent().key, 'table:80');
  destroyHybridComponentSession(view);
});

test('Atomic 8.2 same-key mode change invalidates the previous version closer', () => {
  const session = new HybridComponentSession();
  let directCloserCalls = 0;
  session.transition({ type: 'mermaid', from: 20, mode: HYBRID_COMPONENT_MODES.DIRECT, reason: 'doubleclick' });
  session.registerCloser('mermaid:20', () => { directCloserCalls += 1; });
  session.transition({ type: 'mermaid', from: 20, mode: HYBRID_COMPONENT_MODES.SOURCE, reason: 'source-button' });
  session.transition({ type: 'table', from: 80, mode: HYBRID_COMPONENT_MODES.SOURCE, reason: 'button' });
  assert.equal(directCloserCalls, 0);
  assert.equal(session.get('mermaid:20').reason, 'superseded');
});

test('Atomic 8.2 rejects stale expectedMode closes without advancing version', () => {
  const session = new HybridComponentSession();
  session.transition({ type: 'mermaid', from: 20, mode: HYBRID_COMPONENT_MODES.DIRECT, reason: 'doubleclick' });
  const source = session.transition({ type: 'mermaid', from: 20, mode: HYBRID_COMPONENT_MODES.SOURCE, reason: 'source-button' }).state;
  const stale = session.close('mermaid:20', 'blur', { delayed: true }, HYBRID_COMPONENT_MODES.DIRECT);
  assert.equal(stale.mode, HYBRID_COMPONENT_MODES.SOURCE);
  assert.equal(stale.version, source.version);
  assert.equal(session.getCurrent().version, source.version);
});

test('Atomic 8.2 propagates closer failures and does not activate the requested replacement', () => {
  const session = new HybridComponentSession();
  session.transition({ type: 'code', from: 10, mode: HYBRID_COMPONENT_MODES.DIRECT, reason: 'doubleclick' });
  session.registerCloser('code:10', () => { throw new Error('closer failed'); });
  assert.throws(
    () => session.transition({ type: 'table', from: 80, mode: HYBRID_COMPONENT_MODES.SOURCE, reason: 'button' }),
    /closer failed/
  );
  assert.equal(session.getCurrent().key, 'code:10');
  assert.equal(session.get('table:80'), null);
});

test('Atomic 8.2 destroy is terminal and cannot publish later transitions', () => {
  const transitions = [];
  const session = new HybridComponentSession({ onTransition: event => transitions.push(event) });
  session.transition({ type: 'code', from: 10, mode: HYBRID_COMPONENT_MODES.DIRECT, reason: 'doubleclick' });
  session.destroy();
  assert.equal(session.getCurrent(), null);
  assert.deepEqual(session.snapshot(), []);
  assert.throws(
    () => session.transition({ type: 'table', from: 80, mode: HYBRID_COMPONENT_MODES.SOURCE }),
    /HybridComponentSession is destroyed/
  );
  assert.equal(transitions.length, 1);
});

test('Atomic 8.2 view registry destroy removes state and stale closer ownership', () => {
  const view = {};
  let staleCloserCalls = 0;
  transitionHybridComponent(view, { type: 'code', from: 10, mode: HYBRID_COMPONENT_MODES.DIRECT, reason: 'doubleclick' });
  registerHybridComponentCloser(view, 'code:10', () => { staleCloserCalls += 1; });
  const first = getHybridComponentSession(view);
  destroyHybridComponentSession(view);
  const second = getHybridComponentSession(view);
  assert.notEqual(first, second);
  transitionHybridComponent(view, { type: 'table', from: 80, mode: HYBRID_COMPONENT_MODES.SOURCE, reason: 'button' });
  assert.equal(staleCloserCalls, 0);
  assert.equal(second.getCurrent().key, 'table:80');
  destroyHybridComponentSession(view);
});
