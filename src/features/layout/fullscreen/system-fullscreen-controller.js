/**
 * Responsibility: Own system fullscreen state synchronization and platform fullscreen transitions.
 * Imports: None.
 * Exports: createSystemFullscreenController().
 * State/side effects: Writes only LayoutState fullscreen.system and owns one injected platform subscription disposer.
 * Lifecycle: Explicit idempotent start/destroy with stale subscription suppression; destroy is terminal.
 */
function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}
function freezeResult(result) {
  return Object.freeze(result);
}

export function createSystemFullscreenController({ state, fullscreen, supported = false } = {}) {
  requireObject(state, 'System Fullscreen LayoutState');
  requireFunction(state.setFullscreen, 'System Fullscreen LayoutState.setFullscreen');
  requireObject(fullscreen, 'System Fullscreen platform port');
  for (const method of ['isEnabled', 'isActive', 'enter', 'exit', 'subscribe']) {
    requireFunction(fullscreen[method], `System Fullscreen platform.${method}`);
  }

  const capabilitySupported = Boolean(supported);
  let started = false;
  let destroyed = false;
  let subscriptionDisposer = null;
  let lifecycleGeneration = 0;

  function assertActive() {
    if (destroyed) throw new Error('System Fullscreen Controller is destroyed.');
  }

  function sync(active) {
    const normalized = Boolean(active);
    const previous = Boolean(state.snapshot.fullscreen.system);
    if (previous !== normalized) state.setFullscreen({ system: normalized });
    return previous !== normalized;
  }

  const controller = Object.freeze({
    start() {
      assertActive();
      if (started) return controller;
      started = true;
      lifecycleGeneration += 1;
      if (!capabilitySupported) {
        sync(false);
        return controller;
      }
      sync(fullscreen.isActive());
      const generation = lifecycleGeneration;
      subscriptionDisposer = fullscreen.subscribe(active => {
        if (destroyed || !started || generation != lifecycleGeneration) return;
        sync(active);
      });
      requireFunction(subscriptionDisposer, 'System Fullscreen subscription disposer');
      return controller;
    },
    async toggle() {
      assertActive();
      if (!capabilitySupported) {
        sync(false);
        return freezeResult({ ok: false, supported: false, active: false, changed: false, reason: 'unsupported' });
      }
      let before = Boolean(state.snapshot.fullscreen.system);
      try {
        before = Boolean(fullscreen.isActive());
        if (before) await fullscreen.exit();
        else await fullscreen.enter();
        const active = Boolean(fullscreen.isActive());
        sync(active);
        return freezeResult({
          ok: true,
          supported: true,
          active,
          changed: before !== active,
          reason: before ? 'exit' : 'enter'
        });
      } catch (error) {
        let active = Boolean(state.snapshot.fullscreen.system);
        try { active = Boolean(fullscreen.isActive()); } catch (_) {}
        sync(active);
        return freezeResult({
          ok: false,
          supported: true,
          active,
          changed: before !== active,
          reason: 'operation-failed',
          error
        });
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      started = false;
      lifecycleGeneration += 1;
      subscriptionDisposer?.();
      subscriptionDisposer = null;
    }
  });
  return controller;
}
