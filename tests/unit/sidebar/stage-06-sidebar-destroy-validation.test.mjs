import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIDEBAR_TABS,
  createFolderTreeView,
  createOutlineView,
  createSidebarState,
  createSidebarTabController
} from '../../../src/features/sidebar/index.js';
import { assertLifecycleZero, createLifecycleResourceLedger } from '../../helpers/lifecycle-resource-ledger.mjs';

function createStorage() {
  const values = new Map();
  return {
    get(key) { return values.has(key) ? values.get(key) : null; },
    set(key, value) { values.set(key, String(value)); return Promise.resolve(); }
  };
}

function createTrackedSidebarState(ledger) {
  const state = createSidebarState();
  const counter = ledger.createSubscriptionSource();
  return {
    get snapshot() { return state.snapshot; },
    setActiveTab: (...args) => state.setActiveTab(...args),
    subscribe(listener) {
      const releaseCount = counter.subscribe(() => {});
      const releaseState = state.subscribe(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        releaseState();
        releaseCount();
      };
    },
    destroy: () => state.destroy()
  };
}

function createDomFactory(ledger) {
  const createElement = tagName => {
    const children = [];
    const attributes = new Map();
    const element = ledger.createEventTarget({
      tagName,
      classList: ledger.createClassList(),
      style: ledger.createStyle(),
      dataset: {},
      hidden: false,
      disabled: false,
      children,
      appendChild(child) { children.push(child); child.parentElement = element; return child; },
      append(...nodes) { for (const node of nodes) element.appendChild(node); },
      replaceChildren(...nodes) { children.splice(0, children.length); for (const node of nodes) element.appendChild(node); },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      contains(node) {
        if (node === element) return true;
        return children.some(child => child === node || child.contains?.(node));
      },
      querySelector(selector) {
        const wanted = String(selector).toLowerCase();
        for (const child of children) {
          if (wanted === String(child.tagName || '').toLowerCase()) return child;
          const nested = child.querySelector?.(selector);
          if (nested) return nested;
        }
        return null;
      },
      querySelectorAll() { return []; },
      closest() { return null; },
      click() { element.dispatch('click', { target: element }); }
    });
    return element;
  };
  return {
    createElement,
    createElementNS(_namespace, tagName) { return createElement(tagName); }
  };
}

function assertRepeatedStartStable(ledger, start) {
  start();
  const once = ledger.snapshot();
  start();
  assert.deepEqual(ledger.snapshot(), once, 'repeated start must not increase Sidebar resources');
  return once;
}

test('Atomic 6.14 Sidebar Tabs release all tab listeners and the SidebarState subscription', () => {
  const ledger = createLifecycleResourceLedger();
  const state = createTrackedSidebarState(ledger);
  const tabs = {};
  const panels = {};
  for (const name of SIDEBAR_TABS) {
    tabs[name] = ledger.createEventTarget({ classList: ledger.createClassList() });
    panels[name] = { classList: ledger.createClassList() };
  }
  const controller = createSidebarTabController({ state, tabs, panels, storage: createStorage() });

  const started = assertRepeatedStartStable(ledger, () => controller.start());
  assert.deepEqual({ listeners: started.listeners, subscriptions: started.subscriptions }, { listeners: 3, subscriptions: 1 });
  controller.destroy();
  controller.destroy();
  assertLifecycleZero(assert, ledger, 'Sidebar Tabs resources');
  state.destroy();
});

test('Atomic 6.14 Outline View owns exactly three listeners and removes them idempotently', () => {
  const ledger = createLifecycleResourceLedger();
  const documentRef = createDomFactory(ledger);
  const panel = documentRef.createElement('section');
  const list = documentRef.createElement('div');
  const contextMenu = documentRef.createElement('div');
  const view = createOutlineView({
    documentRef,
    panel,
    list,
    contextMenu,
    contextSeparator: documentRef.createElement('hr'),
    contextCollapseNodeButton: documentRef.createElement('button'),
    isCollapsed: () => false,
    onToggle() {},
    onNavigate() {},
    onExpandAll() {},
    onCollapseAll() {},
    onCollapseNode() {},
    openContextMenu() {},
    closeContextMenus() {}
  });

  const started = assertRepeatedStartStable(ledger, () => view.start());
  assert.equal(started.listeners, 3);
  view.destroy();
  view.destroy();
  assertLifecycleZero(assert, ledger, 'Outline View resources');
});

test('Atomic 6.14 Folder Tree View removes panel/header listeners and every rendered node listener', () => {
  const ledger = createLifecycleResourceLedger();
  const documentRef = createDomFactory(ledger);
  const panel = documentRef.createElement('section');
  const list = documentRef.createElement('div');
  const refreshButton = documentRef.createElement('button');
  const view = createFolderTreeView({
    documentRef,
    panel,
    list,
    rootLabel: documentRef.createElement('span'),
    summary: documentRef.createElement('span'),
    refreshButton,
    available: true
  });
  const actions = {
    refresh: async () => {},
    isDirectoryExpanded: () => true,
    toggleDirectory() {},
    openFile: async () => true
  };

  view.start(actions);
  const once = ledger.snapshot();
  view.start(actions);
  assert.deepEqual(ledger.snapshot(), once, 'repeated Folder Tree start must not add listeners');
  assert.equal(once.listeners, 2);
  view.render({
    loading: false,
    errorMessage: '',
    currentDocumentPath: 'C:/docs/readme.md',
    tree: {
      rootName: 'docs',
      rootPath: 'C:/docs',
      fileCount: 2,
      skippedCount: 0,
      truncated: false,
      nodes: [
        { kind: 'file', name: 'readme.md', path: 'C:/docs/readme.md' },
        {
          kind: 'directory', name: 'nested', path: 'C:/docs/nested', children: [
            { kind: 'file', name: 'child.md', path: 'C:/docs/nested/child.md' }
          ]
        }
      ]
    }
  });
  assert.equal(ledger.snapshot().listeners, 5, 'two panel listeners plus three node listeners are active');
  view.destroy();
  view.destroy();
  assertLifecycleZero(assert, ledger, 'Folder Tree View resources');
});
