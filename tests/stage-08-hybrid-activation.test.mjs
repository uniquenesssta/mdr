import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HYBRID_SOURCE_ACTIVATION_KEYS,
  HybridComponentSession,
  bindOutsidePointerClosure,
  bindSourceActivation,
  getHybridComponentSession
} from '../src/features/hybrid-editor/index.js';

function createSurface() {
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

function keyEvent(key, target = null) {
  return {
    key,
    target,
    prevented: false,
    preventDefault() { this.prevented = true; }
  };
}

test('Atomic 8.3 keyboard source activation preserves Enter/F2 defaults and explicit empty-key opt-out', () => {
  assert.deepEqual(HYBRID_SOURCE_ACTIVATION_KEYS, ['Enter', 'F2']);
  const surface = createSurface();
  const activations = [];
  const dispose = bindSourceActivation(surface, (event, detail) => activations.push([event.key, detail]));
  const enter = keyEvent('Enter');
  const f2 = keyEvent('F2');
  const escape = keyEvent('Escape');
  surface.emit('keydown', enter);
  surface.emit('keydown', f2);
  surface.emit('keydown', escape);
  assert.equal(enter.prevented, true);
  assert.equal(f2.prevented, true);
  assert.equal(escape.prevented, false);
  assert.deepEqual(activations.map(item => item[0]), ['Enter', 'F2']);
  dispose();
  assert.equal(surface.has('keydown'), false);

  const disabled = createSurface();
  let disabledCalls = 0;
  bindSourceActivation(disabled, () => { disabledCalls += 1; }, { sourceKeys: [] });
  disabled.emit('keydown', keyEvent('F2'));
  assert.equal(disabledCalls, 0);
});

test('Atomic 8.3 keyboard source activation excludes interactive descendants', () => {
  const surface = createSurface();
  let calls = 0;
  bindSourceActivation(surface, () => { calls += 1; });
  const event = keyEvent('F2', { closest: selector => selector.includes('button') ? {} : null });
  surface.emit('keydown', event);
  assert.equal(calls, 0);
  assert.equal(event.prevented, false);
});

test('Atomic 8.3 Session owns document-level listener cleanup and destroy is terminal', () => {
  const session = new HybridComponentSession();
  const documentTarget = createSurface();
  let calls = 0;
  const dispose = session.registerDocumentListener(documentTarget, 'pointerdown', () => { calls += 1; }, true);
  documentTarget.emit('pointerdown', {});
  assert.equal(calls, 1);
  dispose();
  dispose();
  assert.equal(documentTarget.has('pointerdown'), false);

  session.registerDocumentListener(documentTarget, 'pointerdown', () => { calls += 1; }, true);
  assert.equal(documentTarget.has('pointerdown'), true);
  session.destroy();
  session.destroy();
  assert.equal(documentTarget.has('pointerdown'), false);
  assert.throws(() => session.registerDocumentListener(documentTarget, 'pointerdown', () => {}), /destroyed/);
});

test('Atomic 8.3 outside-pointer binder registers through the view Session and ignores the owned element', () => {
  const view = {};
  const documentTarget = createSurface();
  const element = {
    ownerDocument: documentTarget,
    isConnected: true,
    contains(target) { return target?.inside === true; }
  };
  const outside = [];
  const dispose = bindOutsidePointerClosure(view, element, event => outside.push(event.target));
  documentTarget.emit('pointerdown', { target: { inside: true } });
  documentTarget.emit('pointerdown', { target: { inside: false } });
  assert.equal(outside.length, 1);
  assert.equal(getHybridComponentSession(view).documentListenerDisposers.size, 1);
  dispose();
  assert.equal(documentTarget.has('pointerdown'), false);
});

test('Atomic 8.3 Session destruction removes an undisposed outside-pointer document listener', () => {
  const view = {};
  const documentTarget = createSurface();
  const element = { ownerDocument: documentTarget, contains: () => false };
  let calls = 0;
  bindOutsidePointerClosure(view, element, () => { calls += 1; });
  assert.equal(documentTarget.has('pointerdown'), true);
  getHybridComponentSession(view).destroy();
  assert.equal(documentTarget.has('pointerdown'), false);
  documentTarget.emit('pointerdown', { target: {} });
  assert.equal(calls, 0);
});

function sourceView({ docLength = 100, position = null } = {}) {
  const dispatches = [];
  let blurred = 0;
  return {
    state: { doc: { length: docLength } },
    posAtCoords: () => position,
    dispatch(spec) { dispatches.push(spec); },
    contentDOM: { blur() { blurred += 1; } },
    get dispatches() { return dispatches; },
    get blurred() { return blurred; }
  };
}

function pointerEvent(target = null) {
  return {
    button: 0,
    clientX: 10,
    clientY: 20,
    target,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }
  };
}
