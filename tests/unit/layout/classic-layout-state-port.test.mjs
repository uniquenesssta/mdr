import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayoutState, getCompactShellMaxWidth, getCompactSplitMaxWidth, RESPONSIVE_BREAKPOINTS, matchesNarrowInteractiveLayout } from '../../../src/features/layout/index.js';
test('R16-08 explicit LayoutState owns every former projection value and exposes immutable snapshots', () => {
  const state = createLayoutState();
  assert.equal(state.snapshot.sidebar.width, 248);
  state.setSidebar({ visible: false, width: 312 });
  state.setSplit({ editorCollapsed: true, previewCollapsed: false, ratio: 0.61, compactActive: true, compactPane: 'preview' });
  state.setMode('preview');
  state.setCompact({ shellActive: true, shellInitialized: true });
  state.setFullscreen({ page: true, system: true });
  state.setResize({ splitActive: true, sidebarActive: true, windowActiveUntil: 44, windowBurstStartedAt: 11, windowBurstEvents: 9 });
  assert.equal(state.snapshot.sidebar.visible, false); assert.equal(state.snapshot.sidebar.width, 312);
  assert.equal(state.snapshot.split.ratio, 0.61); assert.equal(state.snapshot.split.compactPane, 'preview');
  assert.equal(state.snapshot.mode, 'preview'); assert.equal(state.snapshot.fullscreen.page, true);
  assert.deepEqual(state.snapshot.resize, { splitActive: true, sidebarActive: true, windowActiveUntil: 44, windowBurstStartedAt: 11, windowBurstEvents: 9 });
  assert.equal(getCompactShellMaxWidth(false), 860); assert.equal(getCompactShellMaxWidth(true), 900);
  assert.equal(getCompactSplitMaxWidth(false), 720); assert.equal(getCompactSplitMaxWidth(true), 760);
  assert.equal(RESPONSIVE_BREAKPOINTS.narrowInteractive.maxWidth, 768);
  assert.equal(matchesNarrowInteractiveLayout(query => ({ matches: query === '(max-width: 768px)' })), true);
  state.destroy(); state.destroy(); assert.throws(() => state.snapshot, /destroyed/);
});
test('R16-08 LayoutState validates writes atomically and independent owners remain isolated', () => {
  const state = createLayoutState(), second = createLayoutState(), before = state.snapshot;
  assert.throws(() => state.setSidebar({ width: 300, unknown: true }), /Unknown/);
  assert.equal(state.snapshot, before);
  state.setMode('preview'); assert.equal(second.snapshot.mode, 'both');
  state.destroy(); assert.throws(() => state.setMode('both'), /destroyed/); second.destroy();
});
