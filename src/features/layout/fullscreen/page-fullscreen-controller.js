/**
 * Responsibility: Own persisted page-focus fullscreen state and exact shell class projection.
 * Imports: None.
 * Exports: createPageFullscreenController(), PAGE_FULLSCREEN_STORAGE_KEY.
 * State/side effects: Writes only LayoutState fullscreen.page, injected shell classes and one persisted string key.
 * Lifecycle: Explicit idempotent start/destroy; destroy removes owned classes and makes the controller terminal.
 */
export const PAGE_FULLSCREEN_STORAGE_KEY = 'md_editor_page_fullscreen';

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

export function createPageFullscreenController({
  state,
  app,
  body,
  storage,
  onGeometryChanged = () => {}
} = {}) {
  requireObject(state, 'Page Fullscreen LayoutState');
  requireFunction(state.setFullscreen, 'Page Fullscreen LayoutState.setFullscreen');
  requireObject(app, 'Page Fullscreen app shell');
  requireObject(app.classList, 'Page Fullscreen app classList');
  requireObject(body, 'Page Fullscreen body');
  requireObject(body.classList, 'Page Fullscreen body classList');
  requireObject(storage, 'Page Fullscreen storage port');
  requireFunction(storage.get, 'Page Fullscreen storage.get');
  requireFunction(storage.set, 'Page Fullscreen storage.set');
  requireFunction(onGeometryChanged, 'Page Fullscreen geometry callback');

  let started = false;
  let destroyed = false;

  function assertActive() {
    if (destroyed) throw new Error('Page Fullscreen Controller is destroyed.');
  }

  function currentActive() {
    return Boolean(state.snapshot.fullscreen.page);
  }

  function project(active) {
    app.classList.toggle('page-fullscreen', active);
    app.classList.toggle('is-page-fullscreen', active);
    body.classList.toggle('page-fullscreen-active', active);
    body.classList.toggle('is-page-fullscreen-active', active);
  }

  function applyRuntime(active, reason) {
    const normalized = Boolean(active);
    const previous = currentActive();
    if (previous !== normalized) state.setFullscreen({ page: normalized });
    project(normalized);
    const changed = previous !== normalized;
    if (changed) onGeometryChanged({ source: 'page-fullscreen', active: normalized, reason });
    return { active: normalized, changed };
  }

  async function setActive(active, { persist = true, reason = 'set' } = {}) {
    assertActive();
    const runtime = applyRuntime(active, reason);
    if (!persist) return freezeResult({ ok: true, persisted: false, ...runtime, reason });
    try {
      await storage.set(PAGE_FULLSCREEN_STORAGE_KEY, runtime.active ? 'true' : 'false');
      return freezeResult({ ok: true, persisted: true, ...runtime, reason });
    } catch (error) {
      return freezeResult({ ok: false, persisted: false, ...runtime, reason: 'persistence-failed', error });
    }
  }

  const controller = Object.freeze({
    start() {
      assertActive();
      if (started) return controller;
      started = true;
      const restored = storage.get(PAGE_FULLSCREEN_STORAGE_KEY) === 'true';
      applyRuntime(restored, 'restore');
      return controller;
    },
    setActive,
    toggle() {
      assertActive();
      return setActive(!currentActive(), { persist: true, reason: 'toggle' });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      started = false;
      project(false);
    }
  });
  return controller;
}
