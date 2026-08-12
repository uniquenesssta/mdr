/**
 * Responsibility: Orchestrate save-before-close, native close interception and close/force-close fallback.
 * Imports: None.
 * Exports: createWindowCloseController().
 * State/side effects: Writes only WindowState.closePhase and owns one WindowPort close-request subscription.
 * Lifecycle: Explicit idempotent start/async destroy with generation guards; destroy is terminal.
 */

function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}
function result(value) {
  return Object.freeze(value);
}

export function createWindowCloseController({
  state,
  windowPort,
  closeSave,
  supported = false,
  notify = () => {},
  record = () => {},
  reportError = (message, error) => console.error(message, error)
} = {}) {
  requireObject(state, 'Window Close WindowState');
  requireFunction(state.setClosePhase, 'Window Close WindowState.setClosePhase');
  requireObject(windowPort, 'Window Close WindowPort');
  for (const method of ['subscribeCloseRequest', 'requestClose', 'forceClose']) {
    requireFunction(windowPort[method], `Window Close WindowPort.${method}`);
  }
  requireObject(closeSave, 'Window Close CloseSavePort');
  requireFunction(closeSave.prepareClose, 'Window Close CloseSavePort.prepareClose');
  requireFunction(notify, 'Window Close notify');
  requireFunction(record, 'Window Close record');
  requireFunction(reportError, 'Window Close reportError');

  const capabilitySupported = Boolean(supported);
  let started = false;
  let destroyed = false;
  let lifecycleGeneration = 0;
  let operationGeneration = 0;
  let subscriptionDisposer = null;
  let subscriptionPromise = null;
  let destroyPromise = null;

  function assertActive() {
    if (destroyed) throw new Error('Window Close Controller is destroyed.');
  }

  function currentPhase() {
    return state.snapshot.closePhase;
  }

  function resetAfterFailure() {
    if (!destroyed && currentPhase() !== 'idle') state.setClosePhase('idle');
  }

  async function closeWindow(generation) {
    state.setClosePhase('committed');
    try {
      await windowPort.requestClose();
      return result({ ok: true, supported: true, committed: true, forced: false, reason: 'closed' });
    } catch (closeError) {
      if (destroyed || generation !== operationGeneration) {
        return result({ ok: false, supported: true, committed: true, forced: false, reason: 'stale' });
      }
      try {
        await windowPort.forceClose();
        return result({ ok: true, supported: true, committed: true, forced: true, reason: 'forced' });
      } catch (forceError) {
        resetAfterFailure();
        const message = forceError?.message || closeError?.message || String(forceError || closeError);
        const failure = new AggregateError([closeError, forceError], 'Window close failed.');
        reportError('Window close failed:', failure);
        record('window.close-error', Object.freeze({
          category: 'app.lifecycle',
          status: 'error',
          details: Object.freeze({ message })
        }));
        notify('关闭窗口失败：' + message);
        return result({
          ok: false,
          supported: true,
          committed: false,
          forced: false,
          reason: 'close-failed',
          error: failure
        });
      }
    }
  }

  async function requestClose(source = 'control') {
    assertActive();
    if (!capabilitySupported) {
      return result({ ok: false, supported: false, committed: false, forced: false, reason: 'unsupported' });
    }
    const phase = currentPhase();
    if (phase === 'committed') {
      return result({ ok: true, supported: true, committed: true, forced: false, reason: 'already-committed' });
    }
    if (phase === 'saving') {
      return result({ ok: false, supported: true, committed: false, forced: false, reason: 'busy' });
    }

    state.setClosePhase('saving');
    const generation = ++operationGeneration;
    let allowed;
    try {
      allowed = await closeSave.prepareClose();
    } catch (error) {
      if (!destroyed && generation === operationGeneration) resetAfterFailure();
      reportError('Window close-save failed:', error);
      return result({
        ok: false,
        supported: true,
        committed: false,
        forced: false,
        reason: 'close-save-failed',
        source,
        error
      });
    }
    if (destroyed || generation !== operationGeneration) {
      return result({ ok: false, supported: true, committed: false, forced: false, reason: 'stale', source });
    }
    if (!allowed) {
      resetAfterFailure();
      return result({ ok: false, supported: true, committed: false, forced: false, reason: 'cancelled', source });
    }
    return closeWindow(generation);
  }

  function handleNativeClose(event) {
    if (destroyed || !started || !capabilitySupported) return;
    if (currentPhase() === 'committed') return;
    event?.preventDefault?.();
    void requestClose('native').catch(error => reportError('Native window close failed:', error));
  }

  const controller = Object.freeze({
    start() {
      assertActive();
      if (started) return false;
      started = true;
      lifecycleGeneration += 1;
      if (!capabilitySupported) return true;
      const generation = lifecycleGeneration;
      subscriptionPromise = Promise.resolve(windowPort.subscribeCloseRequest(handleNativeClose))
        .then(async disposer => {
          requireFunction(disposer, 'Window Close subscription disposer');
          if (destroyed || !started || generation !== lifecycleGeneration) {
            await disposer();
            return null;
          }
          subscriptionDisposer = disposer;
          return disposer;
        }, error => {
          if (!destroyed && generation === lifecycleGeneration) {
            reportError('Failed to register close handler:', error);
            record('window.close-handler-error', Object.freeze({
              category: 'app.lifecycle',
              status: 'error',
              details: Object.freeze({ message: error?.message || String(error) })
            }));
          }
          return null;
        });
      return true;
    },
    requestClose,
    destroy() {
      if (destroyPromise) return destroyPromise;
      destroyed = true;
      started = false;
      lifecycleGeneration += 1;
      operationGeneration += 1;
      destroyPromise = (async () => {
        await subscriptionPromise;
        const disposer = subscriptionDisposer;
        subscriptionDisposer = null;
        if (disposer) await disposer();
      })();
      return destroyPromise;
    }
  });
  return controller;
}
