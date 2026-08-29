import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMenuController,
  createMenuView,
  createRecentFilesMenuController,
  createSubmenuPositioner
} from '../../../src/features/menu/index.js';
import { assertLifecycleZero, createLifecycleResourceLedger } from '../../helpers/lifecycle-resource-ledger.mjs';

function createDomElement(ledger, extra = {}) {
  const children = [];
  const attributes = new Map();
  const element = ledger.createEventTarget({
    classList: ledger.createClassList(),
    style: ledger.createStyle(),
    dataset: {},
    children,
    hidden: false,
    appendChild(child) { children.push(child); child.parentElement = element; child.ownerDocument ||= element.ownerDocument; return child; },
    append(...nodes) { for (const node of nodes) element.appendChild(node); },
    replaceChildren(...nodes) { children.splice(0, children.length); for (const node of nodes) element.appendChild(node); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    contains(node) { return node === element || children.some(child => child === node || child.contains?.(node)); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    matches(selector) { return selector === ':hover' ? Boolean(element.hovered) : false; },
    getBoundingClientRect() { return { left: 20, right: 80, top: 20, bottom: 52, width: 60, height: 32 }; },
    ...extra
  });
  return element;
}

function createDocumentRef(ledger) {
  const documentRef = {
    activeElement: null,
    createElement() {
      const element = createDomElement(ledger);
      element.ownerDocument = documentRef;
      return element;
    }
  };
  return documentRef;
}

test('Atomic 6.14 Menu View capture listener is single-start and zero after repeated destroy', () => {
  const ledger = createLifecycleResourceLedger();
  const root = createDomElement(ledger, { querySelector() { return null; } });
  const view = createMenuView({ root });
  assert.equal(view.start(() => {}), true);
  const once = ledger.snapshot();
  assert.equal(view.start(() => {}), false);
  assert.deepEqual(ledger.snapshot(), once);
  assert.equal(once.listeners, 1);
  view.destroy();
  view.destroy();
  assertLifecycleZero(assert, ledger, 'Menu View resources');
});

test('Atomic 6.14 Menu Controller owns one state subscription and one delegated view listener', () => {
  const ledger = createLifecycleResourceLedger();
  const stateSource = ledger.createSubscriptionSource();
  const root = ledger.createEventTarget();
  let viewListener = null;
  const state = {
    declaration: Object.freeze([{ commandId: 'test.command' }]),
    isEnabled: () => true,
    isVisible: () => true,
    subscribe: listener => stateSource.subscribe(listener)
  };
  const view = {
    bindDeclaration() {},
    setCommandState() {},
    start(listener) {
      if (viewListener) return false;
      viewListener = listener;
      root.addEventListener('click', listener);
      return true;
    },
    destroy() {
      if (!viewListener) return;
      root.removeEventListener('click', viewListener);
      viewListener = null;
    }
  };
  const controller = createMenuController({
    state,
    bindings: { execute: () => ({ closeMenu: false, result: true }) },
    view
  });
  assert.equal(controller.start(), true);
  const once = ledger.snapshot();
  assert.equal(controller.start(), false);
  assert.deepEqual(ledger.snapshot(), once);
  assert.deepEqual({ listeners: once.listeners, subscriptions: once.subscriptions }, { listeners: 1, subscriptions: 1 });
  controller.destroy();
  controller.destroy();
  assertLifecycleZero(assert, ledger, 'Menu Controller resources');
});

test('Atomic 6.14 Submenu Positioner cancels pointer/focus listeners, delayed timer and RAF', () => {
  const ledger = createLifecycleResourceLedger();
  const documentRef = { activeElement: null };
  const submenu = createDomElement(ledger, {
    classList: ledger.createClassList('menu-submenu-list'),
    getBoundingClientRect: () => ({ width: 120, height: 80 })
  });
  const owner = createDomElement(ledger, {
    classList: ledger.createClassList('menu-submenu'),
    getBoundingClientRect: () => ({ left: 20, right: 80, top: 20, bottom: 52, width: 60, height: 32 })
  });
  owner.ownerDocument = documentRef;
  submenu.ownerDocument = documentRef;
  owner.appendChild(submenu);
  const root = {
    ownerDocument: documentRef,
    querySelectorAll(selector) { return selector === '.menu-submenu' ? [owner] : []; }
  };
  const runtime = {
    innerWidth: 800,
    innerHeight: 600,
    setTimeout: callback => ledger.setTimer(callback),
    clearTimeout: id => ledger.clearTimer(id),
    requestAnimationFrame: callback => ledger.requestFrame(callback),
    cancelAnimationFrame: id => ledger.cancelFrame(id)
  };
  const positioner = createSubmenuPositioner({ root, runtime });
  assert.equal(positioner.start(), true);
  const once = ledger.snapshot();
  assert.equal(positioner.start(), false);
  assert.deepEqual(ledger.snapshot(), once);
  assert.equal(once.listeners, 6);
  owner.dispatch('pointerenter');
  owner.dispatch('pointerleave');
  assert.deepEqual({ frames: ledger.snapshot().frames, timers: ledger.snapshot().timers }, { frames: 1, timers: 1 });
  positioner.destroy();
  positioner.destroy();
  assertLifecycleZero(assert, ledger, 'Submenu Positioner resources');
});

test('Atomic 6.14 Recent Files Menu releases delegated click and Documents read subscription', () => {
  const ledger = createLifecycleResourceLedger();
  const documentRef = createDocumentRef(ledger);
  const owner = createDomElement(ledger, { ownerDocument: documentRef });
  const list = createDomElement(ledger, { ownerDocument: documentRef });
  const source = ledger.createSubscriptionSource({ entries: Object.freeze([]) });
  const controller = createRecentFilesMenuController({
    owner,
    list,
    source,
    commands: { execute() { return true; } },
    available: true
  });
  assert.equal(controller.start(), true);
  const once = ledger.snapshot();
  assert.equal(controller.start(), false);
  assert.deepEqual(ledger.snapshot(), once);
  assert.deepEqual({ listeners: once.listeners, subscriptions: once.subscriptions }, { listeners: 1, subscriptions: 1 });
  controller.destroy();
  controller.destroy();
  assertLifecycleZero(assert, ledger, 'Recent Files Menu resources');
});
