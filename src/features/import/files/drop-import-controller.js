/**
 * Owns drag counters, DOM/native subscriptions and first-item classification routing.
 * Readers, document commands and overlay rendering are injected; this module never reads files.
 * start is single-use; destroy unbinds, hides the overlay and invalidates pending command callbacks.
 */
import { classifyBrowserFile, classifyImportPath, IMPORT_KINDS } from './file-type-classifier.js';

export function createDropImportController({ target, nativeDrop = false, nativeFiles = false, subscribeNative, onSubscriptionError = () => {} } = {}) {
  if (typeof target?.addEventListener !== 'function' || typeof target?.removeEventListener !== 'function') {
    throw new TypeError('Drop Import requires an event target.');
  }
  if (nativeDrop && typeof subscribeNative !== 'function') throw new TypeError('Drop Import requires a native subscriber.');
  let started = false, destroyed = false, counter = 0, generation = 0;
  let commands = null, unsubscribe = null;
  const assertActive = () => { if (destroyed) throw new Error('Drop Import is destroyed.'); };
  const visible = value => commands?.setOverlayVisible(value);
  const resetOverlay = () => { counter = 0; visible(false); };
  const dispose = async disposer => {
    try { await disposer(); } catch (error) { onSubscriptionError(error); }
  };

  async function dispatch(kind, source, value) {
    if (!started || destroyed) return false;
    const id = ++generation;
    const request = Object.freeze({ isCurrent: () => !destroyed && id === generation });
    const callbacks = commands;
    try {
      if (kind === IMPORT_KINDS.UNSUPPORTED) { callbacks.unsupported(value); return false; }
      const command = source === 'browser'
        ? (kind === IMPORT_KINDS.TEXT ? callbacks.openBrowserText : callbacks.openBrowserImage)
        : (kind === IMPORT_KINDS.TEXT ? callbacks.openNativeText : callbacks.openNativeImage);
      const result = await command(value, request);
      return request.isCurrent() && result !== false;
    } catch (error) {
      if (request.isCurrent()) callbacks.onError(error);
      return false;
    }
  }

  function openPath(path) {
    assertActive();
    if (!started) throw new Error('Drop Import is not started.');
    const resolvedPath = String(path || '').trim();
    if (!resolvedPath || !nativeFiles) return Promise.resolve(false);
    return dispatch(classifyImportPath(resolvedPath), 'native', resolvedPath);
  }
  const handlers = {
    dragenter(event) { if (destroyed) return; event.preventDefault(); counter++; visible(true); },
    dragleave() { if (destroyed) return; counter = Math.max(0, counter - 1); if (!counter) visible(false); },
    dragover(event) { if (!destroyed) event.preventDefault(); },
    drop(event) {
      if (destroyed) return Promise.resolve(false);
      event.preventDefault(); resetOverlay();
      if (nativeDrop) return Promise.resolve(false);
      const file = event.dataTransfer?.files?.[0];
      return file ? dispatch(classifyBrowserFile(file), 'browser', file) : Promise.resolve(false);
    }
  };
  function onNative(payload) {
    if (destroyed) return Promise.resolve(false);
    if (payload?.type === 'over') { visible(true); return Promise.resolve(false); }
    resetOverlay();
    if (payload?.type === 'drop') {
      const path = Array.isArray(payload.paths) ? payload.paths[0] : null;
      if (path) return openPath(path);
    }
    return Promise.resolve(false);
  }

  return Object.freeze({
    start(callbacks) {
      assertActive();
      if (started) throw new Error('Drop Import is already started.');
      for (const name of ['setOverlayVisible', 'openBrowserText', 'openBrowserImage', 'openNativeText', 'openNativeImage', 'unsupported', 'onError']) {
        if (typeof callbacks?.[name] !== 'function') throw new TypeError('Drop Import requires ' + name + '.');
      }
      commands = Object.freeze({ ...callbacks }); started = true;
      for (const [type, handler] of Object.entries(handlers)) target.addEventListener(type, handler);
      if (nativeDrop) {
        try {
          Promise.resolve(subscribeNative(onNative)).then(disposer => {
            if (typeof disposer !== 'function') throw new TypeError('Native drop subscription requires a disposer.');
            if (destroyed) return dispose(disposer);
            unsubscribe = disposer;
          }).catch(onSubscriptionError);
        } catch (error) { onSubscriptionError(error); }
      }
    },
    openPath,
    destroy() {
      if (destroyed) return;
      destroyed = true; generation++;
      if (started) for (const [type, handler] of Object.entries(handlers)) target.removeEventListener(type, handler);
      resetOverlay(); commands = null;
      if (unsubscribe) { const disposer = unsubscribe; unsubscribe = null; return dispose(disposer); }
    }
  });
}
