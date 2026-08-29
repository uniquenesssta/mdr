/**
 * Responsibility: Own sidebar drag-resize interaction, width policy, CSS projection, persistence and resize lifecycle.
 * Imports: Shared responsive breakpoint helper only.
 * Exports: createSidebarResizeController() and the stable sidebar width storage key.
 * State/side effects: Writes canonical LayoutState sidebar/resize groups, one CSS variable, resizer ARIA, local storage and scoped DOM classes.
 * Lifecycle: Explicit start/destroy; all pointer and viewport listeners are removed and an active capture is cleaned on destroy.
 */
import { matchesNarrowInteractiveLayout } from '../shell/responsive-breakpoints.js';

export const SIDEBAR_WIDTH_STORAGE_KEY = 'md_editor_sidebar_width';

const DEFAULT_WIDTH = 248;
const MIN_WIDTH = 180;
const MAX_WIDTH = 520;
const MIN_DYNAMIC_MAX_WIDTH = 240;
const WORKSPACE_RESERVED_WIDTH = 360;

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}

export function createSidebarResizeController({
  state,
  workspace,
  resizer,
  root,
  body,
  storage,
  viewport,
  matchMedia,
  onGeometryChanged = () => {}
} = {}) {
  requireObject(state, 'Sidebar Resize LayoutState');
  requireFunction(state.setSidebar, 'LayoutState.setSidebar');
  requireFunction(state.setResize, 'LayoutState.setResize');
  requireObject(workspace, 'Sidebar Resize workspace');
  requireObject(resizer, 'Sidebar Resize handle');
  requireFunction(resizer.addEventListener, 'Sidebar Resize handle addEventListener');
  requireFunction(resizer.removeEventListener, 'Sidebar Resize handle removeEventListener');
  requireFunction(resizer.setPointerCapture, 'Sidebar Resize handle setPointerCapture');
  requireFunction(resizer.releasePointerCapture, 'Sidebar Resize handle releasePointerCapture');
  requireObject(root, 'Sidebar Resize root');
  requireObject(root.style, 'Sidebar Resize root style');
  requireObject(body, 'Sidebar Resize body');
  requireObject(body.classList, 'Sidebar Resize body classList');
  requireObject(body.style, 'Sidebar Resize body style');
  requireObject(storage, 'Sidebar Resize storage');
  requireFunction(storage.getItem, 'Sidebar Resize storage getItem');
  requireFunction(storage.setItem, 'Sidebar Resize storage setItem');
  requireObject(viewport, 'Sidebar Resize viewport');
  requireFunction(viewport.addEventListener, 'Sidebar Resize viewport addEventListener');
  requireFunction(viewport.removeEventListener, 'Sidebar Resize viewport removeEventListener');
  requireFunction(onGeometryChanged, 'Sidebar Resize geometry notification');

  let started = false;
  let destroyed = false;
  let activePointerId = null;
  let resizeRect = null;

  const snapshot = () => state.snapshot;

  function getWorkspaceWidth() {
    const width = Number(workspace.clientWidth) || Number(viewport.innerWidth) || 1200;
    return Math.max(0, width);
  }

  function normalizeWidth(value) {
    const numeric = Number(value);
    const maxWidth = Math.max(
      MIN_DYNAMIC_MAX_WIDTH,
      Math.min(MAX_WIDTH, getWorkspaceWidth() - WORKSPACE_RESERVED_WIDTH)
    );
    if (!Number.isFinite(numeric)) return DEFAULT_WIDTH;
    return Math.round(Math.max(MIN_WIDTH, Math.min(maxWidth, numeric)));
  }

  function projectWidth(width) {
    root.style.setProperty('--sidebar-width', `${width}px`);
    resizer.setAttribute?.('aria-valuemin', String(MIN_WIDTH));
    resizer.setAttribute?.('aria-valuemax', String(MAX_WIDTH));
    resizer.setAttribute?.('aria-valuenow', String(width));
  }

  function commitWidth(value, reason, notify = true) {
    const previous = snapshot().sidebar.width;
    const width = normalizeWidth(value);
    if (width !== previous) state.setSidebar({ width });
    projectWidth(width);
    if (notify && width !== previous) {
      onGeometryChanged(Object.freeze({ reason, width, previousWidth: previous, active: activePointerId !== null }));
    }
    return width;
  }

  function restoreWidth() {
    const stored = storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const fallback = snapshot().sidebar.width;
    commitWidth(stored === null ? fallback : stored, 'restore', false);
  }

  function canStartResize(event) {
    if (!started || destroyed || activePointerId !== null) return false;
    if (event?.isPrimary === false) return false;
    if (event?.button !== undefined && Number(event.button) !== 0) return false;
    const current = snapshot();
    if (!current.sidebar.visible || current.sidebar.autoCollapsed || current.compact.shellActive) return false;
    if (matchesNarrowInteractiveLayout(matchMedia)) return false;
    return true;
  }

  function setActivePresentation(active) {
    body.classList.toggle('resizing', active);
    body.classList.toggle('sidebar-resizing', active);
    body.classList.toggle('is-resizing', active);
    body.classList.toggle('is-sidebar-resizing', active);
    resizer.classList?.toggle('dragging', active);
    resizer.classList?.toggle('is-dragging', active);
    body.style.cursor = active ? 'col-resize' : '';
    body.style.userSelect = active ? 'none' : '';
  }

  function releaseCapture(pointerId) {
    try {
      if (resizer.hasPointerCapture?.(pointerId) === false) return;
      resizer.releasePointerCapture(pointerId);
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
  }

  function finishResize(reason, { persist = true, release = true } = {}) {
    if (activePointerId === null) return false;
    const pointerId = activePointerId;
    activePointerId = null;
    resizeRect = null;
    state.setResize({ sidebarActive: false });
    if (persist) storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(snapshot().sidebar.width));
    setActivePresentation(false);
    if (release) releaseCapture(pointerId);
    onGeometryChanged(Object.freeze({
      reason,
      width: snapshot().sidebar.width,
      previousWidth: snapshot().sidebar.width,
      active: false
    }));
    return true;
  }

  function onPointerDown(event) {
    if (!canStartResize(event)) return;
    const pointerId = Number(event.pointerId);
    if (!Number.isFinite(pointerId)) return;
    const rect = workspace.getBoundingClientRect?.();
    if (!rect || !Number.isFinite(Number(rect.left))) return;
    resizer.setPointerCapture(pointerId);
    activePointerId = pointerId;
    resizeRect = rect;
    state.setResize({ sidebarActive: true });
    setActivePresentation(true);
    event.preventDefault?.();
  }

  function onPointerMove(event) {
    if (activePointerId === null || Number(event.pointerId) !== activePointerId || !resizeRect) return;
    const clientX = Number(event.clientX);
    if (!Number.isFinite(clientX)) return;
    commitWidth(clientX - Number(resizeRect.left), 'pointer-move');
    event.preventDefault?.();
  }

  function onPointerUp(event) {
    if (activePointerId === null || Number(event.pointerId) !== activePointerId) return;
    finishResize('pointer-end');
  }

  function onPointerCancel(event) {
    if (activePointerId === null || Number(event.pointerId) !== activePointerId) return;
    finishResize('pointer-cancel');
  }

  function onLostPointerCapture(event) {
    if (activePointerId === null || Number(event.pointerId) !== activePointerId) return;
    finishResize('pointer-capture-lost', { release: false });
  }

  function onViewportResize() {
    const previous = snapshot().sidebar.width;
    const width = normalizeWidth(previous);
    if (width === previous) {
      projectWidth(width);
      return;
    }
    commitWidth(width, 'viewport-resize');
  }

  const controller = Object.freeze({
    start() {
      if (destroyed) throw new Error('Sidebar Resize Controller is destroyed.');
      if (started) return controller;
      restoreWidth();
      resizer.addEventListener('pointerdown', onPointerDown);
      resizer.addEventListener('pointermove', onPointerMove);
      resizer.addEventListener('pointerup', onPointerUp);
      resizer.addEventListener('pointercancel', onPointerCancel);
      resizer.addEventListener('lostpointercapture', onLostPointerCapture);
      viewport.addEventListener('resize', onViewportResize, { passive: true });
      started = true;
      return controller;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (started) {
        resizer.removeEventListener('pointerdown', onPointerDown);
        resizer.removeEventListener('pointermove', onPointerMove);
        resizer.removeEventListener('pointerup', onPointerUp);
        resizer.removeEventListener('pointercancel', onPointerCancel);
        resizer.removeEventListener('lostpointercapture', onLostPointerCapture);
        viewport.removeEventListener('resize', onViewportResize);
      }
      if (activePointerId !== null) finishResize('destroy', { persist: false });
      started = false;
    },
    normalizeWidth
  });

  return controller;
}
