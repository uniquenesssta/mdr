/**
 * Pure drop-overlay view: render controller commands using the existing show class.
 * Owns only an optional DOM reference and terminal lifecycle; no drag state or listeners.
 * destroy hides the overlay, releases the reference and makes late render calls inert.
 */
export function createDropOverlayView({ element = null } = {}) {
  if (element !== null && (typeof element?.classList?.add !== 'function' || typeof element?.classList?.remove !== 'function')) {
    throw new TypeError('Drop Overlay requires an element with classList.');
  }
  let target = element;
  let destroyed = false;
  function setVisible(visible) {
    if (destroyed || !target) return;
    if (visible) target.classList.add('show');
    else target.classList.remove('show');
  }
  setVisible(false);
  return Object.freeze({
    setVisible,
    destroy() {
      if (destroyed) return;
      setVisible(false);
      destroyed = true;
      target = null;
    }
  });
}
