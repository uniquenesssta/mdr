import { getCurrentWindow as tauriGetCurrentWindow } from '@tauri-apps/api/window';

function assertFunction(value, message) {
  if (typeof value !== 'function') throw new TypeError(message);
}

/**
 * Creates the desktop application-window adapter. The adapter owns native
 * subscriptions, while save-before-close policy remains in the application layer.
 */
export function createWindowClient(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('window client options must be an object');
  }

  const getCurrentWindow = Object.hasOwn(options, 'getCurrentWindow')
    ? options.getCurrentWindow
    : tauriGetCurrentWindow;
  assertFunction(getCurrentWindow, 'window client requires a getCurrentWindow function');

  const activeDisposers = [];
  let destroyed = false;
  let destroyPromise = null;

  function assertActive() {
    if (destroyed) throw new Error('window client is destroyed');
  }

  function currentWindow() {
    assertActive();
    const value = getCurrentWindow();
    if (!value || typeof value !== 'object') {
      throw new TypeError('window client getCurrentWindow must return a window object');
    }
    return value;
  }

  function createOwnedDisposer(nativeDisposer) {
    assertFunction(nativeDisposer, 'window subscription must return a disposer function');
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

  async function subscribe(methodName, handler) {
    assertActive();
    assertFunction(handler, 'window client ' + methodName + ' handler must be a function');
    const target = currentWindow();
    assertFunction(target[methodName], 'current window requires ' + methodName + '()');
    const nativeDisposer = await target[methodName](handler);
    const owned = createOwnedDisposer(nativeDisposer);
    if (destroyed) {
      await owned();
      return owned;
    }
    activeDisposers.push(owned);
    return owned;
  }

  async function startDrag() {
    const target = currentWindow();
    assertFunction(target.startDragging, 'current window requires startDragging()');
    return target.startDragging();
  }

  async function minimize() {
    const target = currentWindow();
    assertFunction(target.minimize, 'current window requires minimize()');
    return target.minimize();
  }

  async function toggleMaximize() {
    const target = currentWindow();
    assertFunction(target.toggleMaximize, 'current window requires toggleMaximize()');
    assertFunction(target.isMaximized, 'current window requires isMaximized()');
    await target.toggleMaximize();
    return target.isMaximized();
  }

  async function isMaximized() {
    const target = currentWindow();
    assertFunction(target.isMaximized, 'current window requires isMaximized()');
    return target.isMaximized();
  }

  function subscribeResize(handler) {
    return subscribe('onResized', handler);
  }

  function subscribeCloseRequest(handler) {
    return subscribe('onCloseRequested', handler);
  }

  async function requestClose() {
    const target = currentWindow();
    assertFunction(target.close, 'current window requires close()');
    return target.close();
  }

  async function forceClose() {
    const target = currentWindow();
    assertFunction(target.destroy, 'current window requires destroy()');
    return target.destroy();
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
      if (errors.length > 1) throw new AggregateError(errors, 'window client cleanup failed');
    })();
    return destroyPromise;
  }

  return Object.freeze({
    startDrag,
    minimize,
    toggleMaximize,
    isMaximized,
    subscribeResize,
    subscribeCloseRequest,
    requestClose,
    forceClose,
    destroy
  });
}
