/**
 * Atomic 8.5 Widget Lifecycle.
 * Owns one attach/destroy record per widget element, ResizeObserver, and mount-frame cleanup.
 * Geometry refresh scheduling is delegated to widget-geometry-scheduler.
 */
import { scheduleHybridWidgetGeometry } from './widget-geometry-scheduler.js';

const elementLifecycles = new WeakMap();
const widgetCleanups = new WeakMap();
const directEditors = new WeakMap();
const cellActivations = new WeakMap();
const directActivations = new WeakMap();

function register(map, element, value) {
  if (!element || map.has(element)) throw new Error('Widget capability already registered or missing element');
  map.set(element, value);
  return () => { if (map.get(element) === value) map.delete(element); };
}

export function registerHybridWidgetCleanup(element, cleanup) {
  if (typeof cleanup !== 'function') throw new TypeError('Widget cleanup must be a function');
  return register(widgetCleanups, element, cleanup);
}
export function disposeHybridWidget(element) {
  const cleanup = widgetCleanups.get(element);
  widgetCleanups.delete(element);
  try { cleanup?.(); } finally { destroyHybridWidgetLifecycle(element); }
}
export function registerHybridDirectEditor(element, { commit, destroy }) {
  if (typeof commit !== 'function' || typeof destroy !== 'function') throw new TypeError('Direct editor requires commit/destroy');
  return register(directEditors, element, { commit, destroy });
}
export function commitHybridDirectEditor(element, ...args) { return directEditors.get(element)?.commit(...args); }
export function destroyHybridDirectEditor(element) {
  const editor = directEditors.get(element);
  directEditors.delete(element);
  return editor?.destroy();
}
export function registerHybridCellActivation(element, activate) {
  if (typeof activate !== 'function') throw new TypeError('Cell activation must be a function');
  return register(cellActivations, element, activate);
}
export function activateHybridTableCell(element, options) {
  const activate = cellActivations.get(element);
  if (!activate) return false;
  activate(options); return true;
}
export function unregisterHybridCellActivation(element) { return cellActivations.delete(element); }
export function registerHybridDirectActivation(element, dispose) {
  if (typeof dispose !== 'function') throw new TypeError('Direct activation cleanup must be a function');
  return register(directActivations, element, dispose);
}
export function disposeHybridDirectActivation(element) {
  const dispose = directActivations.get(element);
  directActivations.delete(element);
  dispose?.();
}

function resolveRuntimeWindow(element) {
  return element?.ownerDocument?.defaultView || globalThis.window || null;
}

function isElement(element) {
  if (!element || (typeof element !== 'object' && typeof element !== 'function')) return false;
  const ElementCtor = resolveRuntimeWindow(element)?.Element || globalThis.Element;
  return typeof ElementCtor !== 'function' || element instanceof ElementCtor;
}

export function attachHybridWidgetLifecycle(element, view, type) {
  if (!isElement(element)) return () => {};
  const existing = elementLifecycles.get(element);
  if (existing) return existing.cleanup;

  const runtimeWindow = resolveRuntimeWindow(element);
  const ResizeObserverCtor = runtimeWindow?.ResizeObserver || globalThis.ResizeObserver;
  const requestFrame = runtimeWindow?.requestAnimationFrame || globalThis.requestAnimationFrame;
  const cancelFrame = runtimeWindow?.cancelAnimationFrame || globalThis.cancelAnimationFrame;
  const reason = String(type || 'block');
  let disposed = false;
  let observer = null;
  let initialFrame = 0;

  if (typeof ResizeObserverCtor === 'function') {
    let lastWidth = -1;
    let lastHeight = -1;
    observer = new ResizeObserverCtor(entries => {
      if (disposed) return;
      const rect = entries[0]?.contentRect;
      const fallbackRect = element.getBoundingClientRect?.() || { width: 0, height: 0 };
      const width = Math.round(rect?.width || fallbackRect.width || 0);
      const height = Math.round(rect?.height || fallbackRect.height || 0);
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      scheduleHybridWidgetGeometry(view, `${reason}-resize`);
    });
    observer.observe?.(element);
  }

  if (typeof requestFrame === 'function') {
    initialFrame = requestFrame.call(runtimeWindow, () => {
      initialFrame = 0;
      if (!disposed) scheduleHybridWidgetGeometry(view, `${reason}-mounted`);
    });
  }

  const record = {
    cleanup() {
      if (disposed) return;
      disposed = true;
      if (initialFrame && typeof cancelFrame === 'function') cancelFrame.call(runtimeWindow, initialFrame);
      initialFrame = 0;
      observer?.disconnect?.();
      observer = null;
      if (elementLifecycles.get(element) === record) elementLifecycles.delete(element);
    }
  };

  elementLifecycles.set(element, record);
  return record.cleanup;
}

export function destroyHybridWidgetLifecycle(element) {
  elementLifecycles.get(element)?.cleanup();
}
