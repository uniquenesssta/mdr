/**
 * Responsibility: Scoped bridge from remaining classic preview code to the Stage 7 Render Coordinator.
 * Imports: None; receives the canonical coordinator explicitly.
 * Exports: mountClassicPreviewRenderCoordinatorPort().
 * State/side effects: Owns one non-enumerable compatibility-host property and removes it on destroy.
 * Lifecycle: API calls are terminal after destroy(); coordinator lifecycle stays with the composition root.
 */
const PORT_PROPERTY = 'markdownEditorPreviewRenderCoordinatorPort';

function assertTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('Classic Preview Render Coordinator port target must be an object.');
  }
}

function assertCoordinator(coordinator) {
  if (!coordinator
    || typeof coordinator.createPlan !== 'function'
    || typeof coordinator.execute !== 'function') {
    throw new TypeError('Classic Preview Render Coordinator port requires a coordinator.');
  }
}

export function mountClassicPreviewRenderCoordinatorPort(target, coordinator) {
  assertTarget(target);
  assertCoordinator(coordinator);
  if (Object.hasOwn(target, PORT_PROPERTY)) {
    throw new Error('Classic Preview Render Coordinator port is already mounted.');
  }

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Classic Preview Render Coordinator port is destroyed.');
  };
  const api = Object.freeze({
    createPlan(input) {
      assertActive();
      return coordinator.createPlan(input);
    },
    execute(plan, renderers) {
      assertActive();
      return coordinator.execute(plan, renderers);
    }
  });

  Object.defineProperty(target, PORT_PROPERTY, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api
  });

  return Object.freeze({
    api,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (target[PORT_PROPERTY] === api) delete target[PORT_PROPERTY];
      if (typeof target.removeAttribute === 'function') target.removeAttribute(PORT_PROPERTY);
    }
  });
}
