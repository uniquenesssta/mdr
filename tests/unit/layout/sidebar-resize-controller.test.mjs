import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayoutState } from '../../../src/features/layout/state/layout-state.js';
import {
  createSidebarResizeController,
  SIDEBAR_WIDTH_STORAGE_KEY
} from '../../../src/features/layout/sidebar/sidebar-resize-controller.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : Boolean(force);
    if (next) this.values.add(name); else this.values.delete(name);
    return next;
  }
  contains(name) { return this.values.has(name); }
}

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, init = {}) {
    const event = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init };
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
    return event;
  }
}

class FakeElement extends FakeTarget {
  constructor() {
    super();
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.captured = new Set();
    this.clientWidth = 1000;
    this.rect = { left: 40, width: 1000 };
    this.style = { values: new Map(), setProperty(name, value) { this.values.set(name, value); }, getPropertyValue(name) { return this.values.get(name) || ''; }, cursor: '', userSelect: '' };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  getBoundingClientRect() { return this.rect; }
  setPointerCapture(id) { this.captured.add(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key); }
  };
}

function setup({ storedWidth = 310, narrow = false } = {}) {
  const state = createLayoutState();
  const workspace = new FakeElement();
  const resizer = new FakeElement();
  const root = new FakeElement();
  const body = new FakeElement();
  const viewport = new FakeTarget();
  viewport.innerWidth = 1200;
  const storage = createStorage({ [SIDEBAR_WIDTH_STORAGE_KEY]: storedWidth });
  const geometry = [];
  const controller = createSidebarResizeController({
    state,
    workspace,
    resizer,
    root,
    body,
    storage,
    viewport,
    matchMedia: () => ({ matches: narrow }),
    onGeometryChanged: event => geometry.push(event)
  });
  return { state, workspace, resizer, root, body, viewport, storage, geometry, controller };
}

test('Atomic 6.2 restores width, captures one pointer, projects live width and persists exactly on end', () => {
  const fixture = setup({ storedWidth: 310 });
  fixture.controller.start();
  assert.equal(fixture.state.snapshot.sidebar.width, 310);
  assert.equal(fixture.root.style.getPropertyValue('--sidebar-width'), '310px');
  assert.equal(fixture.resizer.getAttribute('aria-valuemin'), '180');
  assert.equal(fixture.resizer.getAttribute('aria-valuemax'), '520');
  assert.equal(fixture.resizer.getAttribute('aria-valuenow'), '310');

  const down = fixture.resizer.emit('pointerdown', { pointerId: 7, clientX: 350, button: 0, isPrimary: true });
  assert.equal(down.defaultPrevented, true);
  assert.equal(fixture.resizer.hasPointerCapture(7), true);
  assert.equal(fixture.state.snapshot.resize.sidebarActive, true);
  assert.equal(fixture.body.classList.contains('sidebar-resizing'), true);

  fixture.resizer.emit('pointermove', { pointerId: 7, clientX: 440 });
  assert.equal(fixture.state.snapshot.sidebar.width, 400);
  assert.equal(fixture.root.style.getPropertyValue('--sidebar-width'), '400px');
  assert.equal(fixture.storage.value(SIDEBAR_WIDTH_STORAGE_KEY), '310');

  fixture.resizer.emit('pointerup', { pointerId: 7 });
  assert.equal(fixture.state.snapshot.resize.sidebarActive, false);
  assert.equal(fixture.storage.value(SIDEBAR_WIDTH_STORAGE_KEY), '400');
  assert.equal(fixture.resizer.hasPointerCapture(7), false);
  assert.equal(fixture.body.classList.contains('sidebar-resizing'), false);
  assert.deepEqual(fixture.geometry.map(event => event.reason), ['pointer-move', 'pointer-end']);
});

test('Sidebar Resize Controller preserves the 180px minimum and dynamic 520px maximum policy', () => {
  const fixture = setup();
  fixture.workspace.clientWidth = 700;
  fixture.workspace.rect = { left: 25, width: 700 };
  fixture.controller.start();
  fixture.resizer.emit('pointerdown', { pointerId: 3, clientX: 300, button: 0, isPrimary: true });
  fixture.resizer.emit('pointermove', { pointerId: 3, clientX: 1000 });
  assert.equal(fixture.state.snapshot.sidebar.width, 340);
  fixture.resizer.emit('pointermove', { pointerId: 3, clientX: 50 });
  assert.equal(fixture.state.snapshot.sidebar.width, 180);
  fixture.resizer.emit('pointerup', { pointerId: 3 });
});

test('Sidebar Resize Controller blocks pointer capture when sidebar is hidden, compact or narrow', () => {
  const fixture = setup();
  fixture.controller.start();
  fixture.state.setSidebar({ visible: false });
  fixture.resizer.emit('pointerdown', { pointerId: 1, clientX: 300, button: 0, isPrimary: true });
  assert.equal(fixture.state.snapshot.resize.sidebarActive, false);
  fixture.state.setSidebar({ visible: true });
  fixture.state.setCompact({ shellActive: true });
  fixture.resizer.emit('pointerdown', { pointerId: 2, clientX: 300, button: 0, isPrimary: true });
  assert.equal(fixture.state.snapshot.resize.sidebarActive, false);

  fixture.state.setCompact({ shellActive: false });
  fixture.controller.destroy();
  fixture.state.destroy();

  const narrowFixture = setup({ narrow: true });
  narrowFixture.controller.start();
  narrowFixture.resizer.emit('pointerdown', { pointerId: 4, clientX: 300, button: 0, isPrimary: true });
  assert.equal(narrowFixture.state.snapshot.resize.sidebarActive, false);
});

test('viewport clamp updates canonical/CSS width without rewriting the persisted drag width', () => {
  const fixture = setup({ storedWidth: 500 });
  fixture.controller.start();
  fixture.workspace.clientWidth = 600;
  fixture.viewport.emit('resize');
  assert.equal(fixture.state.snapshot.sidebar.width, 240);
  assert.equal(fixture.root.style.getPropertyValue('--sidebar-width'), '240px');
  assert.equal(fixture.storage.value(SIDEBAR_WIDTH_STORAGE_KEY), '500');
  assert.equal(fixture.geometry.at(-1).reason, 'viewport-resize');
});

test('destroy removes listeners and cleans an active pointer without persisting a partial drag', () => {
  const fixture = setup({ storedWidth: 300 });
  fixture.controller.start();
  fixture.resizer.emit('pointerdown', { pointerId: 9, clientX: 320, button: 0, isPrimary: true });
  fixture.resizer.emit('pointermove', { pointerId: 9, clientX: 390 });
  assert.equal(fixture.state.snapshot.sidebar.width, 350);
  fixture.controller.destroy();
  fixture.controller.destroy();
  assert.equal(fixture.state.snapshot.resize.sidebarActive, false);
  assert.equal(fixture.storage.value(SIDEBAR_WIDTH_STORAGE_KEY), '300');
  assert.equal(fixture.resizer.hasPointerCapture(9), false);
  fixture.resizer.emit('pointerdown', { pointerId: 10, clientX: 400, button: 0, isPrimary: true });
  assert.equal(fixture.state.snapshot.resize.sidebarActive, false);
});
