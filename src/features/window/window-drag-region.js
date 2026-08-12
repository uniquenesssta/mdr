/**
 * Responsibility: Own the desktop menu-bar drag gesture and double-click maximize gesture.
 * Imports: None.
 * Exports: createWindowDragRegion().
 * State/side effects: Owns one mousedown listener only; invokes injected commands and owns no WindowState.
 * Lifecycle: Explicit idempotent start/destroy; destroy removes the listener and is terminal.
 */

const INTERACTIVE_SELECTOR = '.menu-dropdown, .window-controls, button, input, select, textarea, a, [role="button"]';

function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

export function createWindowDragRegion({
  target,
  enabled = true,
  startDrag,
  toggleMaximize,
  reportError = (message, error) => console.warn(message, error)
} = {}) {
  requireObject(target, 'Window drag target');
  requireFunction(startDrag, 'Window drag startDrag');
  requireFunction(toggleMaximize, 'Window drag toggleMaximize');
  requireFunction(reportError, 'Window drag reportError');

  const capabilityEnabled = Boolean(enabled);
  let started = false;
  let destroyed = false;

  function assertActive() {
    if (destroyed) throw new Error('Window Drag Region is destroyed.');
  }

  function invoke(action) {
    try {
      const result = action();
      if (result && typeof result.then === 'function') {
        void result.catch(error => reportError('Window drag failed:', error));
      }
    } catch (error) {
      reportError('Window drag failed:', error);
    }
  }

  function handleMouseDown(event) {
    if (!capabilityEnabled || event?.buttons !== 1) return;
    const eventTarget = event?.target;
    if (eventTarget && typeof eventTarget.closest === 'function' && eventTarget.closest(INTERACTIVE_SELECTOR)) return;
    invoke(event?.detail === 2 ? toggleMaximize : startDrag);
  }

  const region = Object.freeze({
    start() {
      assertActive();
      if (started) return false;
      started = true;
      if (capabilityEnabled) target.addEventListener('mousedown', handleMouseDown);
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (started && capabilityEnabled) target.removeEventListener('mousedown', handleMouseDown);
      started = false;
    }
  });
  return region;
}
