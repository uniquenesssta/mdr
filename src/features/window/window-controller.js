/**
 * Responsibility: Coordinate WindowState, controls, drag, close lifecycle and WindowPort resize/maximize synchronization.
 * Imports: None.
 * Exports: createWindowController().
 * State/side effects: Owns one resize subscription and delegates DOM/close/drag responsibilities to injected feature modules.
 * Lifecycle: Explicit idempotent async start/destroy with stale async suppression; destroy is terminal.
 */

function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}
function freezeResult(value) {
  return Object.freeze(value);
}

export function createWindowController({
  state,
  windowPort,
  controlsView,
  dragRegion,
  closeController,
  supported = false,
  notify = () => {},
  reportError = (message, error) => console.warn(message, error)
} = {}) {
  requireObject(state, 'Window Controller WindowState');
  for (const method of ['setAvailable', 'setMaximized', 'destroy']) {
    requireFunction(state[method], `Window Controller WindowState.${method}`);
  }
  requireObject(windowPort, 'Window Controller WindowPort');
  for (const method of ['startDrag', 'minimize', 'toggleMaximize', 'isMaximized', 'subscribeResize']) {
    requireFunction(windowPort[method], `Window Controller WindowPort.${method}`);
  }
  requireObject(controlsView, 'Window Controller controlsView');
  requireFunction(controlsView.start, 'Window Controller controlsView.start');
  requireFunction(controlsView.destroy, 'Window Controller controlsView.destroy');
  requireObject(dragRegion, 'Window Controller dragRegion');
  requireFunction(dragRegion.start, 'Window Controller dragRegion.start');
  requireFunction(dragRegion.destroy, 'Window Controller dragRegion.destroy');
  requireObject(closeController, 'Window Controller closeController');
  requireFunction(closeController.start, 'Window Controller closeController.start');
  requireFunction(closeController.requestClose, 'Window Controller closeController.requestClose');
  requireFunction(closeController.destroy, 'Window Controller closeController.destroy');
  requireFunction(notify, 'Window Controller notify');
  requireFunction(reportError, 'Window Controller reportError');

  const capabilitySupported = Boolean(supported);
  let started = false;
  let destroyed = false;
  let lifecycleGeneration = 0;
  let stateRequestGeneration = 0;
  let startPromise = null;
  let destroyPromise = null;
  let resizeDisposer = null;
  let resizeSubscriptionPromise = null;

  function assertActive() {
    if (destroyed) throw new Error('Window Controller is destroyed.');
  }

  async function refreshMaximized(reason = 'refresh') {
    assertActive();
    if (!capabilitySupported) return freezeResult({ ok: false, supported: false, changed: false, reason: 'unsupported' });
    const requestGeneration = ++stateRequestGeneration;
    const lifecycle = lifecycleGeneration;
    try {
      const maximized = Boolean(await windowPort.isMaximized());
      if (destroyed || !started || lifecycle !== lifecycleGeneration || requestGeneration !== stateRequestGeneration) {
        return freezeResult({ ok: false, supported: true, changed: false, reason: 'stale' });
      }
      const changed = state.setMaximized(maximized);
      return freezeResult({ ok: true, supported: true, maximized, changed, reason });
    } catch (error) {
      if (!destroyed && lifecycle === lifecycleGeneration && requestGeneration === stateRequestGeneration) {
        reportError('Failed to refresh window state:', error);
      }
      return freezeResult({ ok: false, supported: true, changed: false, reason: 'refresh-failed', error });
    }
  }

  async function minimize() {
    assertActive();
    if (!capabilitySupported) return freezeResult({ ok: false, supported: false, reason: 'unsupported' });
    try {
      await windowPort.minimize();
      return freezeResult({ ok: true, supported: true, reason: 'minimized' });
    } catch (error) {
      notify(error?.message || String(error));
      return freezeResult({ ok: false, supported: true, reason: 'minimize-failed', error });
    }
  }

  async function startDrag() {
    assertActive();
    if (!capabilitySupported) return freezeResult({ ok: false, supported: false, reason: 'unsupported' });
    try {
      await windowPort.startDrag();
      return freezeResult({ ok: true, supported: true, reason: 'drag-started' });
    } catch (error) {
      reportError('Window drag failed:', error);
      return freezeResult({ ok: false, supported: true, reason: 'drag-failed', error });
    }
  }

  async function toggleMaximize() {
    assertActive();
    if (!capabilitySupported) return freezeResult({ ok: false, supported: false, changed: false, reason: 'unsupported' });
    const requestGeneration = ++stateRequestGeneration;
    const lifecycle = lifecycleGeneration;
    try {
      const maximized = Boolean(await windowPort.toggleMaximize());
      if (destroyed || !started || lifecycle !== lifecycleGeneration || requestGeneration !== stateRequestGeneration) {
        return freezeResult({ ok: false, supported: true, changed: false, reason: 'stale' });
      }
      const changed = state.setMaximized(maximized);
      return freezeResult({ ok: true, supported: true, maximized, changed, reason: 'toggled' });
    } catch (error) {
      if (!destroyed && lifecycle === lifecycleGeneration && requestGeneration === stateRequestGeneration) {
        notify(error?.message || String(error));
      }
      return freezeResult({ ok: false, supported: true, changed: false, reason: 'maximize-failed', error });
    }
  }

  function installResizeSubscription() {
    const lifecycle = lifecycleGeneration;
    resizeSubscriptionPromise = Promise.resolve()
      .then(() => windowPort.subscribeResize(() => {
        if (destroyed || !started || lifecycle !== lifecycleGeneration) return;
        void refreshMaximized('resize');
      }))
      .then(async disposer => {
        requireFunction(disposer, 'Window Controller resize subscription disposer');
        if (destroyed || !started || lifecycle !== lifecycleGeneration) {
          await disposer();
          return null;
        }
        resizeDisposer = disposer;
        return disposer;
      }, error => {
        if (!destroyed && lifecycle === lifecycleGeneration) {
          reportError('Failed to register window resize listener:', error);
        }
        return null;
      });
    return resizeSubscriptionPromise;
  }

  const controller = Object.freeze({
    start() {
      assertActive();
      if (startPromise) return startPromise;
      started = true;
      lifecycleGeneration += 1;
      state.setAvailable(capabilitySupported);
      controlsView.start();
      if (!capabilitySupported) {
        startPromise = Promise.resolve(controller);
        return startPromise;
      }
      closeController.start();
      dragRegion.start();
      startPromise = (async () => {
        await installResizeSubscription();
        if (!destroyed && started) await refreshMaximized('initial');
        return controller;
      })();
      return startPromise;
    },
    refreshMaximized,
    minimize,
    startDrag,
    toggleMaximize,
    requestClose(source = 'control') {
      assertActive();
      return closeController.requestClose(source);
    },
    destroy() {
      if (destroyPromise) return destroyPromise;
      destroyed = true;
      started = false;
      lifecycleGeneration += 1;
      stateRequestGeneration += 1;
      destroyPromise = (async () => {
        const errors = [];
        try { await resizeSubscriptionPromise; } catch (error) { errors.push(error); }
        const disposer = resizeDisposer;
        resizeDisposer = null;
        if (disposer) {
          try { await disposer(); } catch (error) { errors.push(error); }
        }
        try { dragRegion.destroy(); } catch (error) { errors.push(error); }
        try { await closeController.destroy(); } catch (error) { errors.push(error); }
        try { controlsView.destroy(); } catch (error) { errors.push(error); }
        try { state.destroy(); } catch (error) { errors.push(error); }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, 'Window Controller cleanup failed.');
      })();
      return destroyPromise;
    }
  });
  return controller;
}
