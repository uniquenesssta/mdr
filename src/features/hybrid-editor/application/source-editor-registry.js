const bindings = new WeakMap();

function requireController(controller) {
  const methods = ['open', 'getActiveRange', 'handleEditorUpdate', 'close', 'closeFromPointer'];
  if (!controller || methods.some(method => typeof controller[method] !== 'function')) {
    throw new TypeError('Classic Source Edit Controller port requires a complete controller');
  }
  return controller;
}

export function bindHybridSourceEditor(view, controller) {
  if (!view || (typeof view !== 'object' && typeof view !== 'function')) {
    throw new TypeError('Classic Source Edit Controller port requires a view identity');
  }
  if (bindings.has(view)) throw new Error('Classic Source Edit Controller port already mounted');
  const target = requireController(controller);
  const binding = { controller: target };
  bindings.set(view, binding);
  let destroyed = false;
  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (bindings.get(view) === binding) bindings.delete(view);
    }
  });
}

export function getHybridSourceEditor(view) {
  return view ? bindings.get(view)?.controller || null : null;
}
