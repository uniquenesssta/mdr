/**
 * Responsibility: Own Sidebar tab/panel projection, tab persistence, click listeners and child lifecycle activation.
 * Imports: Sidebar tab normalization only.
 * Exports: SIDEBAR_TAB_STORAGE_KEY, createSidebarTabController().
 * State/side effects: Reads/writes SidebarState, one persisted key, injected tab/panel classes and child activate/deactivate methods.
 * Lifecycle: Explicit start/destroy; lifecycle registrations are independently removable and late registration activates the current tab.
 */
import { SIDEBAR_TABS, normalizeSidebarTab } from '../state/sidebar-state.js';

export const SIDEBAR_TAB_STORAGE_KEY = 'md_editor_sidebar_tab';

function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

export function createSidebarTabController({
  state,
  tabs,
  panels,
  storage,
  reportError = (message, error) => console.error(message, error)
} = {}) {
  requireObject(state, 'SidebarState');
  requireFunction(state.setActiveTab, 'SidebarState.setActiveTab');
  requireFunction(state.subscribe, 'SidebarState.subscribe');
  requireObject(storage, 'Sidebar tab storage');
  requireFunction(storage.get, 'Sidebar tab storage.get');
  requireFunction(storage.set, 'Sidebar tab storage.set');
  requireFunction(reportError, 'Sidebar tab error reporter');

  const tabElements = new Map();
  const panelElements = new Map();
  for (const name of SIDEBAR_TABS) {
    const tab = tabs?.[name];
    const panel = panels?.[name];
    requireObject(tab, `Sidebar ${name} tab`);
    requireFunction(tab.addEventListener, `Sidebar ${name} tab.addEventListener`);
    requireFunction(tab.removeEventListener, `Sidebar ${name} tab.removeEventListener`);
    requireObject(tab.classList, `Sidebar ${name} tab.classList`);
    requireObject(panel, `Sidebar ${name} panel`);
    requireObject(panel.classList, `Sidebar ${name} panel.classList`);
    tabElements.set(name, tab);
    panelElements.set(name, panel);
  }

  const lifecycles = new Map();
  const clickHandlers = new Map();
  let unsubscribeState = null;
  let started = false;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('SidebarTabController is destroyed.');
  };
  const activeTab = () => state.snapshot.activeTab;

  function project(tab) {
    for (const name of SIDEBAR_TABS) {
      const active = name === tab;
      tabElements.get(name).classList.toggle('active', active);
      panelElements.get(name).classList.toggle('active', active);
    }
  }

  function invokeLifecycle(tab, method, reason) {
    const lifecycle = lifecycles.get(tab);
    if (!lifecycle || typeof lifecycle[method] !== 'function') return;
    try {
      const result = lifecycle[method]({ tab, reason });
      if (result && typeof result.catch === 'function') {
        result.catch(error => reportError(`Sidebar ${tab} ${method} failed.`, error));
      }
    } catch (error) {
      reportError(`Sidebar ${tab} ${method} failed.`, error);
    }
  }

  function applyTransition(next, previous, reason) {
    if (previous && previous !== next) invokeLifecycle(previous, 'deactivate', reason);
    project(next);
    if (!previous || previous !== next) invokeLifecycle(next, 'activate', reason);
  }

  async function persist(tab) {
    try {
      await storage.set(SIDEBAR_TAB_STORAGE_KEY, tab);
      return Object.freeze({ ok: true, persisted: true, activeTab: tab });
    } catch (error) {
      return Object.freeze({ ok: false, persisted: false, activeTab: tab, reason: 'persistence-failed', error });
    }
  }

  const controller = Object.freeze({
    start() {
      assertActive();
      if (started) return controller;
      started = true;
      const restored = normalizeSidebarTab(storage.get(SIDEBAR_TAB_STORAGE_KEY));
      const previous = activeTab();
      state.setActiveTab(restored, 'restore');
      project(restored);
      invokeLifecycle(restored, 'activate', 'restore');
      unsubscribeState = state.subscribe((next, before, meta) => {
        applyTransition(next.activeTab, before.activeTab, meta?.reason || 'state');
      });
      for (const name of SIDEBAR_TABS) {
        const handler = () => { void controller.select(name, { reason: 'click' }); };
        clickHandlers.set(name, handler);
        tabElements.get(name).addEventListener('click', handler);
      }
      return controller;
    },
    get activeTab() {
      assertActive();
      return activeTab();
    },
    isActive(tab) {
      assertActive();
      return activeTab() === normalizeSidebarTab(tab, '');
    },
    select(tab, { persist: shouldPersist = true, reason = 'select' } = {}) {
      assertActive();
      const normalized = normalizeSidebarTab(tab);
      const previous = activeTab();
      state.setActiveTab(normalized, reason);
      if (previous === normalized) project(normalized);
      if (!shouldPersist) return Promise.resolve(Object.freeze({ ok: true, persisted: false, activeTab: normalized }));
      return persist(normalized);
    },
    registerLifecycle(tab, lifecycle) {
      assertActive();
      const normalized = normalizeSidebarTab(tab, '');
      if (!normalized) throw new TypeError(`Unsupported Sidebar lifecycle tab: ${String(tab || '')}.`);
      requireObject(lifecycle, `Sidebar ${normalized} lifecycle`);
      requireFunction(lifecycle.activate, `Sidebar ${normalized} lifecycle.activate`);
      requireFunction(lifecycle.deactivate, `Sidebar ${normalized} lifecycle.deactivate`);
      if (lifecycles.has(normalized)) throw new Error(`Sidebar lifecycle is already registered: ${normalized}.`);
      lifecycles.set(normalized, lifecycle);
      if (started && activeTab() === normalized) invokeLifecycle(normalized, 'activate', 'register');
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        if (lifecycles.get(normalized) !== lifecycle) return;
        if (started && activeTab() === normalized) invokeLifecycle(normalized, 'deactivate', 'unregister');
        lifecycles.delete(normalized);
      };
    },
    destroy() {
      if (destroyed) return;
      if (started) invokeLifecycle(activeTab(), 'deactivate', 'destroy');
      for (const [name, handler] of clickHandlers) tabElements.get(name).removeEventListener('click', handler);
      clickHandlers.clear();
      unsubscribeState?.();
      unsubscribeState = null;
      lifecycles.clear();
      started = false;
      destroyed = true;
    }
  });
  return controller;
}
