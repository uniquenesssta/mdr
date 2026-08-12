import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowControlsView, createWindowState } from '../../../src/features/window/index.js';

function classList() {
  const values = new Set();
  return {
    toggle(name, force) { if (force) values.add(name); else values.delete(name); },
    contains(name) { return values.has(name); }
  };
}
function button() {
  const listeners = new Map();
  const attributes = new Map();
  const useAttributes = new Map();
  const use = { setAttribute(name, value) { useAttributes.set(name, value); }, getAttribute(name) { return useAttributes.get(name); } };
  return {
    dataset: {},
    title: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); },
    querySelector(selector) { return selector === 'use' ? use : null; },
    click() { listeners.get('click')?.({ type: 'click', target: this }); },
    listenerCount() { return listeners.size; },
    use
  };
}

test('Atomic 6.13 Window Controls View projects availability and maximize chrome from WindowState', () => {
  const state = createWindowState();
  const root = { classList: classList() };
  const controls = { hidden: true };
  const minimizeButton = button();
  const maximizeButton = button();
  const closeButton = button();
  const calls = [];
  const view = createWindowControlsView({
    state, root, controls, minimizeButton, maximizeButton, closeButton,
    onMinimize: () => calls.push('minimize'),
    onToggleMaximize: () => calls.push('maximize'),
    onClose: () => calls.push('close')
  });

  assert.equal(view.start(), true);
  assert.equal(view.start(), false);
  assert.equal(controls.hidden, true);
  state.setAvailable(true);
  assert.equal(controls.hidden, false);
  assert.equal(root.classList.contains('tauri-shell'), true);
  state.setMaximized(true);
  assert.equal(root.classList.contains('window-maximized'), true);
  assert.equal(maximizeButton.dataset.maximized, 'true');
  assert.equal(maximizeButton.title, '还原窗口');
  assert.equal(maximizeButton.getAttribute('aria-label'), '还原窗口');
  assert.equal(maximizeButton.use.getAttribute('href'), '/assets/icons.svg#icon-restore');

  minimizeButton.click();
  maximizeButton.click();
  closeButton.click();
  assert.deepEqual(calls, ['minimize', 'maximize', 'close']);

  state.setMaximized(false);
  assert.equal(maximizeButton.use.getAttribute('href'), '/assets/icons.svg#icon-maximize');
  assert.equal(maximizeButton.title, '最大化');
});

test('Window Controls View destroy removes every listener/subscription and resets owned chrome', () => {
  const state = createWindowState({ available: true, maximized: true });
  const root = { classList: classList() };
  const controls = { hidden: false };
  const minimizeButton = button();
  const maximizeButton = button();
  const closeButton = button();
  let calls = 0;
  const view = createWindowControlsView({
    state, root, controls, minimizeButton, maximizeButton, closeButton,
    onMinimize: () => { calls += 1; }, onToggleMaximize: () => { calls += 1; }, onClose: () => { calls += 1; }
  });
  view.start();
  assert.equal(minimizeButton.listenerCount() + maximizeButton.listenerCount() + closeButton.listenerCount(), 3);
  view.destroy();
  view.destroy();
  assert.equal(minimizeButton.listenerCount() + maximizeButton.listenerCount() + closeButton.listenerCount(), 0);
  assert.equal(controls.hidden, true);
  assert.equal(root.classList.contains('tauri-shell'), false);
  assert.equal(root.classList.contains('window-maximized'), false);
  minimizeButton.click();
  state.setMaximized(false);
  assert.equal(calls, 0);
  assert.throws(() => view.start(), /destroyed/);
});
