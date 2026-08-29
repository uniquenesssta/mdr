/**
 * Responsibility: Expose focus/blur state through the neutral editor adapter without leaking editor implementation details to Views.
 * Imports: None; consumes only the injected neutral adapter.
 * Exports: createEditorFocusService.
 * State/side effects: Owns terminal lifecycle only; focus side effects are delegated to the adapter.
 * Lifecycle: Explicit instance with idempotent destroy(); destroy is terminal and does not destroy the adapter.
 */
export function createEditorFocusService({ adapter } = {}) {
  if (!adapter || typeof adapter.focus !== 'function' || typeof adapter.blur !== 'function' || typeof adapter.hasFocus !== 'function') {
    throw new TypeError('Editor Focus Service requires a neutral editor adapter.');
  }
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Editor Focus Service has been destroyed.');
  };
  return Object.freeze({
    focus(options = {}) { assertActive(); return adapter.focus(options); },
    blur() { assertActive(); return adapter.blur(); },
    hasFocus() { assertActive(); return adapter.hasFocus(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
    }
  });
}
