/**
 * Responsibility: Expose the scoped SidebarTabController to remaining classic scripts without copying Sidebar state.
 * Imports: None.
 * Exports: mountClassicSidebarControllerPort().
 * State/side effects: Owns only one compatibility-host property; all reads/commands forward to the injected controller.
 * Lifecycle: Explicit idempotent destroy; controller lifecycle remains owned by composition.
 */
const PORT_NAME = 'markdownEditorSidebarControllerPort';

export function mountClassicSidebarControllerPort(host, controller) {
  if (!host || typeof host !== 'object') throw new TypeError('Sidebar compatibility host is required.');
  if (!controller || typeof controller !== 'object') throw new TypeError('SidebarTabController is required.');
  for (const method of ['select', 'isActive', 'registerLifecycle']) {
    if (typeof controller[method] !== 'function') throw new TypeError(`SidebarTabController.${method} must be a function.`);
  }
  if (host[PORT_NAME]) throw new Error('Sidebar controller compatibility port is already mounted.');
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Sidebar controller compatibility port has been destroyed.');
  };
  const api = Object.freeze({
    get activeTab() {
      assertActive();
      return controller.activeTab;
    },
    isActive(tab) {
      assertActive();
      return controller.isActive(tab);
    },
    select(tab, options) {
      assertActive();
      return controller.select(tab, options);
    },
    registerLifecycle(tab, lifecycle) {
      assertActive();
      return controller.registerLifecycle(tab, lifecycle);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_NAME] === api) delete host[PORT_NAME];
    }
  });
  host[PORT_NAME] = api;
  return api;
}
