/**
 * Responsibility: Own ordinary split pointer drag, ratio policy/projection, persistence and split-resize lifecycle.
 * Imports: None; LayoutState and runtime primitives are injected.
 * Exports: createSplitResizeController() plus stable ratio storage key.
 * State/side effects: Writes canonical LayoutState ratio/resize state, editor/preview flex styles, resizer ARIA and scoped resize classes; emits geometry-changed only.
 * Lifecycle: Explicit start/destroy; pointer capture, state subscription and scheduled frame are cleaned terminally.
 */
export const SPLIT_RATIO_STORAGE_KEY = 'md_editor_ratio';
export const SPLIT_RATIO_MIN = 0.15;
export const SPLIT_RATIO_MAX = 0.85;

function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

export function createSplitResizeController({
  state,
  main,
  editorPane,
  previewPane,
  resizer,
  body,
  storage,
  requestFrame,
  cancelFrame,
  onGeometryChanged = () => {}
} = {}) {
  requireObject(state, 'Split Resize LayoutState');
  requireFunction(state.setSplit, 'LayoutState.setSplit');
  requireFunction(state.setResize, 'LayoutState.setResize');
  requireFunction(state.subscribe, 'LayoutState.subscribe');
  for (const [value, label] of [[main, 'main'], [editorPane, 'editor pane'], [previewPane, 'preview pane'], [resizer, 'handle'], [body, 'body'], [storage, 'storage']]) {
    requireObject(value, `Split Resize ${label}`);
  }
  requireFunction(resizer.addEventListener, 'Split Resize handle addEventListener');
  requireFunction(resizer.removeEventListener, 'Split Resize handle removeEventListener');
  requireFunction(resizer.setPointerCapture, 'Split Resize handle setPointerCapture');
  requireFunction(resizer.releasePointerCapture, 'Split Resize handle releasePointerCapture');
  requireFunction(storage.getItem, 'Split Resize storage getItem');
  requireFunction(storage.setItem, 'Split Resize storage setItem');
  requireFunction(requestFrame, 'Split Resize requestFrame');
  requireFunction(cancelFrame, 'Split Resize cancelFrame');
  requireFunction(onGeometryChanged, 'Split Resize geometry notification');

  let started = false;
  let destroyed = false;
  let activePointerId = null;
  let resizeRect = null;
  let projectFrame = 0;
  let pendingReason = '';
  let unsubscribe = null;

  const snapshot = () => state.snapshot;
  const normalizeRatio = value => {
    const ratio = Number(value);
    if (!Number.isFinite(ratio)) return 0.5;
    return Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, ratio));
  };

  function setPresentation(active) {
    body.classList?.toggle('resizing', active);
    body.classList?.toggle('is-resizing', active);
    resizer.classList?.toggle('dragging', active);
    resizer.classList?.toggle('is-dragging', active);
    body.style.cursor = active ? 'col-resize' : '';
    body.style.userSelect = active ? 'none' : '';
  }

  function project(reason = 'split-state') {
    const split = snapshot().split;
    if (split.editorCollapsed || split.previewCollapsed) {
      editorPane.style.flex = '';
      previewPane.style.flex = '';
    } else {
      editorPane.style.flex = `0 0 ${split.ratio * 100}%`;
      previewPane.style.flex = '1 1 0';
    }
    resizer.setAttribute?.('aria-valuemin', String(SPLIT_RATIO_MIN * 100));
    resizer.setAttribute?.('aria-valuemax', String(SPLIT_RATIO_MAX * 100));
    resizer.setAttribute?.('aria-valuenow', String(Math.round(split.ratio * 100)));
    onGeometryChanged(Object.freeze({
      reason,
      ratio: split.ratio,
      editorCollapsed: split.editorCollapsed,
      previewCollapsed: split.previewCollapsed,
      active: snapshot().resize.splitActive
    }));
  }

  function scheduleProject(reason) {
    pendingReason = reason || pendingReason || 'split-state';
    if (projectFrame) return;
    projectFrame = requestFrame(() => {
      projectFrame = 0;
      const nextReason = pendingReason;
      pendingReason = '';
      if (!destroyed) project(nextReason);
    });
  }

  function releaseCapture(pointerId) {
    try {
      if (resizer.hasPointerCapture?.(pointerId) === false) return;
      resizer.releasePointerCapture(pointerId);
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
  }

  function finish(reason, { persist = true, release = true } = {}) {
    if (activePointerId === null) return false;
    const pointerId = activePointerId;
    activePointerId = null;
    resizeRect = null;
    state.setResize({ splitActive: false });
    if (persist) storage.setItem(SPLIT_RATIO_STORAGE_KEY, String(snapshot().split.ratio));
    setPresentation(false);
    if (release) releaseCapture(pointerId);
    if (projectFrame) {
      cancelFrame(projectFrame);
      projectFrame = 0;
      pendingReason = '';
    }
    project(reason);
    return true;
  }

  function canStart(event) {
    if (!started || destroyed || activePointerId !== null) return false;
    if (event?.isPrimary === false) return false;
    if (event?.button !== undefined && Number(event.button) !== 0) return false;
    const current = snapshot();
    return current.mode === 'both'
      && !current.split.compactActive
      && !current.split.editorCollapsed
      && !current.split.previewCollapsed;
  }

  function onPointerDown(event) {
    if (!canStart(event)) return;
    const pointerId = Number(event.pointerId);
    const rect = main.getBoundingClientRect?.();
    if (!Number.isFinite(pointerId) || !rect || !(Number(rect.width) > 0) || !Number.isFinite(Number(rect.left))) return;
    resizer.setPointerCapture(pointerId);
    activePointerId = pointerId;
    resizeRect = rect;
    state.setResize({ splitActive: true });
    setPresentation(true);
    event.preventDefault?.();
  }

  function onPointerMove(event) {
    if (activePointerId === null || Number(event.pointerId) !== activePointerId || !resizeRect) return;
    const clientX = Number(event.clientX);
    if (!Number.isFinite(clientX)) return;
    const ratio = normalizeRatio((clientX - Number(resizeRect.left)) / Number(resizeRect.width));
    state.setSplit({ ratio });
    event.preventDefault?.();
  }
  function onPointerUp(event) {
    if (activePointerId !== null && Number(event.pointerId) === activePointerId) finish('pointer-end');
  }
  function onPointerCancel(event) {
    if (activePointerId !== null && Number(event.pointerId) === activePointerId) finish('pointer-cancel');
  }
  function onLostPointerCapture(event) {
    if (activePointerId !== null && Number(event.pointerId) === activePointerId) finish('pointer-capture-lost', { release: false });
  }

  const controller = Object.freeze({
    start() {
      if (destroyed) throw new Error('Split Resize Controller is destroyed.');
      if (started) return controller;
      unsubscribe = state.subscribe(event => {
        if (event?.changedGroup === 'split') scheduleProject('split-state');
      });
      const stored = storage.getItem(SPLIT_RATIO_STORAGE_KEY);
      const ratio = normalizeRatio(stored === null ? snapshot().split.ratio : stored);
      state.setSplit({ ratio });
      project('restore');
      resizer.addEventListener('pointerdown', onPointerDown);
      resizer.addEventListener('pointermove', onPointerMove);
      resizer.addEventListener('pointerup', onPointerUp);
      resizer.addEventListener('pointercancel', onPointerCancel);
      resizer.addEventListener('lostpointercapture', onLostPointerCapture);
      started = true;
      return controller;
    },
    normalizeRatio,
    project,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizer.removeEventListener('pointerdown', onPointerDown);
      resizer.removeEventListener('pointermove', onPointerMove);
      resizer.removeEventListener('pointerup', onPointerUp);
      resizer.removeEventListener('pointercancel', onPointerCancel);
      resizer.removeEventListener('lostpointercapture', onLostPointerCapture);
      unsubscribe?.();
      unsubscribe = null;
      if (projectFrame) cancelFrame(projectFrame);
      projectFrame = 0;
      pendingReason = '';
      if (activePointerId !== null) finish('destroy', { persist: false });
      started = false;
    }
  });
  return controller;
}
