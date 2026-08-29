/**
 * Responsibility: Provide a scoped Stage 6 compatibility bridge from remaining classic scripts to the canonical OutlineController.
 * Imports: None; controller is injected.
 * Exports: mountClassicOutlineControllerPort.
 * State/side effects: Owns only the mounted compatibility-host property; never owns heading, collapse, active-line, DOM or persistence state.
 * Lifecycle: Explicit destroy removes the host property. Exit plan: delete when classic Preview/document-index/scroll callers migrate to feature imports.
 */

export function mountClassicOutlineControllerPort(host, controller) {
  if (!host || typeof host !== 'object') throw new TypeError('Outline compatibility host is required.');
  if (!controller || typeof controller !== 'object') throw new TypeError('OutlineController is required.');
  for (const method of ['replaceIndex', 'replacePreviewBlocks', 'updateActiveLine', 'refresh']) {
    if (typeof controller[method] !== 'function') throw new TypeError(`OutlineController.${method} is required.`);
  }
  const key = 'markdownEditorOutlineControllerPort';
  if (host[key]) throw new Error('Outline controller compatibility port is already mounted.');
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Outline controller compatibility port is destroyed.');
  };
  const port = Object.freeze({
    replaceIndex(headings, options) {
      assertActive();
      return controller.replaceIndex(headings, options);
    },
    replacePreviewBlocks(blocks, options) {
      assertActive();
      return controller.replacePreviewBlocks(blocks, options);
    },
    updateActiveLine(line) {
      assertActive();
      return controller.updateActiveLine(line);
    },
    refresh(reason) {
      assertActive();
      return controller.refresh(reason);
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
