import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutState } from '../../../src/features/layout/state/layout-state.js';
import { createCompactShellController } from '../../../src/features/layout/shell/compact-shell-controller.js';

function createHarness(width = 840) {
  const state = createLayoutState();
  const classes = new Set(); const listeners = new Map(); const records = []; const geometry = []; const menus = [];
  let clock = 100; let frameId = 0; const frames = new Map(); let timerId = 0; const timers = new Map();
  const viewport = {
    innerWidth: width, innerHeight: 700,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); }
  };
  const controller = createCompactShellController({
    state,
    root: { classList: { toggle(name, active) { active ? classes.add(name) : classes.delete(name); } } },
    viewport,
    requestFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
    setTimer(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimer(id) { timers.delete(id); },
    now: () => clock,
    closeMenus: () => menus.push(clock),
    onGeometryChanged: event => geometry.push(event),
    record: (name, entry) => records.push([name, entry])
  });
  return {
    state, classes, listeners, records, geometry, menus, viewport, controller,
    setClock(value) { clock = value; },
    flushFrames() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } },
    flushTimers() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    get timers() { return timers; }, get frames() { return frames; }
  };
}

test('Atomic 6.4 CompactShell applies 860/900 hysteresis and synchronizes sidebar auto-collapse', () => {
  const h = createHarness(840); h.controller.start();
  assert.equal(h.state.snapshot.compact.shellActive, true);
  assert.equal(h.state.snapshot.sidebar.autoCollapsed, true);
  assert.equal(h.classes.has('is-compact-shell'), true);
  h.viewport.innerWidth = 880; h.listeners.get('resize')(); h.flushFrames();
  assert.equal(h.state.snapshot.compact.shellActive, true, '880 remains compact while active because exit threshold is 900');
  assert.equal(h.state.snapshot.resize.windowActiveUntil, 320);
  assert.equal(h.state.snapshot.resize.windowBurstEvents, 1);
  h.setClock(330); h.flushTimers(); h.flushFrames();
  assert.deepEqual(h.state.snapshot.resize, { splitActive: false, sidebarActive: false, windowActiveUntil: 0, windowBurstStartedAt: 0, windowBurstEvents: 0 });
  h.viewport.innerWidth = 920; h.listeners.get('resize')(); h.flushFrames();
  assert.equal(h.state.snapshot.compact.shellActive, false);
  assert.equal(h.state.snapshot.sidebar.autoCollapsed, false);
  assert.equal(h.classes.has('compact-shell'), false);
  assert.ok(h.records.some(([name]) => name === 'layout.window-resize-settled'));
  h.controller.destroy(); h.state.destroy();
});

test('Atomic 6.4 resize burst suppressor state is immediate and destroy clears every scheduled resource', () => {
  const h = createHarness(1000); h.controller.start();
  h.listeners.get('resize')();
  assert.ok(h.state.snapshot.resize.windowActiveUntil > 100, 'View Transition gate can observe burst state before RAF work');
  assert.equal(h.frames.size, 1); assert.equal(h.timers.size, 1);
  h.controller.destroy();
  assert.equal(h.listeners.size, 0); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.state.snapshot.resize.windowActiveUntil, 0);
  assert.equal(h.state.snapshot.resize.windowBurstEvents, 0);
  assert.equal(h.state.snapshot.compact.shellInitialized, false);
  assert.throws(() => h.controller.start(), /destroyed/);
  h.state.destroy();
});
