import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowState } from '../../../src/features/window/window-state.js';

test('Atomic 6.13 WindowState owns one immutable normalized desktop-window snapshot', () => {
  const state = createWindowState();
  assert.deepEqual(state.snapshot, { available: false, maximized: false, closePhase: 'idle', revision: 0 });
  assert.ok(Object.isFrozen(state.snapshot));

  assert.equal(state.setAvailable(true), true);
  assert.equal(state.setMaximized(true), true);
  assert.equal(state.setClosePhase('saving'), true);
  assert.deepEqual(state.snapshot, { available: true, maximized: true, closePhase: 'saving', revision: 3 });
  assert.equal(state.setClosePhase('saving'), false);
  assert.throws(() => state.setClosePhase('unknown'), /Invalid Window close phase/);
});

test('WindowState availability reset clears native-only state without creating a second owner', () => {
  const state = createWindowState({ available: true, maximized: true, closePhase: 'committed' });
  state.setAvailable(false);
  assert.deepEqual(state.snapshot, { available: false, maximized: false, closePhase: 'idle', revision: 1 });
  assert.equal(state.setMaximized(true), false);
  assert.equal(state.setClosePhase('saving'), false);
});

test('WindowState publishes committed snapshots, keeps sibling listeners running and unsubscribe is idempotent', () => {
  const state = createWindowState({ available: true });
  const seen = [];
  const expected = new Error('listener failed');
  const disposeFailing = state.subscribe(() => { throw expected; });
  const disposeSeen = state.subscribe(event => seen.push(event));

  assert.throws(() => state.setMaximized(true), error => error === expected);
  assert.equal(state.snapshot.maximized, true);
  assert.equal(seen.length, 1);
  assert.ok(Object.isFrozen(seen[0]));
  assert.ok(Object.isFrozen(seen[0].snapshot));
  disposeFailing();
  disposeFailing();
  disposeSeen();
  disposeSeen();
  state.setMaximized(false);
  assert.equal(seen.length, 1);
});

test('WindowState destroy is idempotent and terminal', () => {
  const state = createWindowState({ available: true });
  state.destroy();
  state.destroy();
  assert.throws(() => state.snapshot, /WindowState is destroyed/);
  assert.throws(() => state.setAvailable(false), /WindowState is destroyed/);
  assert.throws(() => state.subscribe(() => {}), /WindowState is destroyed/);
});
