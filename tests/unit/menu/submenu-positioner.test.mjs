import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmenuPositioner } from '../../../src/features/menu/submenu-positioner.js';

function classList(...initial) {
  const values = new Set(initial);
  return {
    add(...items) { items.forEach(item => values.add(item)); },
    remove(...items) { items.forEach(item => values.delete(item)); },
    contains(item) { return values.has(item); }
  };
}

function element({ classes = [], rect = {} } = {}) {
  const listeners = new Map();
  const style = {
    removeProperty(name) { delete style[name]; }
  };
  const node = {
    children: [],
    parentElement: null,
    ownerDocument: null,
    hovered: false,
    classList: classList(...classes),
    style,
    append(...children) { children.forEach(child => { child.parentElement = node; child.ownerDocument = node.ownerDocument; node.children.push(child); }); },
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type) { for (const listener of listeners.get(type) || []) listener({ type, target: node }); },
    matches(selector) { return selector === ':hover' ? node.hovered : false; },
    contains(target) { for (let current = target; current; current = current.parentElement) if (current === node) return true; return false; },
    getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, ...rect }; },
    listenerCount() { return [...listeners.values()].reduce((total, set) => total + set.size, 0); }
  };
  return node;
}

function runtime() {
  let next = 1;
  const timers = new Map();
  const frames = new Map();
  return {
    innerWidth: 500,
    innerHeight: 300,
    setTimeout(callback) { const id = next++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { const id = next++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    flushFrames() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
    flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
    pendingTimers() { return timers.size; },
    pendingFrames() { return frames.size; }
  };
}

function fixture() {
  const documentRef = { activeElement: null, defaultView: null };
  const rightOwner = element({ classes: ['menu-submenu'], rect: { left: 440, right: 490, top: 260, bottom: 292, width: 50, height: 32 } });
  const rightList = element({ classes: ['menu-submenu-list'], rect: { width: 120, height: 100 } });
  const leftOwner = element({ classes: ['menu-submenu'], rect: { left: 50, right: 100, top: 20, bottom: 52, width: 50, height: 32 } });
  const leftList = element({ classes: ['menu-submenu-list'], rect: { width: 120, height: 100 } });
  const disabledOwner = element({ classes: ['menu-submenu', 'disabled'], rect: { left: 50, right: 100, top: 20, width: 50, height: 32 } });
  const disabledList = element({ classes: ['menu-submenu-list'], rect: { width: 120, height: 100 } });
  for (const node of [rightOwner, rightList, leftOwner, leftList, disabledOwner, disabledList]) node.ownerDocument = documentRef;
  rightOwner.append(rightList);
  leftOwner.append(leftList);
  disabledOwner.append(disabledList);
  const root = {
    ownerDocument: documentRef,
    querySelectorAll(selector) { return selector === '.menu-submenu' ? [rightOwner, leftOwner, disabledOwner] : []; }
  };
  return { documentRef, root, rightOwner, rightList, leftOwner, leftList, disabledOwner, disabledList };
}

test('Atomic 6.11 SubmenuPositioner flips horizontally and clamps vertical geometry in owner coordinates', () => {
  const clock = runtime();
  const f = fixture();
  f.documentRef.defaultView = clock;
  const positioner = createSubmenuPositioner({ root: f.root, runtime: clock });
  assert.equal(positioner.start(), true);
  assert.equal(positioner.start(), false);

  f.rightOwner.emit('pointerenter');
  clock.flushFrames();
  assert.equal(f.rightOwner.classList.contains('is-submenu-open'), true);
  assert.equal(f.rightList.style.position, 'absolute');
  assert.equal(f.rightList.style.left, '-124px');
  assert.equal(f.rightList.style.top, '-68px');

  f.leftOwner.emit('pointerenter');
  clock.flushFrames();
  assert.equal(f.leftList.style.left, '54px');
  assert.equal(f.leftList.style.top, '-6px');

  f.disabledOwner.emit('pointerenter');
  clock.flushFrames();
  assert.equal(f.disabledOwner.classList.contains('is-submenu-open'), false);
  positioner.destroy();
});

test('Atomic 6.11 delayed close respects hover and focus ownership then closes outside focus', () => {
  const clock = runtime();
  const f = fixture();
  f.documentRef.defaultView = clock;
  const positioner = createSubmenuPositioner({ root: f.root, runtime: clock, closeDelayMs: 25 });
  positioner.start();
  f.leftOwner.emit('pointerenter');
  clock.flushFrames();

  f.leftOwner.hovered = true;
  f.leftOwner.emit('pointerleave');
  assert.equal(clock.pendingTimers(), 1);
  clock.flushTimers();
  assert.equal(f.leftOwner.classList.contains('is-submenu-open'), true);

  f.leftOwner.hovered = false;
  const focusChild = element();
  focusChild.ownerDocument = f.documentRef;
  f.leftList.append(focusChild);
  f.documentRef.activeElement = focusChild;
  f.leftOwner.emit('focusout');
  clock.flushTimers();
  assert.equal(f.leftOwner.classList.contains('is-submenu-open'), true);

  f.documentRef.activeElement = null;
  f.leftOwner.emit('pointerleave');
  clock.flushTimers();
  assert.equal(f.leftOwner.classList.contains('is-submenu-open'), false);
  assert.equal(f.leftList.style.position, undefined);
  assert.equal(f.leftList.style.left, undefined);
  positioner.destroy();
});

test('Atomic 6.11 closeAll and destroy cancel pending work, reset styles and remove every listener', () => {
  const clock = runtime();
  const f = fixture();
  f.documentRef.defaultView = clock;
  const positioner = createSubmenuPositioner({ root: f.root, runtime: clock });
  positioner.start();
  f.rightOwner.emit('pointerenter');
  assert.equal(clock.pendingFrames(), 1);
  f.rightOwner.emit('pointerleave');
  assert.equal(clock.pendingTimers(), 1);
  positioner.closeAll();
  assert.equal(clock.pendingFrames(), 0);
  assert.equal(clock.pendingTimers(), 0);
  assert.equal(f.rightOwner.classList.contains('is-submenu-open'), false);

  positioner.destroy();
  assert.equal(f.rightOwner.listenerCount(), 0);
  assert.equal(f.rightList.listenerCount(), 0);
  assert.equal(f.leftOwner.listenerCount(), 0);
  assert.equal(f.leftList.listenerCount(), 0);
  f.leftOwner.emit('pointerenter');
  clock.flushFrames();
  assert.equal(f.leftOwner.classList.contains('is-submenu-open'), false);
  assert.throws(() => positioner.closeAll(), /destroyed/);
});
