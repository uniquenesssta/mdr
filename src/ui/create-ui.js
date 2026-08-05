import { createAppShellView } from './shell/app-shell-view.js';

const mounts = new WeakMap();

function assertRoot(root) {
  if (!root || root.id !== 'app-root' || typeof root.replaceChildren !== 'function') {
    throw new TypeError('createUI requires the #app-root element.');
  }
  if (!root.ownerDocument || typeof root.ownerDocument.createElement !== 'function') {
    throw new TypeError('createUI requires a live document-backed root.');
  }
}

export function createUI(root) {
  assertRoot(root);
  const existing = mounts.get(root);
  if (existing) return existing;

  const previousNodes = [...root.childNodes];
  const previousHidden = root.hidden;
  const view = createAppShellView(root.ownerDocument);
  root.replaceChildren(view.app, view.overlay);
  root.hidden = false;

  let destroyed = false;
  const handle = Object.freeze({
    ...view.refs,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.replaceChildren(...previousNodes);
      root.hidden = previousHidden;
      mounts.delete(root);
    }
  });
  mounts.set(root, handle);
  return handle;
}
