/**
 * Atomic 8.5 Widget Lifecycle.
 * Owns one attach/destroy record per widget element, ResizeObserver, and mount-frame cleanup.
 * Geometry refresh scheduling is delegated to widget-geometry-scheduler.
 */
import { scheduleHybridWidgetGeometry } from './widget-geometry-scheduler.js';

const elementLifecycles = new WeakMap();

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
