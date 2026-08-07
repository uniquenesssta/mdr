import { getCurrentWebview as tauriGetCurrentWebview } from '@tauri-apps/api/webview';

function assertFunction(value, message) {
  if (typeof value !== 'function') throw new TypeError(message);
}

function normalizePaths(paths) {
  if (!Array.isArray(paths)) return Object.freeze([]);
  return Object.freeze(paths.map(path => String(path)));
}

function normalizePosition(position) {
  if (!position || typeof position !== 'object') return null;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Object.freeze({ x, y });
}

function normalizeDragDropEvent(nativeEvent) {
  const payload = nativeEvent?.payload && typeof nativeEvent.payload === 'object'
    ? nativeEvent.payload
    : {};
  return Object.freeze({
    type: typeof payload.type === 'string' ? payload.type : '',
    paths: normalizePaths(payload.paths),
    position: normalizePosition(payload.position)
  });
}

/**
 * Creates the desktop webview drag/drop adapter. It normalizes native Tauri
 * events into runtime-neutral data and owns every native subscription disposer.
 * File-type interpretation intentionally remains outside the platform layer.
 */
export function createDragDropClient(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('drag-drop client options must be an object');
  }

  const getCurrentWebview = Object.hasOwn(options, 'getCurrentWebview')
    ? options.getCurrentWebview
    : tauriGetCurrentWebview;
  assertFunction(getCurrentWebview, 'drag-drop client requires a getCurrentWebview function');

  const activeDisposers = [];
  let destroyed = false;
  let destroyPromise = null;

  function assertActive() {
    if (destroyed) throw new Error('drag-drop client is destroyed');
  }

  function currentWebview() {
    assertActive();
    const value = getCurrentWebview();
    if (!value || typeof value !== 'object') {
      throw new TypeError('drag-drop client getCurrentWebview must return a webview object');
    }
    return value;
  }

  function createOwnedDisposer(nativeDisposer) {
    assertFunction(nativeDisposer, 'drag-drop subscription must return a disposer function');
    let active = true;
    const owned = async () => {
      if (!active) return;
      active = false;
      const index = activeDisposers.indexOf(owned);
      if (index >= 0) activeDisposers.splice(index, 1);
      await nativeDisposer();
    };
    return owned;
  }

  async function subscribe(handler) {
    assertActive();
    assertFunction(handler, 'drag-drop client subscribe handler must be a function');
    const target = currentWebview();
    assertFunction(target.onDragDropEvent, 'current webview requires onDragDropEvent()');
    const nativeDisposer = await target.onDragDropEvent(nativeEvent => handler(normalizeDragDropEvent(nativeEvent)));
    const owned = createOwnedDisposer(nativeDisposer);
    if (destroyed) {
      await owned();
      return owned;
    }
    activeDisposers.push(owned);
    return owned;
  }

  function destroy() {
    if (destroyPromise) return destroyPromise;
    destroyed = true;
    destroyPromise = (async () => {
      const errors = [];
      while (activeDisposers.length) {
        const disposer = activeDisposers[activeDisposers.length - 1];
        try {
          await disposer();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'drag-drop client cleanup failed');
    })();
    return destroyPromise;
  }

  return Object.freeze({ subscribe, destroy });
}
