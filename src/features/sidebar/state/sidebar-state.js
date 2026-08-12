/**
 * Responsibility: Own the single authoritative active Sidebar tab value.
 * Imports: None.
 * Exports: SIDEBAR_TABS, normalizeSidebarTab(), createSidebarState().
 * State/side effects: Owns only activeTab and synchronous immutable subscriptions; no DOM or persistence.
 * Lifecycle: Explicit idempotent destroy; terminal after destroy.
 */
export const SIDEBAR_TABS = Object.freeze(['docs', 'files', 'outline']);
const SIDEBAR_TAB_SET = new Set(SIDEBAR_TABS);

export function normalizeSidebarTab(value, fallback = 'docs') {
  const normalized = String(value || '').trim();
  return SIDEBAR_TAB_SET.has(normalized) ? normalized : fallback;
}

export function createSidebarState({ activeTab = 'docs' } = {}) {
  let snapshot = Object.freeze({ activeTab: normalizeSidebarTab(activeTab) });
  let destroyed = false;
  const listeners = new Set();

  const assertActive = () => {
    if (destroyed) throw new Error('SidebarState is destroyed.');
  };

  const api = Object.freeze({
    get snapshot() {
      assertActive();
      return snapshot;
    },
    setActiveTab(value, reason = 'set') {
      assertActive();
      const nextTab = normalizeSidebarTab(value);
      if (nextTab === snapshot.activeTab) return snapshot;
      const previous = snapshot;
      snapshot = Object.freeze({ activeTab: nextTab });
      for (const listener of [...listeners]) {
        try {
          listener(snapshot, previous, Object.freeze({ reason: String(reason || 'set') }));
        } catch (error) {
          console.error('SidebarState listener failed:', error);
        }
      }
      return snapshot;
    },
    subscribe(listener) {
      assertActive();
      if (typeof listener !== 'function') throw new TypeError('SidebarState listener must be a function.');
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
    }
  });
  return api;
}
