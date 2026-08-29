/**
 * Responsibility: Scoped Stage 6 bridge from remaining classic document callers to canonical FolderTreeController.
 * Imports: None; controller is injected.
 * Exports: mountClassicFolderTreeControllerPort.
 * State/side effects: Owns only one compatibility-host property; no file/tree/expansion/DOM/platform state.
 * Lifecycle: Explicit idempotent destroy removes the host property. Exit plan: remove with classic document callers.
 */

export function mountClassicFolderTreeControllerPort(host, controller) {
  if (!host || typeof host !== 'object') throw new TypeError('Folder Tree compatibility host is required.');
  if (!controller || typeof controller !== 'object') throw new TypeError('FolderTreeController is required.');
  for (const method of ['syncCurrentDocument', 'refresh']) {
    if (typeof controller[method] !== 'function') throw new TypeError(`FolderTreeController.${method} is required.`);
  }
  const key = 'markdownEditorFolderTreeControllerPort';
  if (host[key]) throw new Error('Folder Tree controller compatibility port is already mounted.');
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Folder Tree controller compatibility port is destroyed.');
  };
  const port = Object.freeze({
    syncCurrentDocument(context) {
      assertActive();
      return controller.syncCurrentDocument(context);
    },
    refresh(force) {
      assertActive();
      return controller.refresh(force);
    },
    get snapshot() {
      assertActive();
      return controller.snapshot;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[key] === port) delete host[key];
    }
  });
  host[key] = port;
  return port;
}
