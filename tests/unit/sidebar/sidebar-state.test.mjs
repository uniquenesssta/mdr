import test from 'node:test';
import assert from 'node:assert/strict';
import { createSidebarState, normalizeSidebarTab, SIDEBAR_TABS } from '../../../src/features/sidebar/state/sidebar-state.js';

test('Atomic 6.7 SidebarState owns one normalized active tab snapshot', () => {
  assert.deepEqual(SIDEBAR_TABS, ['docs', 'files', 'outline']);
  assert.equal(normalizeSidebarTab('files'), 'files');
  assert.equal(normalizeSidebarTab('unknown'), 'docs');
  const state = createSidebarState({ activeTab: 'outline' });
  assert.deepEqual(state.snapshot, { activeTab: 'outline' });
  assert.equal(Object.isFrozen(state.snapshot), true);
  state.destroy();
});

test('Atomic 6.7 SidebarState publishes only real tab transitions and unsubscribe is idempotent', () => {
  const state = createSidebarState();
  const events = [];
  const unsubscribe = state.subscribe((next, previous, meta) => events.push({ next, previous, meta }));
  state.setActiveTab('docs', 'same');
  state.setActiveTab('files', 'user');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].next, { activeTab: 'files' });
  assert.deepEqual(events[0].previous, { activeTab: 'docs' });
  assert.deepEqual(events[0].meta, { reason: 'user' });
  unsubscribe();
  unsubscribe();
  state.setActiveTab('outline');
  assert.equal(events.length, 1);
  state.destroy();
});

test('Atomic 6.7 SidebarState destroy is idempotent and terminal', () => {
  const state = createSidebarState();
  state.destroy();
  state.destroy();
  assert.throws(() => state.snapshot, /destroyed/);
  assert.throws(() => state.setActiveTab('files'), /destroyed/);
  assert.throws(() => state.subscribe(() => {}), /destroyed/);
});
