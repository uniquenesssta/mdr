/**
 * Responsibility: Project authoritative LayoutState sidebar visibility into sidebar/resizer DOM without owning sidebar state.
 * Imports: None; LayoutState and DOM surfaces are injected.
 * Exports: createSidebarLayoutController().
 * State/side effects: Reads LayoutState sidebar state, writes scoped sidebar/resizer presentation, and emits geometry notifications.
 * Lifecycle: Explicit start/destroy; the LayoutState subscription is removed deterministically and destroy is terminal.
 */
function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

export function createSidebarLayoutController({ state, sidebar, resizer, onGeometryChanged = () => {} } = {}) {
  requireObject(state, 'Sidebar LayoutState');
  requireFunction(state.subscribe, 'LayoutState.subscribe');
  requireObject(sidebar, 'Sidebar Layout sidebar');
  requireObject(sidebar.classList, 'Sidebar Layout sidebar classList');
  requireObject(resizer, 'Sidebar Layout resizer');
  requireObject(resizer.classList, 'Sidebar Layout resizer classList');
  requireFunction(onGeometryChanged, 'Sidebar Layout geometry notification');

  let started = false;
  let destroyed = false;
  let unsubscribe = null;
  let projectedVisible = null;

  const snapshot = () => state.snapshot;

  function reconcile(reason = 'sidebar-state', notify = true) {
    if (destroyed) throw new Error('Sidebar Layout Controller is destroyed.');
    const current = snapshot().sidebar;
    const visible = Boolean(current.visible && !current.autoCollapsed);
    const previousVisible = projectedVisible;
    projectedVisible = visible;
    sidebar.classList.toggle('hidden', !visible);
    sidebar.classList.toggle('is-hidden', !visible);
    sidebar.setAttribute?.('aria-hidden', visible ? 'false' : 'true');
    resizer.classList.toggle('hidden', !visible);
    resizer.classList.toggle('is-hidden', !visible);
    if (notify && previousVisible !== null && previousVisible !== visible) {
      onGeometryChanged(Object.freeze({ reason, visible, previousVisible }));
    }
    return visible;
  }

  const controller = Object.freeze({
    start() {
      if (destroyed) throw new Error('Sidebar Layout Controller is destroyed.');
      if (started) return controller;
      unsubscribe = state.subscribe(event => {
        if (event?.changedGroup === 'sidebar') reconcile('sidebar-state');
      });
      started = true;
      reconcile('start', false);
      return controller;
    },
    reconcile,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      unsubscribe = null;
      started = false;
    }
  });
  return controller;
}
