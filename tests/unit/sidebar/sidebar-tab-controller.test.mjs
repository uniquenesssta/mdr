import test from 'node:test';
import assert from 'node:assert/strict';
import { createSidebarState } from '../../../src/features/sidebar/state/sidebar-state.js';
import { createSidebarTabController, SIDEBAR_TAB_STORAGE_KEY } from '../../../src/features/sidebar/tabs/sidebar-tab-controller.js';

function element() {
  const classes = new Set();
  const listeners = new Map();
  return {
    classList: {
      toggle(name, active) { active ? classes.add(name) : classes.delete(name); return Boolean(active); },
      contains(name) { return classes.has(name); }
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    click() { listeners.get('click')?.({ type: 'click' }); },
    listenerCount() { return listeners.size; }
  };
}

function harness(restored = 'docs') {
  const state = createSidebarState();
  const tabs = { docs: element(), files: element(), outline: element() };
  const panels = { docs: element(), files: element(), outline: element() };
  const writes = [];
  const values = new Map([[SIDEBAR_TAB_STORAGE_KEY, restored]]);
  const errors = [];
  const controller = createSidebarTabController({
    state, tabs, panels,
    storage: {
      get(key) { return values.get(key) ?? null; },
      async set(key, value) { writes.push([key, value]); values.set(key, value); }
    },
    reportError(message, error) { errors.push([message, error]); }
  });
  return { state, tabs, panels, writes, values, errors, controller };
}

function activeNames(map) {
  return Object.entries(map).filter(([, value]) => value.classList.contains('active')).map(([name]) => name);
}

test('Atomic 6.7 restores the exact legacy key and only projects one mount region', () => {
  const h = harness('outline');
  const calls = [];
  h.controller.registerLifecycle('outline', { activate: () => calls.push('outline+'), deactivate: () => calls.push('outline-') });
  h.controller.start();
  assert.equal(h.controller.activeTab, 'outline');
  assert.deepEqual(activeNames(h.tabs), ['outline']);
  assert.deepEqual(activeNames(h.panels), ['outline']);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(calls, ['outline+']);
  h.controller.destroy();
  h.state.destroy();
});

test('Atomic 6.7 tab selection persists and activates/deactivates files and outline lifecycles', async () => {
  const h = harness('docs');
  const calls = [];
  h.controller.registerLifecycle('files', { activate: () => calls.push('files+'), deactivate: () => calls.push('files-') });
  h.controller.registerLifecycle('outline', { activate: () => calls.push('outline+'), deactivate: () => calls.push('outline-') });
  h.controller.start();
  h.tabs.files.click();
  await Promise.resolve();
  assert.equal(h.controller.isActive('files'), true);
  assert.deepEqual(activeNames(h.panels), ['files']);
  assert.deepEqual(calls, ['files+']);
  await h.controller.select('outline');
  assert.deepEqual(calls, ['files+', 'files-', 'outline+']);
  assert.deepEqual(h.writes, [
    [SIDEBAR_TAB_STORAGE_KEY, 'files'],
    [SIDEBAR_TAB_STORAGE_KEY, 'outline']
  ]);
  await h.controller.select('invalid');
  assert.equal(h.controller.activeTab, 'docs');
  assert.deepEqual(activeNames(h.panels), ['docs']);
  h.controller.destroy();
  h.state.destroy();
});

test('Atomic 6.7 late lifecycle registration starts only the active controller and unregister pauses it', () => {
  const h = harness('files');
  h.controller.start();
  const calls = [];
  const unregisterFiles = h.controller.registerLifecycle('files', { activate: () => calls.push('+'), deactivate: () => calls.push('-') });
  assert.deepEqual(calls, ['+']);
  unregisterFiles();
  unregisterFiles();
  assert.deepEqual(calls, ['+', '-']);
  const outline = [];
  h.controller.registerLifecycle('outline', { activate: () => outline.push('+'), deactivate: () => outline.push('-') });
  assert.deepEqual(outline, []);
  h.controller.destroy();
  h.state.destroy();
});

test('Atomic 6.7 persistence failure is controlled after the synchronous state/DOM transition', async () => {
  const h = harness('docs');
  const controller = createSidebarTabController({
    state: h.state,
    tabs: h.tabs,
    panels: h.panels,
    storage: { get: () => 'docs', set: async () => { throw new Error('storage denied'); } },
    reportError: () => {}
  });
  controller.start();
  const result = await controller.select('files');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'persistence-failed');
  assert.match(result.error.message, /storage denied/);
  assert.equal(h.state.snapshot.activeTab, 'files');
  assert.deepEqual(activeNames(h.panels), ['files']);
  controller.destroy();
  h.state.destroy();
});

test('Atomic 6.7 destroy removes click listeners, pauses the active child and is terminal', () => {
  const h = harness('files');
  const calls = [];
  h.controller.registerLifecycle('files', { activate: () => calls.push('+'), deactivate: () => calls.push('-') });
  h.controller.start();
  assert.equal(h.tabs.files.listenerCount(), 1);
  h.controller.destroy();
  h.controller.destroy();
  assert.deepEqual(calls, ['+', '-']);
  assert.equal(h.tabs.files.listenerCount(), 0);
  assert.throws(() => h.controller.select('docs'), /destroyed/);
  assert.throws(() => h.controller.registerLifecycle('files', { activate() {}, deactivate() {} }), /destroyed/);
  h.state.destroy();
});
