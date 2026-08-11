import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutState } from '../../../src/features/layout/state/layout-state.js';
import { createSystemFullscreenController } from '../../../src/features/layout/fullscreen/system-fullscreen-controller.js';

function createHarness({ supported = true, enterError = null } = {}) {
  const state = createLayoutState();
  let active = false;
  let subscriber = null;
  let disposed = 0;
  const calls = [];
  const fullscreen = {
    isEnabled() { calls.push('isEnabled'); return supported; },
    isActive() { calls.push('isActive'); return active; },
    async enter() {
      calls.push('enter');
      if (enterError) throw enterError;
      active = true;
    },
    async exit() { calls.push('exit'); active = false; },
    subscribe(handler) {
      calls.push('subscribe');
      subscriber = handler;
      return () => { disposed += 1; };
    }
  };
  const controller = createSystemFullscreenController({ state, fullscreen, supported });
  return {
    state, fullscreen, calls, controller,
    emit(value) { subscriber?.(value); },
    setActive(value) { active = Boolean(value); },
    get disposed() { return disposed; }
  };
}

test('Atomic 6.6 system fullscreen synchronizes initial and subscribed platform state', () => {
  const h = createHarness();
  h.setActive(true);
  h.controller.start();
  assert.equal(h.state.snapshot.fullscreen.system, true);
  h.emit(false);
  assert.equal(h.state.snapshot.fullscreen.system, false);
  assert.ok(h.calls.includes('subscribe'));
  h.controller.destroy();
  h.state.destroy();
});

test('Atomic 6.6 system fullscreen enter and exit use only the platform port', async () => {
  const h = createHarness();
  h.controller.start();
  let result = await h.controller.toggle();
  assert.deepEqual({ ok: result.ok, supported: result.supported, active: result.active, reason: result.reason }, {
    ok: true, supported: true, active: true, reason: 'enter'
  });
  assert.equal(h.state.snapshot.fullscreen.system, true);
  result = await h.controller.toggle();
  assert.deepEqual({ ok: result.ok, active: result.active, reason: result.reason }, {
    ok: true, active: false, reason: 'exit'
  });
  assert.equal(h.state.snapshot.fullscreen.system, false);
  assert.ok(h.calls.includes('enter'));
  assert.ok(h.calls.includes('exit'));
  h.controller.destroy();
  h.state.destroy();
});

test('Atomic 6.6 unsupported system fullscreen returns a controlled result without touching the port', async () => {
  const h = createHarness({ supported: false });
  h.controller.start();
  const result = await h.controller.toggle();
  assert.deepEqual(result, { ok: false, supported: false, active: false, changed: false, reason: 'unsupported' });
  assert.deepEqual(h.calls, []);
  assert.equal(h.state.snapshot.fullscreen.system, false);
  h.controller.destroy();
  h.state.destroy();
});

test('Atomic 6.6 system fullscreen returns operation failure and keeps error evidence', async () => {
  const h = createHarness({ enterError: new Error('request denied') });
  h.controller.start();
  const result = await h.controller.toggle();
  assert.equal(result.ok, false);
  assert.equal(result.supported, true);
  assert.equal(result.reason, 'operation-failed');
  assert.match(result.error.message, /request denied/);
  assert.equal(h.state.snapshot.fullscreen.system, false);
  h.controller.destroy();
  h.state.destroy();
});

test('Atomic 6.6 system fullscreen destroy disposes once and suppresses stale subscription callbacks', () => {
  const h = createHarness();
  h.controller.start();
  h.controller.destroy();
  h.controller.destroy();
  assert.equal(h.disposed, 1);
  h.emit(true);
  assert.equal(h.state.snapshot.fullscreen.system, false);
  assert.throws(() => h.controller.start(), /destroyed/);
  h.state.destroy();
});
