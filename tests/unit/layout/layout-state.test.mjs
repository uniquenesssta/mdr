import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayoutState } from '../../../src/features/layout/index.js';

test('Atomic 6.1 LayoutState owns one immutable default snapshot for every required layout state group', () => {
  const state = createLayoutState();
  assert.deepEqual(state.snapshot, {
    sidebar: { visible: true, autoCollapsed: false, width: 248 },
    split: { editorCollapsed: false, previewCollapsed: false, ratio: 0.5, compactActive: false, compactPane: 'editor' },
    mode: 'both',
    compact: { shellActive: false, shellInitialized: false },
    fullscreen: { page: false, system: false },
    resize: { splitActive: false, sidebarActive: false, windowActiveUntil: 0, windowBurstStartedAt: 0, windowBurstEvents: 0 }
  });
  assert.ok(Object.isFrozen(state.snapshot));
  assert.ok(Object.isFrozen(state.snapshot.sidebar));
  assert.ok(Object.isFrozen(state.snapshot.split));
  state.destroy();
});

test('LayoutState applies targeted group updates without duplicating unrelated state', () => {
  const state = createLayoutState();
  state.setSidebar({ visible: false, autoCollapsed: true, width: 333 });
  state.setSplit({ editorCollapsed: true, previewCollapsed: false, ratio: 0.42, compactActive: true, compactPane: 'preview' });
  state.setMode('preview');
  state.setCompact({ shellActive: true, shellInitialized: true });
  state.setFullscreen({ page: true, system: true });
  state.setResize({ splitActive: true, sidebarActive: true, windowActiveUntil: 12.5, windowBurstStartedAt: 3.5, windowBurstEvents: 7 });
  assert.deepEqual(state.snapshot.sidebar, { visible: false, autoCollapsed: true, width: 333 });
  assert.deepEqual(state.snapshot.split, { editorCollapsed: true, previewCollapsed: false, ratio: 0.42, compactActive: true, compactPane: 'preview' });
  assert.equal(state.snapshot.mode, 'preview');
  assert.deepEqual(state.snapshot.compact, { shellActive: true, shellInitialized: true });
  assert.deepEqual(state.snapshot.fullscreen, { page: true, system: true });
  assert.deepEqual(state.snapshot.resize, { splitActive: true, sidebarActive: true, windowActiveUntil: 12.5, windowBurstStartedAt: 3.5, windowBurstEvents: 7 });
  state.destroy();
});

test('LayoutState validates mode, pane and numeric state before mutation', () => {
  const state = createLayoutState();
  const before = state.snapshot;
  assert.throws(() => state.setMode('unknown'), /Unsupported layout mode/);
  assert.throws(() => state.setSplit({ compactPane: 'other' }), /Unsupported compact pane/);
  assert.throws(() => state.setSplit({ ratio: Number.NaN }), /finite number/);
  assert.throws(() => state.setSidebar({ width: Number.POSITIVE_INFINITY }), /finite number/);
  assert.throws(() => state.setResize({ unknown: true }), /Unknown resize state field/);
  assert.equal(state.snapshot, before);
  state.destroy();
});

test('LayoutState subscriptions publish immutable committed snapshots, continue through listeners and unsubscribe exactly once', () => {
  const state = createLayoutState();
  const events = [];
  const unsubscribe = state.subscribe(event => events.push(event));
  state.setSidebar({ width: 300 });
  assert.equal(events.length, 1);
  assert.equal(events[0].changedGroup, 'sidebar');
  assert.ok(Object.isFrozen(events[0]));
  assert.equal(events[0].previous.sidebar.width, 248);
  assert.equal(events[0].current.sidebar.width, 300);
  unsubscribe();
  unsubscribe();
  state.setMode('edit');
  assert.equal(events.length, 1);
  state.destroy();
});

test('LayoutState listener failure does not roll back committed state and destroy is idempotent and terminal', () => {
  const state = createLayoutState();
  state.subscribe(() => { throw new Error('listener failed'); });
  assert.throws(() => state.setFullscreen({ page: true }), /listener failed/);
  assert.equal(state.snapshot.fullscreen.page, true);
  state.destroy();
  state.destroy();
  assert.throws(() => state.snapshot, /destroyed/);
  assert.throws(() => state.setMode('both'), /destroyed/);
  assert.throws(() => state.subscribe(() => {}), /destroyed/);
});
