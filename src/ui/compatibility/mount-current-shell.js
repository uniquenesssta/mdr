const mounts = new WeakMap();

function assertMountRoot(root) {
  if (!root || root.id !== 'app-root' || typeof root.before !== 'function') {
    throw new TypeError('mountCurrentShell requires the #app-root element.');
  }
  if (!root.ownerDocument?.body || typeof root.ownerDocument.createElement !== 'function') {
    throw new TypeError('mountCurrentShell requires a live document-backed root.');
  }
}

export function mountCurrentShell(root, markup, { theme = 'light' } = {}) {
  assertMountRoot(root);
  if (typeof markup !== 'string' || markup.trim().length === 0) {
    throw new TypeError('mountCurrentShell requires non-empty shell markup.');
  }

  const existing = mounts.get(root);
  if (existing) return existing;

  const documentRef = root.ownerDocument;
  const body = documentRef.body;
  const template = documentRef.createElement('template');
  template.innerHTML = markup;
  if (template.content.querySelector('script')) {
    throw new Error('Current shell markup must not contain script elements.');
  }

  const mountedNodes = [...template.content.childNodes];
  const previousHidden = root.hidden;
  const previousTheme = body.getAttribute('data-theme');

  root.before(template.content);
  root.hidden = true;
  if (previousTheme === null) body.setAttribute('data-theme', theme);

  let destroyed = false;
  const handle = Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const node of mountedNodes) node.remove();
      root.hidden = previousHidden;
      if (previousTheme === null) body.removeAttribute('data-theme');
      else body.setAttribute('data-theme', previousTheme);
      mounts.delete(root);
    }
  });
  mounts.set(root, handle);
  return handle;
}
